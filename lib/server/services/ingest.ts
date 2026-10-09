import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { run, toolStatus } from "@/lib/server/tools";
import {
  activeJobs,
  enqueue,
  type Job,
} from "@/lib/server/repos/jobs";
import { listWorkers, routeFor } from "@/lib/server/repos/workers";
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
 *
 * **None of that runs here any more, for a link.** `ingest()` builds a job and
 * returns; a worker on somebody's desktop runs yt-dlp and ffmpeg, uploads the
 * stills and a 16 kHz WAV, and posts back what it found. This file keeps the
 * decisions — what to fetch, where it goes, what a missing tool means — and
 * the machine only executes, exactly as `advance()` does for a section. See
 * docs/WORKER.md.
 *
 * The one ingest that stays here is an upload. The bytes have already arrived
 * on this server from the browser, and sending four hundred megabytes back out
 * to a laptop to cut eight stills would double the transfer to learn nothing;
 * `ffmpeg` is a real dependency of the API image and already in
 * `api/Dockerfile`. Transcription still leaves, as its own job, because
 * `whisper` is the one step that wants a GPU and the one dependency the server
 * should not carry — and whisper.cpp, the only whisper a non-developer can
 * install in one click, takes a 16 kHz mono WAV as input anyway.
 */

/**
 * Where downloads live.
 *
 * Off DOTCONTENT_DATA_DIR rather than the working directory: the API is its
 * own process now, started from api/, and "./.data" from there is a second
 * folder the web app has never heard of. One root, named once, for both.
 */
export const DATA_ROOT = path.resolve(
  process.env.DOTCONTENT_DATA_DIR ?? path.join(process.cwd(), ".data"),
);
const DATA = path.join(DATA_ROOT, "sources");

/** How many stills to take. Enough to see a flow, few enough to read. */
const FRAME_COUNT = 8;

/**
 * The tallest a still is worth being.
 *
 * The frames are read for on-screen text and a browser address bar, and 4K
 * costs bandwidth and disk to answer the same question. Named here rather than
 * only at the ffmpeg call site because it now also travels in a payload to a
 * machine this process cannot see, and the two must not drift apart.
 */
const FRAME_MAX_HEIGHT = 720;

/**
 * What whisper.cpp takes, and therefore what gets uploaded.
 *
 * Sixteen kilohertz mono is not a number invented here to be tidy — it is
 * whisper.cpp's input format, so the conversion is a step that had to happen
 * on somebody's machine regardless. Doing it during the ingest means the audio
 * that crosses the network is roughly a thirtieth of the video: a megabyte a
 * minute rather than four hundred, which is the whole reason transcription can
 * afford to be a separate job on a different desktop.
 */
const AUDIO_RATE = 16_000;

/** The one name a source's audio may have, on either side of the network. */
export const AUDIO_FILE = "audio.wav";

/**
 * How long the machine fetching a link gets before it gives up.
 *
 * yt-dlp climbs a ladder of three attempts and each may pull tens of
 * megabytes, so this is generous on purpose. The server says it rather than
 * the worker choosing, for the same reason `SECTION_TIMEOUT_MS` does: an
 * ingest must not take twice as long on one teammate's laptop as on another's
 * because of a different default.
 */
const INGEST_TIMEOUT_MS = 900_000;

/**
 * How long whisper gets before it is killed.
 *
 * The base model on a CPU transcribes at roughly real time, so ten minutes
 * covers a reel many times over and still ends rather than pinning a core all
 * evening. Named rather than written at the call site because the sentence a
 * person reads when it runs out has to quote the same number.
 */
const WHISPER_TIMEOUT_MS = 600_000;

/** Which whisper model the transcriber is told to load. */
const WHISPER_MODEL = "base";

/**
 * How long a job may sit waiting for a machine that is capable but shut.
 *
 * The same fifteen minutes `advance()` gives a section, and for the same
 * reason: somebody opening their laptop is the normal resolution and it should
 * just start, while a laptop that stays shut has to end as a stated failure
 * rather than as a row that reads "Fetching…" all night.
 */
