"use client";

import { apiFetch } from "@/lib/api-base";
import type { Run, RunSection } from "@/lib/server/repos/runs";
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
 * The three outcomes are genuinely different sentences on the page, and the
 * only place two of them reach the browser at all: a job queued behind a
 * machine that is asleep carries the machine's NAME here and nowhere in the
 * run row, and an unroutable section is a missing install rather than a model
 * that refused. Keep the shapes as the service returns them.
 */
export type AdvanceReport = {
  /** Sections that now have a job a live machine can claim. */
  enqueued: string[];
  /** Sections queued behind a machine that has not been seen lately. */
  waiting: { sectionId: string; machine: string }[];
  /** Sections no machine on this estate can ever write. Already failed. */
  unroutable: string[];
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
 * Is anything on the queue for this run — anywhere, on anyone's machine?
 *
 * True for a job that is merely queued as well as one a machine is holding, so
 * it is "this run is not finished with" rather than "a model is talking right
 * now". The two are told apart by looking at which sections say `writing`.
 */
export const isWriting = (runId: string) =>
  apiFetch(`/api/runs/${runId}/start`, { cache: "no-store" }).then((r) =>
    json<{ running: boolean }>(r),
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
