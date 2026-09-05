import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { requireTool, run, toolStatus } from "@/lib/server/tools";
import { getSettings } from "@/lib/server/repos/settings";
import {
  createSource,
  deleteSource,
  findByUrl,
  getSource,
  updateSource,
  type Frame,
  type Source,
} from "@/lib/server/repos/sources";

/**
 * Turning a link into something a pack can actually read.
 *
 * The first two sections of the shipped pack are written for someone who has
 * watched the reel — they ask for on-screen text, a browser address bar, a
 * domain spoken aloud. Until now nothing produced any of that, so the model
 * was asked to look at frames that did not exist and quite reasonably said it
 * could not see them.
 *
 * yt-dlp fetches the video and what the platform says about it, ffmpeg cuts
 * frames out of it, and a transcriber turns the audio into text. Each step is
 * optional in the sense that a missing tool degrades the result rather than
 * failing the run: metadata alone is still far more than nothing.
 */

/**
 * Where downloads live.
 *
 * Off CONTENTOS_DATA_DIR rather than the working directory: the API is its
 * own process now, started from api/, and "./.data" from there is a second
 * folder the web app has never heard of. One root, named once, for both.
 */
export const DATA_ROOT = path.resolve(
  process.env.CONTENTOS_DATA_DIR ?? path.join(process.cwd(), ".data"),
);
const DATA = path.join(DATA_ROOT, "sources");

/** How many stills to take. Enough to see a flow, few enough to read. */
const FRAME_COUNT = 8;

/**
 * How long whisper gets before it is killed.
 *
 * The base model on a CPU transcribes at roughly real time, so ten minutes
 * covers a reel many times over and still ends rather than pinning a core all
 * evening. Named rather than written at the call site because the sentence a
 * person reads when it runs out has to quote the same number.
 */
const WHISPER_TIMEOUT_MS = 600_000;

/**
 * The only shapes a frame filename may have — the evenly spaced ones, and the
 * ones cut at a time somebody asked for. Anything else is a path traversal
 * being tried on a query string.
 */
const FRAME_FILE = /^frame-(\d{2}|at-\d+)\.jpg$/;

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const dirFor = (sid: string) => path.join(DATA, sid);

/**
 * Fetch a source, or hand back the one already fetched.
 *
 * Re-fetching is opt-in: the same reel gives the same frames and the same
 * transcript, and a run started twice should not cost two downloads.
 */
export async function ingest(input: {
  url: string;
  workspaceId?: string | null;
  refresh?: boolean;
}): Promise<Source> {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new IngestError("That is not a link — it needs to start with http", 400);
  }

  const existing = await findByUrl(url, input.workspaceId ?? null);
  if (existing && !input.refresh && existing.state === "ready") return existing;

  const source = existing ?? (await createSource({ url, workspaceId: input.workspaceId }));
  await updateSource(source.id, { state: "fetching", error: "" });

  try {
    const meta = await fetchMeta(url);
    await updateSource(source.id, {
      title: String(meta.title ?? ""),
      uploader: String(meta.uploader ?? meta.channel ?? ""),
      description: String(meta.description ?? "").slice(0, 8000),
      duration: meta.duration == null ? null : Math.round(Number(meta.duration)),
      thumbnail: String(meta.thumbnail ?? ""),
      meta,
    });

    const dir = dirFor(source.id);
    await fs.mkdir(dir, { recursive: true });

    const video = await download(url, dir);
    const frames = video.file ? await cutFrames(video.file, dir) : [];
    // Only when there is a file: with nothing downloaded there is no audio,
    // and "whisper is switched off" underneath "the video is private" is a
    // second sentence about a step that was never going to run.
    const spoken = video.file
      ? await transcribe(video.file, dir)
      : { text: "", note: "", failed: false };

    return (await updateSource(source.id, {
      state: "ready",
      frames,
      transcript: spoken.text,
      /*
       * The reason, in yt-dlp's own words.
       *
       * "Could not be downloaded" is the same sentence for a private video, a
       * dead link and a platform refusing anonymous requests, and only one of
       * those is worth trying again. The tool already says which.
       */
      /*
       * Whichever step fell short, in its own words.
       *
       * The download's reason wins when there is one: it is the larger loss,
       * and it is why whisper never ran. Otherwise a whisper that FAILED gets
       * the line — this path said nothing at all about the transcript before,
       * so a whisper killed at the ten minute mark produced a source marked
       * ready, with an empty transcript, and no hint anywhere that anything
       * had gone wrong. A whisper deliberately switched off says nothing here:
       * a link fetched for its caption is doing what was asked of it, and an
       * error on every one of them is a banner people learn to stop reading.
       */
      error: video.file
        ? spoken.failed
          ? spoken.note
          : ""
        : `Metadata only — ${video.error}. The caption and title are still usable.`,
    }))!;
  } catch (e) {
    const message = e instanceof Error ? e.message : "The download failed";
    await updateSource(source.id, { state: "failed", error: message.slice(0, 600) });
    throw new IngestError(message, 502);
  }
}

