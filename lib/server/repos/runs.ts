import type { Decision } from "@/lib/content-docs";
import { id, iso, one, q, tx } from "@/lib/server/db/client";

/**
 * Runs, and the sections under them.
 *
 * The one table pair written by the server while it works rather than by a
 * person filling in a form — a section is updated in place as it moves
 * queued -> writing -> done, so the row is the progress bar.
 */

export type SectionState = "queued" | "writing" | "done" | "failed";

export type RunSection = {
  id: string;
  title: string;
  state: SectionState;
  content: string;
  error: string;
  ms: number | null;
  /**
   * Which machine wrote it — a worker's name, or `server:api` when the
   * workspace's API-key fallback did it. Empty until something writes it.
   *
   * `createdBy` on the run only says who pressed the button. Once the writing
   * happens on somebody else's laptop, "which sections did we actually spend a
   * subscription on, and whose" has no answer anywhere else in the database.
   */
  wroteWith: string;
  /** When a person last changed this by hand. Null means the model's words. */
  editedAt: string | null;
  updatedAt: string;
};

export type Run = {
  id: string;
  workspaceId: string;
  topicId: string | null;
  packSlug: string;
  title: string;
  inputs: Record<string, string>;
  brandVoice: string;
  /** The video this run was given to watch, if it was given one. */
  sourceId: string | null;
  /** What you decided about the content: used it, ready to, ignored it. */
  decision: Decision;
  /**
   * Who pressed Run. Null for the runs made before anyone was recorded, and
   * for a run whose author has since been deleted — the work outlives them.
   */
  createdBy: string | null;
  sections: RunSection[];
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

/** Anything the column might hold, narrowed to the three the UI draws. */
const asDecision = (value: unknown): Decision =>
  value === "used" || value === "ignored" ? value : "ready";

const mapSection = (r: Row): RunSection => ({
  id: String(r.section_id),
  title: String(r.title),
  state: String(r.state ?? "queued") as SectionState,
  content: String(r.content ?? ""),
  error: String(r.error ?? ""),
  ms: r.ms == null ? null : Number(r.ms),
  wroteWith: String(r.wrote_with ?? ""),
  editedAt: r.edited_at == null ? null : iso(r.edited_at),
  updatedAt: iso(r.updated_at),
});

const mapRun = (r: Row, sections: RunSection[]): Run => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  topicId: r.topic_id == null ? null : String(r.topic_id),
  packSlug: String(r.pack_slug),
  title: String(r.title),
  inputs:
    r.inputs && typeof r.inputs === "object"
      ? (r.inputs as Record<string, string>)
      : {},
  brandVoice: String(r.brand_voice ?? ""),
  sourceId: r.source_id == null ? null : String(r.source_id),
  decision: asDecision(r.decision),
  createdBy: r.created_by == null ? null : String(r.created_by),
  sections,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export async function getRun(rid: string): Promise<Run | null> {
  const row = await one<Row>("SELECT * FROM runs WHERE id = $1", [rid]);
  if (!row) return null;
  const sections = (
    await q<Row>(
      "SELECT * FROM run_sections WHERE run_id = $1 ORDER BY position",
      [rid],
    )
  ).map(mapSection);
  return mapRun(row, sections);
}

/** Newest first. Optionally narrowed to one workspace. */
export async function listRuns(workspaceId?: string): Promise<Run[]> {
  const rows = workspaceId
    ? await q<Row>(
        "SELECT * FROM runs WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspaceId],
      )
    : await q<Row>("SELECT * FROM runs ORDER BY created_at DESC");
  if (!rows.length) return [];

  // One query for every section, grouped here — a list of thirty runs must not
  // be thirty-one round trips.
  const sections = workspaceId
    ? await q<Row>(
        `SELECT s.* FROM run_sections s
           JOIN runs r ON r.id = s.run_id
          WHERE r.workspace_id = $1
          ORDER BY s.position`,
        [workspaceId],
      )
    : await q<Row>("SELECT * FROM run_sections ORDER BY position");

  const byRun = new Map<string, RunSection[]>();
  for (const row of sections) {
    const key = String(row.run_id);
    const list = byRun.get(key) ?? [];
    list.push(mapSection(row));
    byRun.set(key, list);
  }

  return rows.map((r) => mapRun(r, byRun.get(String(r.id)) ?? []));
}

export async function createRun(patch: {
  workspaceId: string;
  topicId?: string | null;
  packSlug: string;
  title: string;
  inputs: Record<string, string>;
  brandVoice?: string;
  sourceId?: string | null;
  /** Who asked for it. Omitted only where there is no session to ask. */
  createdBy?: string | null;
  sections: { id: string; title: string }[];
}): Promise<Run> {
  const rid = id("run");

  await tx(async (c) => {
    await c.query(
      `INSERT INTO runs
         (id, workspace_id, topic_id, pack_slug, title, inputs, brand_voice,
          source_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        rid,
        patch.workspaceId,
        patch.topicId ?? null,
        patch.packSlug,
        patch.title,
        JSON.stringify(patch.inputs),
        patch.brandVoice ?? "",
        patch.sourceId ?? null,
        patch.createdBy ?? null,
      ],
    );
    for (let i = 0; i < patch.sections.length; i += 1) {
      const s = patch.sections[i];
      await c.query(
        `INSERT INTO run_sections (run_id, section_id, title, position)
         VALUES ($1, $2, $3, $4)`,
        [rid, s.id, s.title, i],
      );
    }
  });

  return (await getRun(rid))!;
}

export async function setSection(
  runId: string,
  sectionId: string,
  patch: Partial<
    Pick<RunSection, "state" | "content" | "error" | "ms" | "wroteWith">
  > & {
    /** true stamps it as hand-edited; false clears the stamp. */
    edited?: boolean;
  },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (patch.state !== undefined) set("state", patch.state);
  if (patch.content !== undefined) set("content", patch.content);
  if (patch.error !== undefined) set("error", patch.error);
  if (patch.ms !== undefined) set("ms", patch.ms);
  // Written by the result handler from the job's own worker, never from
  // anything the caller of an HTTP route could type: this column is the only
  // record of whose subscription paid for the section.
  if (patch.wroteWith !== undefined) set("wrote_with", patch.wroteWith);
  // Regenerating clears it: the words are the model's again, so saying a
  // person wrote them would be a lie the reader repeats on every visit.
  if (patch.edited === true) sets.push("edited_at = now()");
  if (patch.edited === false) sets.push("edited_at = NULL");
  if (!sets.length) return;

  sets.push("updated_at = now()");
  values.push(runId, sectionId);
  await q(
    `UPDATE run_sections SET ${sets.join(", ")}
      WHERE run_id = $${values.length - 1} AND section_id = $${values.length}`,
    values,
  );

  // The run's own timestamp follows its sections, so "last touched" on a list
  // means what it says.
  await q("UPDATE runs SET updated_at = now() WHERE id = $1", [runId]);
}

/**
 * Put every failed section back in the queue.
 *
 * What "try it again" means. A failed section is skipped for the rest of the
 * drive it died in — otherwise the loop would spend the model's time forever
 * on the one thing that does not work — so a second Run would have skipped it
 * too and finished instantly, having done nothing. Clearing the failures is
 * the difference between running again and retrying.
 *
 * Returns how many went back, so the caller can tell a retry from a start.
 */
export async function requeueFailed(rid: string) {
  const rows = await q<{ section_id: string }>(
    `UPDATE run_sections SET state = 'queued', error = '', updated_at = now()
      WHERE run_id = $1 AND state = 'failed'
      RETURNING section_id`,
    [rid],
  );
  if (rows.length) {
    await q("UPDATE runs SET updated_at = now() WHERE id = $1", [rid]);
  }
  return rows.length;
}

/**
 * Put one run's in-flight sections back in the queue, because a person said
 * stop.
 *
 * The run id is required, and that is the whole change here. This used to take
 * an optional id, and with none it swept EVERY `writing` row in the database —
 * which `resumeOrphans()` called at boot, reasoning that a writing row must be
 * dead because the process that started it was. That reasoning was true only
 * while there was exactly one process and the model was its child. It is false
 * the moment a section is being written on somebody's laptop: a deploy or a
 * crash would requeue a section a machine is four minutes into, the section
 * gets written twice, the second result overwrites the first, and both spent a
 * subscription. With two API replicas every boot steals the other's work.
 *
 * Migration 0015 swept the old `writing` rows once, and that was the last time
 * anything may do it on an assumption. What decides now is `jobs.lease_until`,
 * per job, on evidence — a lease that ran out. This function survives for the
 * one case that is not an assumption at all: `stopRun` has just cancelled this
 * run's jobs, so nothing is writing these sections any more, and saying they
 * are queued is simply the truth about them.
 */
export async function requeueWriting(runId: string) {
  const rows = await q<{ section_id: string }>(
    `UPDATE run_sections SET state = 'queued', updated_at = now()
      WHERE run_id = $1 AND state = 'writing' RETURNING section_id`,
    [runId],
  );
  if (rows.length) {
    await q("UPDATE runs SET updated_at = now() WHERE id = $1", [runId]);
  }
  return rows.length;
}

/**
 * Mark a run used, ready or ignored.
 *
 * Its own function rather than a general patch: this is the only field on a
 * run a person edits after the fact — everything else is what the run was
 * given and what it produced.
 */
export async function setRunDecision(rid: string, decision: Decision) {
  const rows = await q<Row>(
    "UPDATE runs SET decision = $1, updated_at = now() WHERE id = $2 RETURNING id",
    [decision, rid],
  );
  return rows.length > 0;
}

export async function deleteRun(rid: string) {
  const rows = await q("DELETE FROM runs WHERE id = $1 RETURNING id", [rid]);
  return rows.length > 0;
}
