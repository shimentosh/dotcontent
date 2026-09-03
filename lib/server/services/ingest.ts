import fs from "node:fs/promises";
import path from "node:path";

import { requireTool, run, toolStatus } from "@/lib/server/tools";
import { getSettings } from "@/lib/server/repos/settings";
import {
  createSource,
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

const DATA = path.join(process.cwd(), ".data", "sources");

/** How many stills to take. Enough to see a flow, few enough to read. */
const FRAME_COUNT = 8;

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
    const transcript = video.file ? await transcribe(video.file, dir) : "";

    return (await updateSource(source.id, {
      state: "ready",
      frames,
      transcript,
      /*
       * The reason, in yt-dlp's own words.
       *
       * "Could not be downloaded" is the same sentence for a private video, a
       * dead link and a platform refusing anonymous requests, and only one of
       * those is worth trying again. The tool already says which.
       */
      error: video.file
        ? ""
        : `Metadata only — ${video.error}. The caption and title are still usable.`,
    }))!;
  } catch (e) {
    const message = e instanceof Error ? e.message : "The download failed";
    await updateSource(source.id, { state: "failed", error: message.slice(0, 600) });
    throw new IngestError(message, 502);
  }
}

/**
 * A video somebody had on their machine.
 *
 * The same pipeline as a link, minus the download: the file is written into
 * the source's own directory and then cut and transcribed exactly as a fetched
 * one is. Footage that was never posted anywhere is the ordinary case for
 * research — a screen recording, a client's export, a reel saved months ago —
 * and it had no way in at all while a URL was the only input.
 */
export async function ingestFile(input: {
  filename: string;
  bytes: Buffer;
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
    await fs.writeFile(file, input.bytes);

    const seconds = await durationOf(file);
    const frames = await cutFrames(file, dir);
    const transcript = await transcribe(file, dir);

    return (await updateSource(source.id, {
      state: "ready",
      title: name,
      duration: seconds || null,
      frames,
      transcript,
      error: transcript ? "" : "No transcript — whisper is off or not installed.",
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
 * The spoken audio, as text.
 *
 * Whisper if it is installed. If it is not, this returns "" and the source is
 * still useful — the caption and description usually carry the domain too.
 * The alternative, failing the whole ingest over an optional tool, would make
 * the feature unavailable to anyone without a Python toolchain.
 */
async function transcribe(video: string, dir: string): Promise<string> {
  if (!(await allowed("whisper"))) return "";

  /*
   * However this machine can reach it.
   *
   * `pip install openai-whisper` often lands the script somewhere not on
   * PATH — normal on Windows — so the probe also tries `python -m whisper`
   * and records whichever answered. Running the recorded one means an install
   * the probe found is an install this can use.
   */
  const tool = await toolStatus("whisper");

  const { code } = await run(
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
    { env: tool.env, timeout: 600_000 },
  );
  if (code !== 0) return "";

  const files = await fs.readdir(dir).catch(() => []);
  const txt = files.find((f) => f.endsWith(".txt"));
  if (!txt) return "";
  return (await fs.readFile(path.join(dir, txt), "utf8").catch(() => "")).trim();
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