/**
 * The most an upload may be.
 *
 * A reel at 720p is tens of megabytes; a raw phone recording of one is a few
 * hundred. Half a gigabyte is above anything this is for and below anything
 * that would fill the disk by accident. Checked twice: on the declared size
 * before a byte is read, and on the bytes as they arrive, because the first is
 * a claim and the second is the truth.
 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/**
 * A video somebody had on their machine.
 *
 * The same pipeline as a link, minus the download: the file is written into
 * the source's own directory and then cut and transcribed exactly as a fetched
 * one is. Footage that was never posted anywhere is the ordinary case for
 * research — a screen recording, a client's export, a reel saved months ago —
 * and it had no way in at all while a URL was the only input.
 *
 * Streamed to disk, not buffered. `await file.arrayBuffer()` holds the whole
 * upload in memory — a 400MB recording became 400MB of heap in the route, then
 * a second copy in the Buffer — and Node's process was the thing that fell
 * over, not the request.
 */
export async function ingestFile(input: {
  filename: string;
  /** The upload's bytes, as the request hands them over. */
  stream: ReadableStream<Uint8Array>;
  workspaceId?: string | null;
}): Promise<Source> {
  const name = input.filename.trim() || "video.mp4";
  const ext = (path.extname(name) || ".mp4").toLowerCase().slice(0, 8);

  const source = await createSource({
    // A `file:` url rather than an empty one: `url` is what every screen and
    // every prompt prints as "where this came from", and a blank there reads
    // as a bug rather than as "somebody had the file".
    url: `file:${name}`,
    workspaceId: input.workspaceId,
    kind: "file",
    filename: name,
  });
  await updateSource(source.id, { state: "fetching", error: "" });

  try {
    const dir = dirFor(source.id);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `video${ext}`);
    await writeCapped(input.stream, file);

    const seconds = await durationOf(file);
    const frames = await cutFrames(file, dir);
    const spoken = await transcribe(file, dir);

    return (await updateSource(source.id, {
      state: "ready",
      title: name,
      duration: seconds || null,
      frames,
      transcript: spoken.text,
      // What actually happened, rather than the guess this used to print. "Off
      // or not installed" was shown to people whose whisper was installed,
      // switched on, and killed by the timeout — the one case of the four
      // where there is something to be done about it.
      error: spoken.note,
    }))!;
  } catch (e) {
    const message = e instanceof Error ? e.message : "The upload failed";
    await updateSource(source.id, { state: "failed", error: message.slice(0, 600) });
    throw new IngestError(message, 500);
  }
}

/**
 * One more still, at a second somebody asked for.
 *
 * The eight the ingest takes are evenly spaced, which is the right default and
 * the wrong answer whenever the thing worth seeing — the address bar, the
 * result on screen — happens between two of them. Added to the row rather than
 * replacing it, in time order, so the strip stays a timeline.
 */
export async function addFrameAt(sourceId: string, at: number): Promise<Source> {
  const source = await getSource(sourceId);
  if (!source) throw new IngestError("No such source", 404);

  const dir = dirFor(sourceId);
  const files = await fs.readdir(dir).catch(() => []);
  const video = files.find((f) => f.startsWith("video."));
  if (!video) {
    throw new IngestError(
      "The video itself was never downloaded, so there is nothing to take a frame from.",
      409,
    );
  }

  const seconds = source.duration ?? (await durationOf(path.join(dir, video)));
  const want = Math.max(0, Math.min(at, seconds ? seconds - 0.1 : at));
  if (source.frames.some((f) => Math.abs(f.at - want) < 0.5)) return source;

  // Named by the time rather than by position: positions renumber as frames
  // are added, and a file that changes meaning is a cache nobody can trust.
  const file = `frame-at-${Math.round(want * 100)}.jpg`;
  const { code } = await run(
    "ffmpeg",
    [
      "-y",
      "-ss",
      want.toFixed(2),
      "-i",
      path.join(dir, video),
      "-frames:v",
      "1",
      "-vf",
      "scale=720:-2",
      "-q:v",
      "4",
      path.join(dir, file),
    ],
    { timeout: 60_000 },
  );
  if (code !== 0) throw new IngestError("ffmpeg could not read that moment", 502);

  const frames = [...source.frames, { at: Number(want.toFixed(2)), file }].sort(
    (a, b) => a.at - b.at,
  );
  return (await updateSource(sourceId, { frames }))!;
}