const WAIT_FOR_MACHINE_MS = 15 * 60_000;

/**
 * The only shapes a frame filename may have — the evenly spaced ones, and the
 * ones cut at a time somebody asked for. Anything else is a path traversal
 * being tried on a query string.
 */
export const FRAME_FILE = /^frame-(\d{2}|at-\d+)\.jpg$/;

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const dirFor = (sid: string) => path.join(DATA, sid);

/** Where a source's 16 kHz WAV is, for the endpoints that take and serve it. */
export function audioPath(sourceId: string) {
  return path.join(dirFor(sourceId), AUDIO_FILE);
}

/** Make sure a source's directory exists before something is written into it. */
export async function ensureSourceDir(sourceId: string) {
  const dir = dirFor(sourceId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Fetch a source, or hand back the one already fetched.
 *
 * Re-fetching is opt-in: the same reel gives the same frames and the same
 * transcript, and a run started twice should not cost two downloads.
 *
 * **This no longer fetches anything.** It writes a job and returns a source in
 * `fetching`, exactly the shape `advance()` gave `write_section`: the server
 * decides what to fetch and where the results go, and whichever machine has
 * yt-dlp on it does the work. The old version spawned yt-dlp, ffmpeg and
 * whisper inside the API process, which is only correct while the API is a
 * laptop — on the VPS `docs/DEPLOYING.md` describes it is a box with no GPU,
 * no browser cookies and, quite often, no yt-dlp at all.
 *
 * The three routing cases are `advance()`'s, and they are three rather than
 * one because the answers differ: an install command, "open your laptop", and
 * "wait a moment" are not the same sentence. What they share is the rule
 * underneath — a job that cannot run must reach a terminal state, visibly. A
 * source left on `fetching` with nothing in the queue behind it is the
 * five-days-on-Writing row of `docs/DECISIONS.md` wearing a different hat.
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

  const source =
    existing ?? (await createSource({ url, workspaceId: input.workspaceId }));

  /*
   * One live ingest per source.
   *
   * `jobs_one_per_section` cannot help here: its predicate is on
   * (run_id, section_id), both null for an ingest, and Postgres treats NULLs
   * as distinct — so the index that stops a section being written twice is
   * silent about a link being fetched twice. Two tabs, a double click on
   * Fetch, or a refresh while one is already running would otherwise put two
   * machines on the same download, and the second one's frames would land on
   * top of the first's half-written JPEGs.
   *
   * Read rather than enforced, because the honest fix is a partial unique
   * index on `source_id` and that lives in a migration this change does not
   * own. A race between two clicks in the same second can still slip through;
   * the cost of that is one duplicated download, not a corrupted row.
   */
  const already = (await activeJobs()).some(
    (j) => j.sourceId === source.id && j.kind === "ingest_source",
  );
  if (already) {
    return (await updateSource(source.id, { state: "fetching" }))!;
  }

  const payload = {
    sourceId: source.id,
    url,
    refresh: input.refresh === true,
    frameCount: FRAME_COUNT,
    maxHeight: FRAME_MAX_HEIGHT,
    audioRate: AUDIO_RATE,
    audioFile: AUDIO_FILE,
    timeoutMs: INGEST_TIMEOUT_MS,
    /*
     * Where the bytes go, named in the payload rather than assembled on the
     * worker. The server is the single source of truth for frames — the
     * browser renders them, the machine that ingests and the machine that
     * writes are usually different, and desktops are not backed up — so
     * ingest uploads and write downloads, and the uploader is told exactly
     * where by the side that owns the filesystem.
     */
    uploadFrames: `/api/workers/sources/${source.id}/frames`,
    uploadAudio: `/api/workers/sources/${source.id}/audio`,
  };

  /*
   * `yt-dlp` alone, and the rest as soft preferences.
   *
   * The pipeline degrades rather than failing when a tool is missing —
   * metadata alone is still far more than nothing — and that must survive the
   * move. Naming ffmpeg in `needs` would make a machine with yt-dlp and no
   * ffmpeg unable to see the job at all, so a link that would have yielded a
   * title, a caption and a transcript yields an error instead. `whisper` is
   * not here for a stronger reason still: transcription is its own job, so an
   * estate with no whisper anywhere still ingests.
   */
  const needs = ["yt-dlp"];
  const route = await routeFor(needs);

  /*
   * Case 1: nothing on this estate has ever advertised yt-dlp.
   *
   * The job is unroutable at birth and the source fails with the sentence
   * naming what to install. Queueing it instead would be a row that reads
   * "Fetching…" until somebody deletes it, because no machine can ever claim
   * it — forever is not a state a person can act on.
   */
  if (route.missing.length) {
    const need = route.missing[0];
    const install = await installHint(need);
    const message = install
      ? `No machine here has ${need}, so this link cannot be fetched. Install it on one — ${install} — then press Fetch again.`
      : `No machine here has ${need}, and none has ever reported how to install it.`;
    await enqueue({
      kind: "ingest_source",
      workspaceId: source.workspaceId,
      sourceId: source.id,
      needs,
      payload,
      state: "unroutable",
      error: message,
    });
    return (await updateSource(source.id, {
      state: "failed",
      error: message,
    }))!;
  }

  /*
   * Case 2: a machine could fetch it, but none of them is awake.
   *
   * Queued with a deadline and a sentence naming the machine, so somebody
   * opening their laptop simply starts it. The source stays `fetching` and
   * carries the wait as its error line, because "waiting for Shakhawat's
   * desktop" is the true answer to "why has this not moved" and a blank row is
   * not. Past `wait_until` the reaper ends the job — see `sourceFailed`.
   */
  const asleep = route.live.length === 0;
  const machines = route.capable.map((w) => w.name).join(" or ");
  const waiting = `Waiting for ${machines}, which has not been seen recently.`;

  await enqueue({
    kind: "ingest_source",
    workspaceId: source.workspaceId,
    sourceId: source.id,
    needs,
    payload,
    ...(asleep
      ? { waitUntil: new Date(Date.now() + WAIT_FOR_MACHINE_MS), error: waiting }
      : {}),
  });

  // Case 3 is ordinary queueing and has nothing to say beyond position, so
  // the error line is cleared rather than left showing a previous attempt's.
  return (await updateSource(source.id, {
    state: "fetching",
    error: asleep ? waiting : "",
  }))!;
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
 * The one ingest that does **not** become a job, and deliberately. The bytes
 * are already arriving here from the browser; sending a four hundred megabyte
 * recording back out to a laptop to cut eight stills would double the transfer
 * to learn nothing, and `ffmpeg` is already a dependency of the API image. So
 * the server does the ffmpeg half itself — the frames and the WAV — and then
 * enqueues `transcribe_audio` like any other source, because that is the half
 * that wants a GPU and is the one dependency the server should not carry.
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
    const dir = await ensureSourceDir(source.id);
    const file = path.join(dir, `video${ext}`);
    await writeCapped(input.stream, file);

    const seconds = await durationOf(file);
    const frames = await cutFrames(file, dir);
    // The audio out of the same file, in the format the transcriber takes, so
    // the only thing that ever leaves this server for a transcription is about
    // a megabyte a minute rather than the whole recording.
    const audio = await extractAudio(file, dir);

    const ready = (await updateSource(source.id, {
      state: "ready",
      title: name,
      duration: seconds || null,
      frames,
    }))!;

    /*
     * The transcript arrives later, on somebody else's machine.
     *
     * An upload is `ready` the moment the frames exist — everything a person
     * came here for is on the page — and the note says where the words are.
     * Waiting for whisper before calling it ready would put a spinner on a
     * source that is already usable, on an estate that may have no whisper at
     * all.
     */
    const note = audio
      ? await requestTranscript(ready)
      : "No transcript — ffmpeg could not get any audio out of that file.";
    return (await updateSource(source.id, { error: note }))!;
  } catch (e) {
    const message = e instanceof Error ? e.message : "The upload failed";
    await updateSource(source.id, { state: "failed", error: message.slice(0, 600) });
    throw new IngestError(message, 500);
  }
}

