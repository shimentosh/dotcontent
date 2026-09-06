"use client";

import { apiFetch, api } from "@/lib/api-base";
import type { Source, SourceState } from "@/lib/server/repos/sources";
import { json } from "@/lib/api-json";

/**
 * The browser's half of the source API.
 *
 * Types come from the server's own store rather than being redeclared — two
 * descriptions of one JSON boundary are two things that can disagree, and the
 * disagreement shows up as a blank field rather than an error.
 */
export type { Source, SourceState };

/**
 * Ask for a link to be fetched. Answers immediately, with nothing on it yet.
 *
 * It used to hold for minutes while yt-dlp downloaded, ffmpeg cut stills and
 * whisper ran in the API process, and came back with the finished article. It
 * does not any more: `ingest()` writes an `ingest_source` job and returns a row
 * in `fetching` with empty `frames` and an empty `transcript`, because the
 * tools live on whichever teammate's machine has them (docs/WORKER.md).
 *
 * **Rendering this answer as the result is the empty-frame-picker bug.** Every
 * caller wants `fetchSourceToEnd` below, which follows the job to its end. This
 * stays exported for the one thing that genuinely only queues.
 */
export const fetchSource = (body: {
  url: string;
  workspaceId?: string | null;
  refresh?: boolean;
}) =>
  apiFetch("/api/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<Source>(r));

export const getSource = (id: string) =>
  apiFetch(`/api/sources/${id}`, { cache: "no-store" }).then((r) => json<Source>(r));

export const listSources = (workspaceId?: string) =>
  apiFetch(`/api/sources${workspaceId ? `?workspaceId=${workspaceId}` : ""}`, {
    cache: "no-store",
  }).then((r) => json<Source[]>(r));

/**
 * Forget a video: the row, the frames, and what the researcher made of it.
 *
 * The download itself is on disk under `.data/sources`; this removes the
 * record, which is what the history is a list of.
 */
export const removeSource = (id: string) =>
  apiFetch(`/api/sources/${id}`, { method: "DELETE" }).then((r) =>
    json<{ ok: boolean }>(r),
  );

export const frameUrl = (sourceId: string, file: string) =>
  api(`/api/sources/${sourceId}/frames/${file}`);

/* ── following a fetch to its end ─────────────────────────────────────────
 *
 * One copy of the poll, here rather than in each screen. The researcher and
 * the run sheet want exactly the same thing — a row that has stopped moving —
 * and two copies of a loop with a give-up window and a backoff in it is two
 * places for one of them to be missed.
 */

/**
 * How often to ask, and it is not one speed.
 *
 * A source is `fetching` both while a machine is running yt-dlp and while it
 * sits on the queue behind a laptop nobody has opened, and those are seconds
 * and hours respectively. So: briskly at first, when a fetch that was claimed
 * straight away is about to land; steadily after that; and patiently once the
 * row has said nothing new for a while, because asking every two seconds about
 * a shut laptop is a hot spin against the API for a fact that will not change
 * before somebody walks back to their desk. The same reasoning as `PACE` in
 * lib/use-run-watch.ts, which follows the same queue.
 */
const PACE = { quick: 2000, steady: 5000, patient: 15000 } as const;

/** How long the brisk cadence lasts before the steady one takes over. */
const QUICK_FOR_MS = 30_000;

/** How long a row has to say nothing new before the patient cadence starts. */
const PATIENT_AFTER_MS = 180_000;

/**
 * When to stop waiting, and say so.
 *
 * A fetch can honestly take a long time: `ingest()` gives a job fifteen minutes
 * to wait for a capable machine that is switched off, and the worker gets
 * fifteen more (`INGEST_TIMEOUT_MS`) to actually run it. Thirty minutes is
 * therefore a legitimate wait, and giving up at five would put "failed" on
 * something that was about to work — the worse of the two mistakes.
 *
 * Past that the server itself has failed the job, so a row still moving here is
 * a row nothing is going to move: the reaper is not running, or this tab has
 * been asleep in a background window. Ending with a sentence beats a spinner
 * that outlives the tab.
 */
const GIVE_UP_MS = 35 * 60_000;

/** Backoff for a poll that could not reach the API, and its ceiling. */
const RETRY_FLOOR = 4000;
const RETRY_CEILING = 30_000;

/**
 * How many polls in a row may fail before the wait is called off.
 *
 * At the backoff above that is about a minute and a half of an API that cannot
 * be reached. A blip is survived; a dev server that was stopped is reported,
 * rather than being polled at until the give-up window runs out.
 */
const MAX_FAILURES = 6;

/** A source that has not reached a state a person can act on. */
export const isMoving = (source: Source) =>
  source.state === "queued" || source.state === "fetching";

/**
 * The error a caller gets when it stopped the wait itself.
 *
 * Named `AbortError` so a screen can tell "the person pressed Stop waiting, or
 * left the tool" from "the fetch failed", and show nothing rather than a red
 * banner about something they asked for.
 */
const stopped = () => {
  const e = new Error("Stopped waiting for this fetch");
  e.name = "AbortError";
  return e;
};

/** Whether a rejection is that, rather than a real failure worth showing. */
export const isStopped = (e: unknown) =>
  e instanceof Error && e.name === "AbortError";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(stopped());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(stopped());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Watch one source until it stops moving.
 *
 * Resolves with the row as it finally stands — `ready` or `failed`, both of
 * which are answers. It does not throw on `failed`: "no machine here has
 * yt-dlp, install it with …" is the most useful thing this feature can say,
 * and it arrives on the row rather than as an exception.
 *
 * It throws for the two things that are not answers: the wait was called off,
 * and the wait ran out.
 */
export async function followSource(
  first: Source,
  onStep?: (source: Source) => void,
  signal?: AbortSignal,
): Promise<Source> {
  let current = first;
  const startedAt = Date.now();
  let quietSince = startedAt;
  let failures = 0;

  while (isMoving(current)) {
    const now = Date.now();
    if (now - startedAt > GIVE_UP_MS) {
      throw new Error(
        `This is still fetching after ${Math.round(GIVE_UP_MS / 60_000)} minutes, so this screen has stopped waiting. The job is on the queue on the server — press Fetch again to pick it up where it got to.`,
      );
    }

    const pace =
      now - startedAt < QUICK_FOR_MS
        ? PACE.quick
        : now - quietSince > PATIENT_AFTER_MS
          ? PACE.patient
          : PACE.steady;
    await sleep(pace, signal);

    try {
      const next = await getSource(current.id);
      failures = 0;
      // "Nothing new" is the row saying the same thing again — the state and
      // the sentence on it are the whole of what a person would see change.
      if (next.state !== current.state || next.error !== current.error) {
        quietSince = Date.now();
      }
      current = next;
      onStep?.(next);
    } catch (e) {
      if (isStopped(e)) throw e;
      failures += 1;
      if (failures >= MAX_FAILURES) {
        throw new Error(
          "Lost contact with the API while waiting for this fetch. It is still queued on the server — press Fetch again once the API is back.",
        );
      }
      await sleep(
        Math.min(RETRY_CEILING, RETRY_FLOOR * 2 ** (failures - 1)),
        signal,
      );
    }
  }

  return current;
}

/**
 * Ask for a link, then follow it until it is ready or failed.
 *
 * What both screens call instead of `fetchSource`. `onStep` is handed every
 * version of the row as it arrives, so the screen can render the source's own
 * sentence — "Waiting for Shakhawat's desktop, which has not been seen
 * recently." — rather than a spinner that says nothing.
 *
 * A link that was already fetched comes back `ready` from the POST and this
 * polls exactly zero times, which is also what an upload would do: only a row
 * that is genuinely still moving is followed.
 */
export async function fetchSourceToEnd(
  body: { url: string; workspaceId?: string | null; refresh?: boolean },
  onStep?: (source: Source) => void,
  signal?: AbortSignal,
): Promise<Source> {
  const queued = await fetchSource(body);
  onStep?.(queued);
  return followSource(queued, onStep, signal);
}

/* ── what the row is saying ───────────────────────────────────────────────
 *
 * A source has one `error` column and two things write to it: the ingest, and
 * the transcription that follows it. The server marks the difference in the
 * wording — every sentence about a transcript begins "No transcript" or
 * "Transcript" (`isTranscriptNote` in lib/server/services/ingest.ts) — so these
 * read the same marker rather than inventing a second rule. Keep them in step
 * with that function; it is the one that writes the sentences.
 */

/** A line about the transcript rather than about the source itself. */
const TRANSCRIPT_NOTE = /^(No transcript|Transcript)\b/;

/**
 * A line saying the words are on their way: a machine is running whisper, or
 * one will when its owner opens it. Both of the server's "still coming"
 * sentences, and neither of its terminal ones.
 */
const TRANSCRIPT_COMING = /^(Transcript\b|No transcript yet\b)/;

/**
 * Where the words are: here, coming, or not coming.
 *
 * `transcribe_audio` is its own job on its own machine, so a source is
 * routinely `ready` and worth reading with no transcript on it yet. A screen
 * that prints "no transcript" for that is reporting a failure that has not
 * happened, over a video whose frames are right there.
 */
export type TranscriptState = "here" | "coming" | "none";

export function transcriptState(source: Source): TranscriptState {
  if (source.transcript.trim()) return "here";
  return TRANSCRIPT_COMING.test(source.error.trim()) ? "coming" : "none";
}

/** The source's own bad news, if any — never a transcript note. */
export function sourceProblem(source: Source): string {
  const line = source.error.trim();
  return line && !TRANSCRIPT_NOTE.test(line) ? line : "";
}

/** The note about the transcript, if any — never the source's own bad news. */
export function transcriptNote(source: Source): string {
  const line = source.error.trim();
  return TRANSCRIPT_NOTE.test(line) ? line : "";
}

/**
 * What to say while a fetch is still moving, in the row's own words.
 *
 * `ingest()` leaves "Waiting for <machine>, which has not been seen recently."
 * on a source queued behind a laptop that is shut, and that sentence is the
 * answer to "why has this not moved" — a generic spinner throws it away. When
 * there is no sentence the job is ordinarily queued, which has nothing to say
 * beyond where the work happens.
 */
export function fetchingLine(source: Source): string {
  return (
    sourceProblem(source) ||
    "On the queue for a machine with yt-dlp. The download, the stills and the audio all happen there — minutes, not seconds."
  );
}