/**
 * Delete a source, and the download that went with it.
 *
 * The row and the directory are one thing: `deleteSource` on its own left a
 * video and eight JPEGs on disk with nothing in the database pointing at them,
 * so the only way to find them was to go looking. A reel is tens of megabytes
 * — a few deletes and the disk is carrying a folder nobody can reach.
 */
export async function removeSource(sourceId: string) {
  const gone = await deleteSource(sourceId);
  // The files go whether or not the row was there: a half-deleted source is
  // exactly the state this is meant to clean up.
  await fs.rm(dirFor(sourceId), { recursive: true, force: true }).catch(() => {});
  return gone;
}

/**
 * Stream an upload to disk, refusing it the moment it passes the cap.
 *
 * Counted as the bytes pass rather than trusted from the header: a client can
 * say 10MB and send 10GB. Past the limit the pipeline is torn down, the
 * partial file removed, and the caller gets a sentence with the number in it.
 */
async function writeCapped(stream: ReadableStream<Uint8Array>, file: string) {
  let seen = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > MAX_UPLOAD_BYTES) {
        done(
          new IngestError(
            `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1048576)}MB — trim it or export it smaller.`,
            413,
          ),
        );
        return;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(stream as import("node:stream/web").ReadableStream),
      cap,
      createWriteStream(file),
    );
  } catch (e) {
    await fs.rm(file, { force: true }).catch(() => {});
    throw e;
  }
}

/** The bytes of one frame, for a model that is going to look at it. */
export async function frameBytes(sourceId: string, file: string) {
  if (!FRAME_FILE.test(file)) return null;
  return fs.readFile(path.join(dirFor(sourceId), file)).catch(() => null);
}

/**
 * Where a frame is, for a model that opens files rather than being handed
 * bytes. Same name check as everything else that takes a filename from a row.
 */
export function framePath(sourceId: string, file: string) {
  return FRAME_FILE.test(file) ? path.join(dirFor(sourceId), file) : null;
}

/** What the platform says about the video, without downloading it. */
async function fetchMeta(url: string): Promise<Record<string, unknown>> {
  await requireTool("yt-dlp");
  const { code, out, err } = await run(
    "yt-dlp",
    ["--dump-single-json", "--no-warnings", "--no-playlist", url],
    { timeout: 90_000 },
  );
  if (code !== 0 || !out.trim()) {
    throw new Error(firstUseful(err) || "yt-dlp could not read that link");
  }
  try {
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    throw new Error("yt-dlp returned something that was not JSON");
  }
}

/**
 * The video file itself.
 *
 * Tried more than once, because "download this video" is not one operation any
 * more. YouTube in particular refuses anonymous requests for the media even
 * when it happily hands over the metadata, so the ladder goes: a single
 * progressive file (smallest, most often allowed), then separate video+audio
 * streams muxed by ffmpeg, then the same again with the cookies from a signed
 * in browser.
 *
 * Capped at 720p throughout: the frames are read for on-screen text and a
 * browser address bar, and 4K costs bandwidth and disk to answer the same
 * question.
 *
 * Returns the path, or "" and the reason it could not — metadata alone is
 * still a useful source, so this degrades rather than throwing.
 */