/**
 * A machine has finished fetching a link. Write down what it found.
 *
 * The counterpart of `sectionResult` in services/runs.ts, and called from the
 * same place: the worker-facing controller, once `jobs.succeed()` has
 * confirmed the job still belonged to the machine posting it. Do not call it
 * on a result `succeed()` returned null for — that is a laptop waking up and
 * posting an ingest that was reassigned twenty minutes ago, and whatever is on
 * the row now is the copy that stands.
 *
 * The frames and the WAV are already here: they went up through
 * `POST /api/workers/sources/:id/frames` and `.../audio` before this was
 * posted, so the result only NAMES files the server already holds. Every name
 * is checked against `FRAME_FILE` again anyway. It was checked at the upload,
 * but this is a different write — these names go onto the row and are later
 * joined to a path by `framePath`, and a name that never matched an uploaded
 * file would put a broken picture in the picker at best.
 *
 * Nothing here fails the source over a missing transcript. The worker reports
 * what it could not do in `error`, that sentence is shown, and the source is
 * still `ready`: metadata and stills are far more than nothing, and an ingest
 * that failed because an optional tool was absent would make the feature
 * unavailable to anyone without a Python toolchain.
 */
export async function sourceResult(
  job: Pick<Job, "kind" | "sourceId">,
  result: Record<string, unknown>,
): Promise<Source | null> {
  if (job.kind !== "ingest_source" || !job.sourceId) return null;
  const source = await getSource(job.sourceId);
  if (!source) return null;

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const meta = result.meta;
  const duration = Number(result.duration);

  const frames: Frame[] = Array.isArray(result.frames)
    ? (result.frames as unknown[])
        .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
        .filter((f) => FRAME_FILE.test(str(f.file)))
        .map((f) => ({ at: Number(f.at) || 0, file: str(f.file) }))
        .sort((a, b) => a.at - b.at)
    : [];

  const transcript = str(result.transcript).trim();

  await updateSource(source.id, {
    state: "ready",
    title: str(result.title),
    uploader: str(result.uploader),
    description: str(result.description).slice(0, 8000),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    thumbnail: str(result.thumbnail),
    frames,
    ...(transcript ? { transcript } : {}),
    ...(meta === undefined ? {} : { meta }),
  });

  /*
   * Whichever step fell short, in its own words — and the machine's reason
   * wins.
   *
   * A download that failed is the larger loss and it is why there is no audio
   * to transcribe, so its sentence goes on the row and no transcription is
   * asked for. `Metadata only — <yt-dlp's own words>` matters because "could
   * not be downloaded" is the same sentence for a private video, a dead link
   * and a platform refusing anonymous requests, and only one of those is worth
   * trying again.
   */
  const reported = str(result.error).trim();
  const audio = result.audio === true;

  let note = reported;
  if (!note && !transcript) {
    note = audio
      ? await requestTranscript(source)
      : "No transcript — the machine that fetched this got no audio out of it.";
  }

  return (await updateSource(source.id, { error: note }))!;
}

