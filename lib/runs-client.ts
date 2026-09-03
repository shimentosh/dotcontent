"use client";

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
  fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<Run>(r));

export const getRun = (id: string) =>
  fetch(`/api/runs/${id}`, { cache: "no-store" }).then((r) => json<Run>(r));

export const listRuns = (workspaceId?: string) =>
  fetch(`/api/runs${workspaceId ? `?workspaceId=${workspaceId}` : ""}`, { cache: "no-store" }).then((r) => json<Run[]>(r));

/** Mark a run used, ready or ignored. */
export const setRunDecision = (id: string, decision: Run["decision"]) =>
  fetch(`/api/runs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  }).then((r) => json<{ id: string; decision: string }>(r));

/** Delete a run and everything written into it. The topic stays. */
export const deleteRun = (id: string) =>
  fetch(`/api/runs/${id}`, { method: "DELETE" }).then((r) =>
    json<{ ok: boolean }>(r),
  );

/**
 * Write one section.
 *
 * Resolves with the whole run rather than the section: a section finishing
 * changes what the rest of the page may now do, and returning only the one row
 * makes the caller stitch state back together by hand.
 */
/**
 * Write the whole run, server-side.
 *
 * Returns as soon as the loop starts, not when the run finishes — the page
 * follows it by reading the run, the same way it reads anything else.
 *
 * This is also Retry: the server puts failed sections back in the queue before
 * it drives, and `retried` says how many went back, so a caller can tell a
 * retry from a plain start.
 */
export const startWriting = (runId: string) =>
  fetch(`/api/runs/${runId}/start`, { method: "POST" }).then((r) =>
    json<{ started: boolean; running: boolean; retried: number }>(r),
  );

/** Is this run being written right now, by anyone? */
export const isWriting = (runId: string) =>
  fetch(`/api/runs/${runId}/start`, { cache: "no-store" }).then((r) =>
    json<{ running: boolean }>(r),
  );

export const writeSection = (runId: string, sectionId: string) =>
  fetch(`/api/runs/${runId}/sections/${sectionId}`, { method: "POST" }).then(
    (r) => json<Run>(r),
  );

/**
 * Save what a person typed into a section.
 *
 * Returns the whole run for the same reason `writeSection` does: an edit can
 * change whether the run reads as finished, and the page should not have to
 * work that out from a single row.
 */
export const editSection = (
  runId: string,
  sectionId: string,
  content: string,
) =>
  fetch(`/api/runs/${runId}/sections/${sectionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).then((r) => json<Run>(r));