async function download(
  url: string,
  dir: string,
): Promise<{ file: string; error: string }> {
  // Switched off means metadata only, deliberately — which is the fast path
  // when all you want is the caption and the title.
  if (!(await allowed("yt-dlp"))) {
    return { file: "", error: "yt-dlp is switched off in Integrations" };
  }

  const attempts: { label: string; args: string[] }[] = [
    { label: "progressive", args: ["-f", "b[height<=720]/b"] },
    { label: "split streams", args: ["-f", "bv*[height<=720]+ba/bv*+ba"] },
    // Last, and only if the others failed: reading the browser's cookies is
    // how you get at something the platform will only serve to a signed-in
    // session. It fails harmlessly when the browser is running and holding
    // its cookie database open.
    {
      label: "browser cookies",
      args: [
        "--cookies-from-browser",
        "chrome",
        "-f",
        "b[height<=720]/b",
      ],
    },
  ];

  const failures: string[] = [];

  for (const attempt of attempts) {
    const { code, err } = await run(
      "yt-dlp",
      [
        ...attempt.args,
        "--no-playlist",
        "--no-warnings",
        "-o",
        path.join(dir, "video.%(ext)s"),
        url,
      ],
      { timeout: 300_000 },
    );

    const files = await fs.readdir(dir).catch(() => []);
    const file = files.find((f) => f.startsWith("video."));
    if (code === 0 && file) return { file: path.join(dir, file), error: "" };

    failures.push(`${attempt.label}: ${firstUseful(err) || `exit ${code}`}`);
  }

  return { file: "", error: failures[0] ?? "yt-dlp could not fetch the media" };
}

/**
 * Whether a tool may run: installed AND switched on.
 *
 * The switches on the integrations page were saved and then ignored, which
 * made them the worst kind of control — one that remembers what you told it
 * and does the opposite.
 */
async function allowed(id: "yt-dlp" | "ffmpeg" | "ffprobe" | "whisper") {
  const [status, settings] = await Promise.all([toolStatus(id), getSettings()]);
  return status.present && settings.enabled.includes(id);
}

/** Evenly spaced stills, as JPEGs beside the video. */
async function cutFrames(video: string, dir: string): Promise<Frame[]> {
  if (!(await allowed("ffmpeg"))) return [];

  const seconds = await durationOf(video);
  if (!seconds) return [];

  const frames: Frame[] = [];
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    // Offset by half a step so the first frame is not the black one platforms
    // so often start on, and the last is not past the end.
    const at = Math.max(0, ((i + 0.5) * seconds) / FRAME_COUNT);
    const file = `frame-${String(i + 1).padStart(2, "0")}.jpg`;
    const { code } = await run(
      "ffmpeg",
      [
        "-y",
        "-ss",
        at.toFixed(2),
        "-i",
        video,
        "-frames:v",
        "1",
        "-vf",
        "scale=720:-2",
        "-q:v",
        "4",
        path.join(dir, file),
      ],
      { timeout: 60_000 },
    );
    if (code === 0) frames.push({ at: Number(at.toFixed(2)), file });
  }
  return frames;
}