/**
 * A transcription came back. Put the words on the source.
 *
 * Separate from `sourceResult` because it is a separate job on, usually, a
 * separate machine: an upload never had an `ingest_source` at all, and a link
 * fetched on a laptop with no GPU is transcribed on a desktop that has one.
 */
export async function transcriptResult(
  job: Pick<Job, "kind" | "sourceId">,
  result: Record<string, unknown>,
): Promise<Source | null> {
  if (job.kind !== "transcribe_audio" || !job.sourceId) return null;
  const source = await getSource(job.sourceId);
  if (!source) return null;

  const text = (typeof result.text === "string" ? result.text : "").trim();

  /*
   * Transcribed to nothing is a fact about the audio, not a success.
   *
   * A reel with music and no speech genuinely has no transcript, and so does a
   * whisper that exited clean and wrote an empty file. Neither is a failure of
   * the source and neither may look like a transcript that simply has not
   * arrived yet, so both get a sentence and the source stays ready.
   */
  if (!text) {
    return (await updateSource(source.id, {
      error: "No transcript — the audio was transcribed and came back empty.",
    }))!;
  }

  return (await updateSource(source.id, {
    transcript: text,
    // Only a note about the transcript is cleared. An ingest's own reason —
    // "Metadata only — this video is private" — is still true after a
    // transcription lands somewhere else, and wiping it would quietly remove
    // the only record that the video was never downloaded.
    ...(isTranscriptNote(source.error) ? { error: "" } : {}),
  }))!;
}

