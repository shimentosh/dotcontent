/**
 * The shapes the server sends and the shapes it expects back.
 *
 * Written out here rather than imported from `lib/server/services/*` on
 * purpose: those modules reach the database on import, and a sidecar on
 * somebody's desktop has no database and must never look like it wants one.
 * These are the payloads documented in `docs/WORKER.md` and built by
 * `payloadFor()` in services/runs.ts and `ingest()` in services/ingest.ts; if
 * one of those changes shape, this is the file that has to move with it.
 *
 * The worker is opaque to everything else in a payload. There is no pack here,
 * no rule, no dependency graph and no brand voice, because the server has
 * already resolved all of it — a job carries finished text and a command.
 */

export type Transport = "cli" | "api";

/**
 * How a job's own process hands its answer back.
 *
 * It lives here, in a module with nothing but types and constants in it,
 * because the supervisor needs the same string the executor writes — and
 * importing it from `executor.ts` would run that file's `main()` inside the
 * supervisor, which would sit there reading a stdin that never ends.
 *
 * Long enough that no CLI, progress bar or stack trace says it by accident:
 * whatever follows the LAST one of these on stdout is the answer, and being
 * wrong about that means posting a progress bar as somebody's section.
 */
export const RESULT_MARK = "<<DOTCONTENT-JOB-RESULT>>";

export type FrameRef = { url: string; at: number };

export type WritePayload = {
  brain: string;
  transport: Transport;
  system: string;
  user: string;
  tier: string;
  timeoutMs?: number;
  frames?: FrameRef[];
  allowFrameRead?: boolean;
};

export type TestPayload = {
  brain: string;
  transport: Transport;
  system: string;
  user: string;
  tier: string;
  timeoutMs?: number;
};

export type IngestPayload = {
  sourceId: string;
  url: string;
  refresh?: boolean;
  frameCount: number;
  maxHeight: number;
  audioRate: number;
  audioFile: string;
  timeoutMs?: number;
  uploadFrames: string;
  uploadAudio: string;
};

export type TranscribePayload = {
  sourceId: string;
  audioUrl: string;
  model: string;
  timeoutMs?: number;
};

/**
 * A failure this machine is sure about.
 *
 * `retryable: false` is a claim, not a mood: it says the next machine will
 * fail identically — a refusal, a payload naming a transport this worker
 * cannot honour, a tool that is not installed. Everything else is thrown as an
 * ordinary Error and retried once, because the failures that actually recur
 * are the closed laptop and the dropped connection.
 */
export class Refusal extends Error {
  readonly retryable = false;
}

/** What comes back from a handler: the result body the server stores. */
export type JobResult = Record<string, unknown>;
