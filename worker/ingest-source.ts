import fs from "node:fs/promises";
import path from "node:path";

import { run, toolStatuses, type ToolId } from "../lib/server/tools";
import type { Api } from "./api";
import type { Config } from "./config";
import { Refusal, type IngestPayload, type JobResult } from "./job-types";
import { discard, jobDir } from "./temp";

/**
 * Turning a link into frames, a caption and a WAV — on the machine that has
 * the tools, the cookies and the bandwidth.
 *
 * This is the old inline pipeline out of `lib/server/services/ingest.ts`,
 * moved rather than rewritten: the same yt-dlp ladder, the same evenly spaced
 * stills, the same 16 kHz mono WAV. What changed is where it runs and what it
 * does with the result. The server keeps every decision — how many frames, how
 * tall, how long this may take, where the bytes go — and sends them in the
 * payload; this machine only executes, and then uploads.
 *
 * **Degrading is the design, not a compromise.** A missing ffmpeg costs the
 * frames and nothing else; a video the platform will not serve still yields a
 * title, a caption and a duration, which is far more than nothing. So almost
 * nothing in here throws: what fell short comes back in `error`, in the tool's
 * own words, and the source is still `ready`. `whisper` is not in this file at
 * all — transcription is its own job on whatever machine has a GPU, which is
 * why an estate with no whisper anywhere can still fetch a link.
 */
export async function ingestSource(
  cfg: Config,
  api: Api,
  jobId: string,
  payload: IngestPayload,
): Promise<JobResult> {
  if (!payload.sourceId || !payload.url) {
    throw new Refusal("The ingest job arrived without a source or a link.");
  }

  const dir = await jobDir(jobId, "ingest");
  const deadline = Date.now() + (payload.timeoutMs ?? 900_000);

  try {
    /*
     * Metadata first, and this is the one step allowed to fail the job.
     *
     * If yt-dlp cannot even read the link there is nothing to degrade to — no
     * title, no caption, no duration — and the source would be `ready` with
     * every field empty, which reads as a bug rather than as a refusal. It is
     * left retryable because the same link often works from another machine:
     * a different network, a different residential IP, a browser signed in to
     * the platform.
     */
    const meta = await fetchMeta(cfg, payload.url, left(deadline, 90_000));

    const video = await download(cfg, payload, dir, deadline);
    const frames = video.file
      ? await cutFrames(cfg, video.file, dir, payload, deadline)
      : [];
    // Only when there is a file. With nothing downloaded there is no audio,
    // and a second sentence about a step that was never going to run buries
    // the first one that matters.
    const audio = video.file ? await extractAudio(cfg, video.file, dir, payload) : "";

    /*
     * The bytes go up BEFORE the result is posted.
     *
     * The result only names files, and `sourceResult` puts those names on the
     * row for the browser to render — so a result that arrived before its
     * frames would give the picker eight broken pictures for as long as the
     * upload took. Uploading first means the row is never ahead of the disk.
     */
    if (frames.length) await api.uploadFrames(payload.uploadFrames, frames.map((f) => f.path));
    if (audio) await api.uploadAudio(payload.uploadAudio, audio);

    return {
      title: str(meta.title),
      uploader: str(meta.uploader) || str(meta.channel),
      description: str(meta.description).slice(0, 8000),
      duration: meta.duration == null ? 0 : Math.round(Number(meta.duration)) || 0,
      thumbnail: str(meta.thumbnail),
      meta,
      frames: frames.map((f) => ({ at: f.at, file: f.file })),
      // Whether there is a WAV on the server to transcribe. The server reads
      // this to decide whether to ask for a `transcribe_audio` at all, so it
      // has to be the truth about the upload rather than about ffmpeg.
      audio: Boolean(audio),
      /*
       * Whichever step fell short, in its own words.
       *
       * The download's reason wins when there is one: it is the larger loss.
       * "Could not be downloaded" is the same sentence for a private video, a
       * dead link and a platform refusing anonymous requests, and only one of
       * those is worth trying again — the tool already says which.
       */
      error: video.file
        ? frames.length
          ? ""
          : `No frames — ${await frameReason(cfg)}`
        : `Metadata only — ${video.error}. The caption and title are still usable.`,
    };
  } finally {
    // The video is the reason this matters: a few hundred megabytes per link,
    // on somebody's own laptop, and nothing on the server will ever come back
    // to clean it up.
    await discard(dir);
  }
}

