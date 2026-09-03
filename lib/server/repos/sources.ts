import { id, iso, one, q } from "@/lib/server/db/client";
// A type, so this is erased: the researcher reads sources, and the two would
// otherwise import each other at runtime.
import type { ResearchResult } from "@/lib/server/services/researcher";

/**
 * Source videos — a reel or a short the pack is meant to have watched.
 *
 * The row is the record of what came out of the download, kept so a rewrite
 * does not pull the video again: yt-dlp, ffmpeg and a transcriber cost real
 * seconds and real bandwidth, and the answer does not change.
 */

export type SourceState = "queued" | "fetching" | "ready" | "failed";

export type Frame = {
  /** Seconds into the video. */
  at: number;
  /** Path under .data/frames, served back through the API. */
  file: string;
};

export type Source = {
  id: string;
  workspaceId: string | null;
  /** A link, or `file:<id>` for something uploaded from a machine. */
  url: string;
  /** Where it came from: a platform, or a file somebody had. */
  kind: "url" | "file";
  /** What the uploaded file was called, so the screen can say. */
  filename: string;
  state: SourceState;
  error: string;
  title: string;
  uploader: string;
  description: string;
  duration: number | null;
  thumbnail: string;
  transcript: string;
  frames: Frame[];
  /**
   * The last thing the researcher made of this video, or nothing.
   *
   * Kept on the row so the tool has a history: the answer used to live in one
   * browser tab and die with it. Researching again replaces it — one video,
   * one current reading of it.
   */
  research: ResearchResult | null;
  researchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const map = (r: Row): Source => ({
  id: String(r.id),
  workspaceId: r.workspace_id == null ? null : String(r.workspace_id),
  url: String(r.url),
  kind: r.kind === "file" ? "file" : "url",
  filename: String(r.filename ?? ""),
  state: String(r.state ?? "queued") as SourceState,
  error: String(r.error ?? ""),
  title: String(r.title ?? ""),
  uploader: String(r.uploader ?? ""),
  description: String(r.description ?? ""),
  duration: r.duration == null ? null : Number(r.duration),
  thumbnail: String(r.thumbnail ?? ""),
  transcript: String(r.transcript ?? ""),
  frames: Array.isArray(r.frames) ? (r.frames as Frame[]) : [],
  // '{}' is the column's default, which is "never researched" rather than an
  // answer with every field empty.
  research:
    r.research && Object.keys(r.research).length
      ? (r.research as ResearchResult)
      : null,
  researchedAt: r.researched_at ? iso(r.researched_at) : null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export async function getSource(sid: string): Promise<Source | null> {
  const row = await one<Row>("SELECT * FROM sources WHERE id = $1", [sid]);
  return row ? map(row) : null;
}

export async function listSources(workspaceId?: string): Promise<Source[]> {
  const rows = workspaceId
    ? await q<Row>(
        "SELECT * FROM sources WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspaceId],
      )
    : await q<Row>("SELECT * FROM sources ORDER BY created_at DESC");
  return rows.map(map);
}

/**
 * The same URL in the same workspace is the same source.
 *
 * Pasting a link twice is how you get two downloads of one reel, and the
 * second tells you nothing the first did not.
 */
export async function findByUrl(url: string, workspaceId: string | null) {
  const row = await one<Row>(
    workspaceId
      ? "SELECT * FROM sources WHERE url = $1 AND workspace_id = $2"
      : "SELECT * FROM sources WHERE url = $1 AND workspace_id IS NULL",
    workspaceId ? [url, workspaceId] : [url],
  );
  return row ? map(row) : null;
}

export async function createSource(patch: {
  url: string;
  workspaceId?: string | null;
  kind?: "url" | "file";
  filename?: string;
}): Promise<Source> {
  const row = await one<Row>(
    `INSERT INTO sources (id, workspace_id, url, kind, filename)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      id("src"),
      patch.workspaceId ?? null,
      patch.url,
      patch.kind ?? "url",
      patch.filename ?? "",
    ],
  );
  return map(row!);
}

export async function updateSource(
  sid: string,
  patch: Partial<
    Pick<
      Source,
      | "state"
      | "error"
      | "title"
      | "uploader"
      | "description"
      | "duration"
      | "thumbnail"
      | "transcript"
      | "frames"
      | "filename"
      | "research"
    >
  > & { meta?: unknown },
): Promise<Source | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${col} = $${values.length}${cast}`);
  };

  if (patch.state !== undefined) set("state", patch.state);
  if (patch.error !== undefined) set("error", patch.error);
  if (patch.title !== undefined) set("title", patch.title);
  if (patch.uploader !== undefined) set("uploader", patch.uploader);
  if (patch.description !== undefined) set("description", patch.description);
  if (patch.duration !== undefined) set("duration", patch.duration);
  if (patch.thumbnail !== undefined) set("thumbnail", patch.thumbnail);
  if (patch.transcript !== undefined) set("transcript", patch.transcript);
  if (patch.filename !== undefined) set("filename", patch.filename);
  if (patch.frames !== undefined)
    set("frames", JSON.stringify(patch.frames), "::jsonb");
  if (patch.research !== undefined) {
    set("research", JSON.stringify(patch.research ?? {}), "::jsonb");
    // Its own clock: `updated_at` moves when a frame is cut, and "researched
    // 20 minutes ago" must not become "researched just now" because a still
    // was added afterwards.
    sets.push("researched_at = now()");
  }
  if (patch.meta !== undefined) set("meta", JSON.stringify(patch.meta), "::jsonb");
  if (!sets.length) return getSource(sid);

  sets.push("updated_at = now()");
  values.push(sid);
  const row = await one<Row>(
    `UPDATE sources SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return row ? map(row) : null;
}

export async function deleteSource(sid: string) {
  const rows = await q("DELETE FROM sources WHERE id = $1 RETURNING id", [sid]);
  return rows.length > 0;
}
