"use client";

import { apiFetch } from "@/lib/api-base";
import type { StoredTool, ToolPatch } from "@/lib/server/repos/tools";
import type { ResearchResult } from "@/lib/server/services/researcher";
import type { Source } from "@/lib/server/repos/sources";
import { json } from "@/lib/api-json";

/**
 * The browser's half of the tool bench, and of the researcher that runs on it.
 *
 * Types come from the server's own modules rather than being redeclared here:
 * two descriptions of one JSON boundary are two things that can disagree, and
 * the disagreement shows up as a blank field rather than as an error.
 */
export type { StoredTool, ToolPatch, ResearchResult };

/** Every tool and where it is assigned — what the manage screen reads. */
export const listAllTools = () =>
  apiFetch("/api/tools", { cache: "no-store" }).then((r) => json<StoredTool[]>(r));

/** One workspace's bench: enabled, and allowed here. */
export const listTools = (workspaceId: string) =>
  apiFetch(`/api/tools?workspace=${encodeURIComponent(workspaceId)}`, {
    cache: "no-store",
  }).then((r) => json<StoredTool[]>(r));

export const patchTool = (slug: string, patch: ToolPatch) =>
  apiFetch(`/api/tools/${slug}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => json<StoredTool>(r));

/**
 * Upload a video off this machine.
 *
 * Holds while ffmpeg cuts the stills and whisper writes the transcript, the
 * same as fetching a link does. Whoever calls it needs a spinner.
 */
export const uploadSource = (file: File, workspaceId?: string | null) => {
  const form = new FormData();
  form.append("file", file);
  if (workspaceId) form.append("workspaceId", workspaceId);
  return apiFetch("/api/sources/upload", { method: "POST", body: form }).then((r) =>
    json<Source>(r),
  );
};

/** One more still, at a second the person asked for. */
export const addFrame = (sourceId: string, at: number) =>
  apiFetch(`/api/sources/${sourceId}/frames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ at }),
  }).then((r) => json<Source>(r));

/** Read the chosen frames, and hand back what the video is about. */
export const runResearch = (body: {
  sourceId: string;
  frames?: string[];
  note?: string;
}) =>
  apiFetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<ResearchResult>(r));

/** Save ideas onto a shelf, as topics. */
export const addTopics = (
  seriesId: string,
  topics: { name: string; context?: string }[],
) =>
  apiFetch(`/api/series/${seriesId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topics }),
  }).then((r) =>
    json<{ added: { id: string; name: string }[]; skipped: string[] }>(r),
  );