/**
 * A source's job failed on the machine that held it, or ran out of patience.
 *
 * The counterpart of `sectionFailed`, and it must be called from the same two
 * places for the same reason: the worker-facing controller when `jobs.fail()`
 * comes back with a job in a TERMINAL state, and the reaper when a job ends on
 * evidence nobody reports — a lease that expired because a laptop was shut,
 * attempts spent, or a `wait_until` nobody came back for. Without the second
 * caller a source sits on `fetching` with an empty queue behind it, which is
 * precisely the row this whole design exists to make impossible.
 *
 * Do not call it on a retryable failure that still has attempts left: that job
 * is about to be tried on another machine, and marking the source failed in
 * between would flash "Failed" on something that is about to succeed.
 *
 * The two kinds end differently, and that difference is the degradation
 * philosophy stated in code:
 *
 * - An `ingest_source` that failed produced nothing, so the source fails and
 *   says which machine said what.
 * - A `transcribe_audio` that failed cost the source its words and nothing
 *   else. The metadata, the caption and the stills are all still there and are
 *   still worth reading, so the source stays `ready` and the failure is a
 *   sentence rather than a state. Failing it here would mean an estate whose
 *   only whisper machine is broken could not use a link at all.
 */
export async function sourceFailed(
  job: Pick<Job, "kind" | "sourceId">,
  error: string,
  /** The machine that reported it, so the sentence can name it. "" if none. */
  workerName = "",
): Promise<Source | null> {
  if (!job.sourceId) return null;
  const source = await getSource(job.sourceId);
  if (!source) return null;

  const reason = (error || "The machine did not say why.").slice(0, 600);
  const on = workerName ? ` on ${workerName}` : "";

  if (job.kind === "transcribe_audio") {
    return (await updateSource(source.id, {
      // Kept in the "No transcript" shape on purpose: `transcriptResult` reads
      // that shape to know whether an arriving transcript may clear the line.
      error: `No transcript — transcription failed${on}: ${reason}`,
    }))!;
  }

  if (job.kind !== "ingest_source") return source;

  return (await updateSource(source.id, {
    state: "failed",
    error: `${reason}${on ? ` (${workerName})` : ""}`,
  }))!;
}

/**
 * Ask for a transcript, and return the sentence the source should show.
 *
 * The same three routing cases as everything else, and the same rule — a job
 * that cannot run must reach a terminal state, visibly — with one deliberate
 * difference: **none of the three fails the source.** A missing transcriber
 * degrades a source and says which; it does not fail an ingest. That was true
 * when whisper ran inline and it has to survive the split, or an estate where
 * nobody has installed whisper stops being able to use a link at all.
 *
 * So case 1 does not even enqueue. An `unroutable` row would be an honest
 * record, but it would also be a job on the queue view for something nobody
 * asked to be told about twice; the sentence on the source is the whole of
 * what a person can act on.
 */
