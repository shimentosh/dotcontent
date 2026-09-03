"use client";

import { apiFetch, api } from "@/lib/api-base";
import type { Source } from "@/lib/server/repos/sources";
import { json } from "@/lib/api-json";

/**
 * The browser's half of the source API.
 *
 * Types come from the server's own store rather than being redeclared — two
 * descriptions of one JSON boundary are two things that can disagree, and the
 * disagreement shows up as a blank field rather than an error.
 */
export type { Source };

/**
 * Fetch a reel.
 *
 * Slow on purpose — the request holds while yt-dlp downloads, ffmpeg cuts
 * stills and a transcriber runs. Whoever calls this needs a spinner, not a
 * timeout.
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