async function durationOf(video: string) {
  if (!(await allowed("ffprobe"))) return 0;
  const { out } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      video,
    ],
    { timeout: 30_000 },
  );
  const seconds = Number(out.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/**
 * What came back from the attempt to transcribe — and, when nothing did, why.
 *
 * A bare "" said four different things at once: whisper is switched off,
 * whisper is not installed, whisper ran for ten minutes and was killed, and
 * whisper exited fine but wrote nothing. The first two are the fast path and
 * the last two are failures, and the caller marked all four `state: "ready"`
 * with an empty transcript — so a source whose transcription had timed out
 * looked exactly like one nobody wanted transcribed, and the model later wrote
 * a thinner section off the frames alone with nobody the wiser.
 */
type Transcribed = {
  /** The spoken audio as text, or "" if there is none. */
  text: string;
  /**
   * Why there is no text, as the sentence the source's `error` field carries
   * to the screen. Empty when there IS text, and only then.
   */
  note: string;
  /**
   * Whether that note is a real failure or an expected absence. Switched off
   * and not installed are decisions about this machine; timed out and crashed
   * are things that went wrong and might go right on a retry.
   */
  failed: boolean;
};

/**
 * The spoken audio, as text.
 *
 * Whisper if it is switched on and installed. If it is not, this returns no
 * text and the source is still useful — the caption and description usually
 * carry the domain too. The alternative, failing the whole ingest over an
 * optional tool, would make the feature unavailable to anyone without a Python
 * toolchain. A whisper that ran and failed degrades the same way, but says so:
 * the transcript is the difference between a section written from what was
 * said and one written from what could be seen.
 */
async function transcribe(video: string, dir: string): Promise<Transcribed> {
  /*
   * However this machine can reach it.
   *
   * `pip install openai-whisper` often lands the script somewhere not on
   * PATH — normal on Windows — so the probe also tries `python -m whisper`
   * and records whichever answered. Running the recorded one means an install
   * the probe found is an install this can use.
   */
  const [tool, settings] = await Promise.all([toolStatus("whisper"), getSettings()]);

  /*
   * The two expected absences, told apart.
   *
   * `allowed()` collapses them into one boolean, which is the right answer for
   * ffmpeg and the wrong one here: "switched off" is fixed by a toggle on the
   * Integrations page and "not installed" by a pip install, and a person told
   * the wrong one goes looking in the wrong place.
   */
  if (!settings.enabled.includes("whisper")) {
    return {
      text: "",
      note: "No transcript — whisper is switched off in Integrations.",
      failed: false,
    };
  }
  if (!tool.present) {
    return {
      text: "",
      note: `No transcript — whisper is not installed here. ${tool.install}`,
      failed: false,
    };
  }

  const { code, err } = await run(
    tool.command,
    [
      ...tool.lead,
      video,
      "--model",
      "base",
      "--output_format",
      "txt",
      "--output_dir",
      dir,
      "--fp16",
      "False",
    ],
    { env: tool.env, timeout: WHISPER_TIMEOUT_MS },
  );

  if (code !== 0) {
    /*
     * A timeout reads as its own thing, not as a crash.
     *
     * `run()` kills the child and returns -1 with "Timed out after ..." on
     * stderr, and that is the likeliest real failure here: the base model on a
     * CPU runs at roughly real time, so a long video on an ordinary laptop
     * runs out of clock rather than crashing. The remedy is a shorter clip,
     * not a reinstall, so the sentence must not say the same thing a crash
     * would.
     */
    if (/Timed out after/.test(err)) {
      return {
        text: "",
        note: `No transcript — whisper ran out of time after ${Math.round(
          WHISPER_TIMEOUT_MS / 60_000,
        )} minutes on this video. A shorter clip will finish.`,
        failed: true,
      };
    }
    return {
      text: "",
      note: `No transcript — whisper failed: ${firstUseful(err) || `exit ${code}`}`,
      failed: true,
    };
  }

  const files = await fs.readdir(dir).catch(() => []);
  const txt = files.find((f) => f.endsWith(".txt"));
  /*
   * Exited clean and left nothing behind: a directory it could not write into,
   * or a build that wrote some other format. There is no transcript either
   * way, and it is not the fast path, so it does not get to look like one.
   */
  if (!txt) {
    return {
      text: "",
      note: "No transcript — whisper finished but wrote no text file.",
      failed: true,
    };
  }

  const text = (await fs.readFile(path.join(dir, txt), "utf8").catch(() => "")).trim();
  if (!text) {
    return {
      text: "",
      note: "No transcript — whisper wrote an empty text file.",
      failed: true,
    };
  }
  return { text, note: "", failed: false };
}

/** One frame's bytes, for the API route that serves them. */
export async function frameFile(sourceId: string, file: string) {
  // Nothing but a bare filename gets through: a source id and a name from the
  // row are safe, a name from a query string is a path traversal waiting to
  // be tried.
  if (!FRAME_FILE.test(file)) return null;
  const full = path.join(dirFor(sourceId), file);
  return fs.readFile(full).catch(() => null);
}

/** What a run's prompt is given about the video it is meant to have watched. */
export async function sourceBrief(sourceId: string) {
  const source = await getSource(sourceId);
  if (!source) return "";

  const lines = [
    `URL: ${source.url}`,
    source.title ? `TITLE: ${source.title}` : "",
    source.uploader ? `POSTED BY: ${source.uploader}` : "",
    source.duration ? `DURATION: ${source.duration}s` : "",
    source.description ? `CAPTION / DESCRIPTION:\n${source.description}` : "",
    source.transcript ? `TRANSCRIPT:\n${source.transcript}` : "",
    source.frames.length
      ? `FRAMES: ${source.frames.length} stills were taken, at ${source.frames
          .map((f) => `${f.at}s`)
          .join(", ")}. They are on disk under .data/sources/${source.id}/.`
      : "",
  ].filter(Boolean);

  // The heading travels with the evidence now — the prompt builder places
  // whatever block it is handed rather than assuming every source is a reel.
  return [
    "--- THE SOURCE VIDEO ---",
    "This is what the reel actually contains. Read it before answering; it is the only first-hand evidence you have about the video.",
    ...lines,
  ].join("\n\n");
}

/** Trims a tool's stderr to the line that says what went wrong. */
function firstUseful(err: string) {
  const line = err
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("WARNING"));
  return (line ?? "").replace(/^ERROR:\s*/, "").slice(0, 300);
}