async function requestTranscript(source: Source): Promise<string> {
  if (source.transcript.trim()) return "";

  const needs = ["whisper"];
  const route = await routeFor(needs);

  if (route.missing.length) {
    const install = await installHint("whisper");
    return install
      ? `No transcript — no machine here has whisper. Install it on one: ${install}`
      : "No transcript — no machine here has whisper.";
  }

  /*
   * One live transcription per source, for the reason `ingest` guards itself:
   * an ingest whose result lands twice, or an upload retried, would otherwise
   * put two machines on the same WAV and spend two GPUs to write the same
   * words.
   */
  const already = (await activeJobs()).some(
    (j) => j.sourceId === source.id && j.kind === "transcribe_audio",
  );
  if (already) return "Transcript — a machine is working on it.";

  const asleep = route.live.length === 0;
  const machines = route.capable.map((w) => w.name).join(" or ");

  await enqueue({
    kind: "transcribe_audio",
    workspaceId: source.workspaceId,
    sourceId: source.id,
    needs,
    payload: {
      sourceId: source.id,
      // The WAV and nothing else. This is the sentence the whole split turns
      // on: audio is roughly a thirtieth of the video, so the round trip a
      // desktop GPU is worth is a megabyte a minute rather than four hundred.
      audioUrl: `/api/workers/sources/${source.id}/audio`,
      model: WHISPER_MODEL,
      timeoutMs: WHISPER_TIMEOUT_MS,
    },
    ...(asleep
      ? {
          waitUntil: new Date(Date.now() + WAIT_FOR_MACHINE_MS),
          error: `No transcript yet — waiting for ${machines}, which has not been seen recently.`,
        }
      : {}),
  });

  return asleep
    ? `No transcript yet — waiting for ${machines}, which has not been seen recently.`
    : "Transcript — a machine is working on it.";
}

/**
 * Whether a source's error line is about its transcript rather than about the
 * source itself.
 *
 * A marker in the wording rather than a column, because there is exactly one
 * `error` field and two things want to write to it. Every sentence this file
 * produces about a transcript begins with "No transcript" or "Transcript", and
 * only those may be cleared when words finally arrive — an ingest's own reason
 * ("Metadata only — the video is private") is still true afterwards and must
 * survive.
 */
function isTranscriptNote(error: string) {
  return /^(No transcript|Transcript)\b/.test(error.trim());
}

/**
 * How to install a tool nothing on this estate has.
 *
 * Read off any machine that has ever reported the tool, present or not: a
 * `ToolStatus` carries its own `install` string, so the sentence a person is
 * shown comes from the same table the probe wrote rather than from a second
 * copy of the install commands kept here and left to drift. When no machine
 * has ever heard of it there is nothing honest to say beyond its name.
 *
 * The twin of the one in services/runs.ts. Duplicated rather than shared
 * because it is six lines and the alternative is a helpers module that exists
 * to hold six lines; if a third caller appears, that is the moment to move it.
 */
async function installHint(need: string): Promise<string> {
  const workers = await listWorkers();
  for (const w of workers) {
    const tool = w.tools.find((t) => t.id === need);
    if (tool?.install) return tool.install;
  }
  return "";
}

/**
 * One more still, at a second somebody asked for.
 *
 * The eight the ingest takes are evenly spaced, which is the right default and
 * the wrong answer whenever the thing worth seeing — the address bar, the
 * result on screen — happens between two of them. Added to the row rather than
 * replacing it, in time order, so the strip stays a timeline.
 *
 * Only for uploads, now, and the message says so. A fetched link's video never
 * comes to this server — the worker uploads eight stills and a WAV and keeps
 * the four hundred megabytes on its own disk — so there is genuinely nothing
 * here to cut a ninth frame out of, and a sentence that pretended otherwise
 * would send somebody looking for a file that was never meant to exist.
 */
