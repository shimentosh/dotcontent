"use client";

import { apiFetch } from "@/lib/api-base";
import type { Run, RunSection } from "@/lib/server/repos/runs";
import type { JobWithWorker } from "@/lib/server/repos/jobs";
import { json } from "@/lib/api-json";

/**
 * The browser's half of the run API.
 *
 * Types are imported from the server's store rather than redeclared — the two
 * ends of a JSON boundary that describe the shape separately are two things
 * that can disagree, and the disagreement shows up as a blank field rather
 * than an error.
 */
export type { Run, RunSection };

/**
 * One entry from a run's queue, as `GET /runs/:id/jobs` sends it.
 *
 * The same `Pick` the controller maps to, off the same repo type, so a field
 * renamed in repos/jobs.ts breaks both ends' compile rather than emptying a
 * chip. The bulky halves — `payload`, six to eight thousand characters of
 * system prompt, and `result`, whose text is already the section — do not
 * travel; see the note beside `RunJob` in api/src/runs/runs.controller.ts.
 *
 * `workerName` is the machine holding the job, or the one it is pinned to,
 * and "" for neither. `waitUntil` is set only on a job queued behind a
 * machine that was not awake when it was enqueued, which is the one fact that
 * tells "nobody has picked this up yet" from "somebody's laptop is shut".
 */
export type RunJob = Pick<
  JobWithWorker,
  | "id"
  | "kind"
  | "state"
  | "sectionId"
  | "workerName"
  | "workerLive"
  | "error"
  | "attempts"
  | "maxAttempts"
  | "waitUntil"
  | "createdAt"
>;

export const createRun = (body: {
  workspaceId: string;
  topicId?: string | null;
  /** A downloaded reel for the pack to work from, when there is one. */
  sourceId?: string | null;
  packSlug?: string;
  inputs: Record<string, string>;
  title?: string;
}) =>
  apiFetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<Run>(r));

export const getRun = (id: string) =>
  apiFetch(`/api/runs/${id}`, { cache: "no-store" }).then((r) => json<Run>(r));

export const listRuns = (workspaceId?: string) =>
  apiFetch(`/api/runs${workspaceId ? `?workspaceId=${workspaceId}` : ""}`, { cache: "no-store" }).then((r) => json<Run[]>(r));

/** Mark a run used, ready or ignored. */
export const setRunDecision = (id: string, decision: Run["decision"]) =>
  apiFetch(`/api/runs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  }).then((r) => json<{ id: string; decision: string }>(r));

/** Delete a run and everything written into it. The topic stays. */
export const deleteRun = (id: string) =>
  apiFetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) =>
    json<{ ok: boolean }>(r),
  );

/**
 * What `advance` did on the server, section by section.
 *
 * This is the immediate answer to one press of one button, and nothing more:
 * it says what that press did, right then, in this tab. It used to be more
 * than that — the machine names in `waiting` were held in a hook because they
 * were the ONLY place a machine's name reached the browser, which meant a name
 * appeared solely for whoever pressed "Write the rest" and never for a
 * colleague opening the same run, or for a single-section write. `RunJob`
 * carries that now, for every section, however the run was started. Nothing
 * needs to hold this any more.
 *
 * Kept as the service returns it so the shapes cannot drift apart.
 */
export type AdvanceReport = {
  /** Sections that now have a job a live machine can claim. */
  enqueued: string[];
  /** Sections queued behind a machine that has not been seen lately. */
  waiting: { sectionId: string; machine: string }[];
  /** Sections no machine on this estate can ever write. Already failed. */
  unroutable: string[];
  /** Sections the server is writing itself, on the workspace's API key. */
  onApi: string[];
};

/**
 * Start the run: queue everything that is ready, and return at once.
 *
 * Nothing is written by the time this resolves — the sections are jobs now,
 * picked up by whichever machine holds the CLI. The page follows the run by
 * reading it, the same way it reads anything else.
 *
 * This is also Retry: the server puts failed sections back in the queue before
 * it advances, and `retried` says how many went back, so a caller can tell a
 * retry from a plain start.
 */
export const startWriting = (runId: string) =>
  apiFetch(`/api/runs/${runId}/start`, { method: "POST" }).then((r) =>
    json<
      { started: boolean; running: boolean; retried: number } & AdvanceReport
    >(r),
  );

/**
 * This run's queue: every job it has ever had, oldest first, with its machine.
 *
 * It answers everything `GET /runs/:id/start` did and then the questions that
 * had no answer at all. "Is anything on the queue for this run, anywhere?" is
 * `state` being `queued` or `claimed` on any entry here — which is literally
 * how the server computed that boolean — so the run page's poll swaps one
 * request for the other rather than growing a second timer.
 *
 * What it adds: which machine is holding a section right now (`run_sections`
 * records `wroteWith` only on success, so mid-flight there was no name to
 * show), and `unroutable` as a state rather than as a sentence the page had to
 * match with a regex.
 */
export const listRunJobs = (runId: string) =>
  apiFetch(`/api/runs/${runId}/jobs`, { cache: "no-store" }).then((r) =>
    json<RunJob[]>(r),
  );

/**
 * Stop a run that is writing.
 *
 * Queued jobs stop being work immediately; a machine already running one finds
 * out at its next heartbeat and kills the child process, so `stopped` counts
 * jobs cancelled rather than processes already dead.
 */
export const stopRun = (runId: string) =>
  apiFetch(`/api/runs/${runId}/stop`, { method: "POST" }).then((r) =>
    json<{ ok: boolean; stopped: number; requeued: number }>(r),
  );

/**
 * Ask for one section to be written.
 *
 * It queues; it does not write. This used to resolve with the section
 * finished, because the model was a child process of the request — awaiting it
 * now waits for a database write and gets back a run whose section says
 * `writing`, with the text still minutes away on somebody else's laptop.
 *
 * The whole run comes back rather than the one row because queueing a section
 * runs `advance`, which may queue everything else that has just become ready,
 * and because a section changing state changes what the rest of the page may
 * do.
 */
export const queueSection = (runId: string, sectionId: string) =>
  apiFetch(`/api/runs/${runId}/sections/${sectionId}`, { method: "POST" }).then(
    (r) => json<Run>(r),
  );

/**
 * Save what a person typed into a section.
 *
 * Returns the whole run for the same reason `queueSection` does: an edit can
 * change whether the run reads as finished, and the page should not have to
 * work that out from a single row.
 */
export const editSection = (
  runId: string,
  sectionId: string,
  content: string,
) =>
  apiFetch(`/api/runs/${runId}/sections/${sectionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).then((r) => json<Run>(r));