/** What is left of the server's budget, capped at what this step is worth. */
const left = (deadline: number, most: number) =>
  Math.max(5_000, Math.min(most, deadline - Date.now()));

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Whether a tool may run here: installed AND switched on, on this machine.
 *
 * `allowed()` used to AND the probe with a console-wide `settings.enabled`,
 * which was one row for the whole install — right while the install was one
 * laptop, wrong the moment "ffmpeg is off" became a fact about one machine
 * among several. The switch is this machine's own, and so is the probe.
 */
async function allowed(cfg: Config, id: ToolId) {
  if (cfg.toolsOff.has(id)) return null;
  const status = (await toolStatuses()).find((t) => t.id === id);
  return status?.present ? status : null;
}

/** What the platform says about the video, without downloading it. */
async function fetchMeta(
  cfg: Config,
  url: string,
  timeout: number,
): Promise<Record<string, unknown>> {
  const tool = await allowed(cfg, "yt-dlp");
  if (!tool) {
    // The claim query should never have handed this job to a machine without
    // yt-dlp switched on, so if it did, no other machine's answer will be
    // different for the same reason — this one is about the queue, not the
    // link.
    throw new Refusal("yt-dlp is not available on this machine, so it cannot fetch links.");
  }

  const { code, out, err } = await run(
    tool.command,
    [...tool.lead, "--dump-single-json", "--no-warnings", "--no-playlist", url],
    { env: tool.env, timeout },
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
 * That last rung is the reason this job belongs on a desktop rather than on
 * the server: the cookies it reads are a person's own browser session, on a
 * machine they are signed in to, and there was never going to be one of those
 * on a VPS.
 *
 * Capped at the height the server asked for throughout: the frames are read
 * for on-screen text and a browser address bar, and 4K costs bandwidth and
 * disk to answer the same question.
 *
 * Returns the path, or "" and the reason it could not — metadata alone is
 * still a useful source, so this degrades rather than throwing.
 */
async function download(
  cfg: Config,
  payload: IngestPayload,
  dir: string,
  deadline: number,
): Promise<{ file: string; error: string }> {
  const tool = await allowed(cfg, "yt-dlp");
  if (!tool) {
    return { file: "", error: "yt-dlp is switched off on this machine" };
  }

  const height = payload.maxHeight || 720;
  const attempts: { label: string; args: string[] }[] = [
    { label: "progressive", args: ["-f", `b[height<=${height}]/b`] },
    { label: "split streams", args: ["-f", `bv*[height<=${height}]+ba/bv*+ba`] },
    // Last, and only if the others failed: reading the browser's cookies is
    // how you get at something the platform will only serve to a signed-in
    // session. It fails harmlessly when the browser is running and holding its
    // cookie database open.
    {
      label: "browser cookies",
      args: ["--cookies-from-browser", "chrome", "-f", `b[height<=${height}]/b`],
    },
  ];

  const failures: string[] = [];

  for (const attempt of attempts) {
    if (Date.now() >= deadline) break;
    const { code, err } = await run(
      tool.command,
      [
        ...tool.lead,
        ...attempt.args,
        "--no-playlist",
        "--no-warnings",
        "-o",
        path.join(dir, "video.%(ext)s"),
        payload.url,
      ],
      { env: tool.env, timeout: left(deadline, 300_000) },
    );

    const files = await fs.readdir(dir).catch(() => []);
    const file = files.find((f) => f.startsWith("video."));
    if (code === 0 && file) {
      return { file: path.join(dir, file), error: "" };
    }

    failures.push(`${attempt.label}: ${firstUseful(err) || `exit ${code}`}`);
  }

  return { file: "", error: failures[0] ?? "yt-dlp could not fetch the media" };
}

/**
 * Why a downloaded video produced no stills.
 *
 * Four different situations used to arrive as the same empty frame list —
 * ffmpeg switched off, ffmpeg missing, ffprobe missing so the duration is
 * unknown, and ffmpeg present and failing — and only one of those is fixed by
 * an install. The person reading this sentence is deciding what to do next, so
 * it has to say which.
 */
async function frameReason(cfg: Config) {
  for (const id of ["ffmpeg", "ffprobe"] as const) {
    if (cfg.toolsOff.has(id)) return `${id} is switched off on this machine.`;
    const status = (await toolStatuses()).find((t) => t.id === id);
    if (!status?.present) {
      return `${id} is not installed on this machine. ${status?.install ?? ""}`.trim();
    }
  }
  return "ffmpeg could not cut any stills out of that video.";
}

/**
 * Evenly spaced stills, as JPEGs in this job's temp directory.
 *
 * They are named `frame-NN.jpg` because that is the shape `FRAME_FILE` on the
 * server allows, and the server re-checks every one of these names before it
 * writes a byte — the regex that used to guard a query string is now guarding
 * a write from a machine the server does not control. A name invented here
 * that does not match is a frame silently refused, so the shape is not a
 * convention, it is the contract.
 */
async function cutFrames(
  cfg: Config,
  video: string,
  dir: string,
  payload: IngestPayload,
  deadline: number,
): Promise<{ at: number; file: string; path: string }[]> {
  const tool = await allowed(cfg, "ffmpeg");
  if (!tool) return [];

  const seconds = await durationOf(cfg, video, deadline);
  if (!seconds) return [];

  const count = payload.frameCount || 8;
  const height = payload.maxHeight || 720;
  const frames: { at: number; file: string; path: string }[] = [];

  for (let i = 0; i < count; i += 1) {
    if (Date.now() >= deadline) break;
    // Offset by half a step so the first frame is not the black one platforms
    // so often start on, and the last is not past the end.
    const at = Math.max(0, ((i + 0.5) * seconds) / count);
    const file = `frame-${String(i + 1).padStart(2, "0")}.jpg`;
    const out = path.join(dir, file);
    const { code } = await run(
      tool.command,
      [
        ...tool.lead,
        "-y",
        "-ss",
        at.toFixed(2),
        "-i",
        video,
        "-frames:v",
        "1",
        "-vf",
        `scale=-2:${height}`,
        "-q:v",
        "4",
        out,
      ],
      { env: tool.env, timeout: left(deadline, 60_000) },
    );
    if (code === 0) frames.push({ at: Number(at.toFixed(2)), file, path: out });
  }
  return frames;
}

/**
 * The audio, on its own, in the only format the transcriber takes.
 *
 * `-vn` drops the video, `-ac 1` mixes to mono and `-ar 16000` resamples,
 * which together are whisper.cpp's required input and, not by coincidence,
 * about a thirtieth of the bytes. That ratio is the whole reason transcription
 * can be a separate job on a different desktop: a megabyte a minute crosses
 * the network, not four hundred.
 *
 * Returns the path, or "" — a silent screen recording with no audio track at
 * all is a real thing people post, and it is not a failure. It is a source
 * with no words in it, which the server says out loud rather than leaving as
 * an empty transcript nobody can explain.
 */
async function extractAudio(
  cfg: Config,
  video: string,
  dir: string,
  payload: IngestPayload,
): Promise<string> {
  const tool = await allowed(cfg, "ffmpeg");
  if (!tool) return "";

  const out = path.join(dir, payload.audioFile || "audio.wav");
  const { code } = await run(
    tool.command,
    [
      ...tool.lead,
      "-y",
      "-i",
      video,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(payload.audioRate || 16_000),
      out,
    ],
    { env: tool.env, timeout: 300_000 },
  );
  if (code !== 0) return "";
  // ffmpeg can exit 0 having written a header and nothing else, and a WAV with
  // no samples sent to a GPU is a minute of somebody's machine spent to
  // transcribe silence.
  const size = await fs
    .stat(out)
    .then((s) => s.size)
    .catch(() => 0);
  return size > 1024 ? out : "";
}

async function durationOf(cfg: Config, video: string, deadline: number) {
  const tool = await allowed(cfg, "ffprobe");
  if (!tool) return 0;
  const { out } = await run(
    tool.command,
    [
      ...tool.lead,
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      video,
    ],
    { env: tool.env, timeout: left(deadline, 30_000) },
  );
  const seconds = Number(out.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** The first line of yt-dlp's stderr that is a reason rather than a warning. */
function firstUseful(err: string) {
  const line = err
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("WARNING"));
  return (line ?? "").replace(/^ERROR:\s*/, "").slice(0, 300);
}