export async function addFrameAt(sourceId: string, at: number): Promise<Source> {
  const source = await getSource(sourceId);
  if (!source) throw new IngestError("No such source", 404);

  const dir = dirFor(sourceId);
  const files = await fs.readdir(dir).catch(() => []);
  const video = files.find((f) => f.startsWith("video."));
  if (!video) {
    throw new IngestError(
      "The video itself is not on this server — a fetched link is downloaded on the machine that ingests it, and only the stills and the audio come back. Upload the file to take extra frames from it.",
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
      `scale=-2:${FRAME_MAX_HEIGHT}`,
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

/**
 * Whether a tool is here to be run.
 *
 * Presence only. This used to AND `toolStatus(id).present` with the global
 * `settings.enabled`, and that switch is now a fact about a WORKER —
 * `workers.enabled`, evaluated by the machine against its own row. Leaving it
 * in would mean somebody switching ffmpeg off for their laptop silently
 * stopped every browser upload on the server from getting any stills, which is
 * a control doing something nobody asked it to. `ffmpeg` and `ffprobe` are
 * dependencies of the API image — they are in `api/Dockerfile` — so on this
 * side there is nothing to switch off.
 */
async function present(id: "ffmpeg" | "ffprobe") {
  return (await toolStatus(id)).present;
}

/** Evenly spaced stills, as JPEGs beside the video. */
async function cutFrames(video: string, dir: string): Promise<Frame[]> {
  if (!(await present("ffmpeg"))) return [];

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
        `scale=-2:${FRAME_MAX_HEIGHT}`,
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

/**
 * The audio, on its own, in the only format the transcriber takes.
 *
 * `-vn` drops the video, `-ac 1` mixes to mono and `-ar 16000` resamples,
 * which together are whisper.cpp's required input and, not by coincidence,
 * about a thirtieth of the bytes. Returns whether there is a file: a silent
 * screen recording with no audio track at all is a real thing people upload,
 * and it is not a failure — it is a source with no words in it, which the
 * caller says out loud rather than leaving as an empty transcript nobody can
 * explain.
 */
async function extractAudio(video: string, dir: string): Promise<boolean> {
  if (!(await present("ffmpeg"))) return false;
  const out = path.join(dir, AUDIO_FILE);
  const { code } = await run(
    "ffmpeg",
    ["-y", "-i", video, "-vn", "-ac", "1", "-ar", String(AUDIO_RATE), out],
    { timeout: 300_000 },
  );
  if (code !== 0) return false;
  // ffmpeg can exit 0 having written a header and nothing else, and a WAV with
  // no samples sent to a GPU is a minute of somebody's machine spent to
  // transcribe silence.
  const size = await fs.stat(out).then((s) => s.size).catch(() => 0);
  return size > 1024;
}

async function durationOf(video: string) {
  if (!(await present("ffprobe"))) return 0;
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
    /*
     * How many stills, and at what seconds — and deliberately NOT where they
     * are.
     *
     * This line used to end with "They are on disk under
     * .data/sources/<id>/", which is the server's own filesystem layout. Once
     * a section is written by a worker on somebody's desktop that sentence is
     * simply false: the frames were downloaded for that one call into a temp
     * directory, under a different name, on a different machine. A model told
     * to open a path that is not there does the thing `CLI_GUARD` in
     * lib/server/brains.ts exists to stop — it goes hunting, finds nothing,
     * and writes a paragraph about the failure into the script.
     *
     * The paths belong to the transport, not to the evidence. `viaClaudeCli`
     * lists them and is granted Read for the one call, `viaCodexCli` attaches
     * them with -i, `viaGeminiCli` resolves them as @ references; each already
     * names them correctly for itself, and nothing else has any business
     * naming them. Do not helpfully put a path back here.
     *
     * The wording says what was taken from the video, not what the model is
     * looking at: `write()` refuses a request with pictures a transport cannot
     * show, and the Ollama path never sees any, so a source brief that
     * promised "here are your frames" would be lying on every one of those.
     */
    source.frames.length
      ? `FRAMES: ${source.frames.length} stills were taken from the video, at ${source.frames
          .map((f) => `${f.at}s`)
          .join(", ")}.`
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
