import { findSame, normalizeName, partitionNew } from "@/lib/dedupe";
import type { PoolClient } from "pg";

import type { FetchedSource } from "@/lib/server/services/webfetch";
import { id, iso, one, q, tx } from "@/lib/server/db/client";

/**
 * Series and the topics on them.
 *
 * One file because they are never useful apart: every read of a series wants
 * its topics, and every topic written moves the series' counter.
 */

/**
 * A name that is already taken.
 *
 * Carries the thing that has it, so the screen can offer to open that instead
 * of only saying no. `status` is what `caught()` turns into the response code.
 */
export class DuplicateName extends Error {
  readonly status = 409;
  constructor(
    readonly kind: "series" | "topic",
    readonly existing: { id: string; name: string },
  ) {
    super(`“${existing.name}” already exists`);
    this.name = "DuplicateName";
  }
}

/**
 * Hold the name for the rest of the transaction.
 *
 * Checking and then inserting is two steps, and two requests can sit between
 * them — which is one of the ways three shelves ended up with one name. An
 * advisory lock keyed on the workspace and the normalized name serialises
 * exactly the pair of requests that could collide, and nothing else.
 */
async function holdName(c: PoolClient, scope: string, name: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `${scope}:${normalizeName(name)}`,
  ]);
}

export type Topic = {
  id: string;
  seriesId: string;
  name: string;
  part: number | null;
  context: string;
  /** Where the topic is in its life: idea, generating, done. */
  status: string;
  /**
   * What you decided about it: used, ready, ignored.
   *
   * A separate axis from `status`, which is why it is a separate column — a
   * topic can be done and ignored, or an idea you already know you want.
   */
  decision: string;
  createdAt: string;
  updatedAt: string;
};

export type Series = {
  id: string;
  workspaceId: string;
  name: string;
  context: string;
  pack: string;
  /**
   * Whether topics on this shelf get a part number.
   *
   * Off for a series that is a pile of ideas rather than a run: stamping
   * "part 3" on one of those is a promise about a part 2 nobody wrote.
   */
  numbered: boolean;
  /**
   * The word in front of the number: Part, Episode, Day, Tip.
   *
   * Empty is allowed and means the number stands alone, for a shelf that
   * counts without naming what it is counting.
   */
  partLabel: string;
  /**
   * Which tab the brief is written on: typed by hand, or read off the web.
   *
   * The typed text is never thrown away when a source is attached — switching
   * back has to give you your own words, not an empty box.
   */
  briefFrom: "typed" | "link" | "feed";
  /** What the last fetch brought back, whole. Null until one happens. */
  source: FetchedSource | null;
  nextPart: number;
  position: number;
  topics: Topic[];
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const mapTopic = (r: Row): Topic => ({
  id: String(r.id),
  seriesId: String(r.series_id),
  name: String(r.name),
  part: r.part == null ? null : Number(r.part),
  context: String(r.context ?? ""),
  status: String(r.status ?? "idea"),
  decision: String(r.decision ?? "ready"),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const mapSeries = (r: Row, topics: Topic[]): Series => ({
  id: String(r.id),
  workspaceId: String(r.workspace_id),
  name: String(r.name),
  context: String(r.context ?? ""),
  pack: String(r.pack ?? ""),
  numbered: r.numbered !== false,
  partLabel: r.part_label == null ? "Part" : String(r.part_label),
  briefFrom:
    r.brief_from === "link" || r.brief_from === "feed"
      ? r.brief_from
      : "typed",
  source: (r.source as FetchedSource | null) ?? null,
  nextPart: Number(r.next_part ?? 1),
  position: Number(r.position ?? 0),
  topics,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/**
 * Every series in a workspace, with its topics.
 *
 * Two queries and a group, not one per series: a workspace with a dozen
 * shelves would otherwise be a dozen round trips to render one page.
 */
export async function listSeries(workspaceId: string): Promise<Series[]> {
  const rows = await q<Row>(
    "SELECT * FROM series WHERE workspace_id = $1 ORDER BY position, created_at",
    [workspaceId],
  );
  if (!rows.length) return [];

  const topics = await q<Row>(
    `SELECT t.* FROM topics t
       JOIN series s ON s.id = t.series_id
      WHERE s.workspace_id = $1
      ORDER BY t.created_at`,
    [workspaceId],
  );

  const bySeries = new Map<string, Topic[]>();
  for (const row of topics) {
    const topic = mapTopic(row);
    const list = bySeries.get(topic.seriesId) ?? [];
    list.push(topic);
    bySeries.set(topic.seriesId, list);
  }

  return rows.map((r) => mapSeries(r, bySeries.get(String(r.id)) ?? []));
}

export async function getSeries(sid: string): Promise<Series | null> {
  const row = await one<Row>("SELECT * FROM series WHERE id = $1", [sid]);
  if (!row) return null;
  const topics = (
    await q<Row>("SELECT * FROM topics WHERE series_id = $1 ORDER BY created_at", [
      sid,
    ])
  ).map(mapTopic);
  return mapSeries(row, topics);
}

export async function createSeries(patch: {
  workspaceId: string;
  name: string;
  context?: string;
  pack?: string;
  numbered?: boolean;
  partLabel?: string;
  nextPart?: number;
}): Promise<Series> {
  return tx(async (c) => {
    await holdName(c, patch.workspaceId, patch.name);

    /*
     * The rule lives here, not only in the dialog that asks for the name.
     * A check the screen does is a courtesy — it can be raced, scripted past,
     * or simply not written on the next screen that adds a series.
     */
    const taken = await c.query<{ id: string; name: string }>(
      "SELECT id, name FROM series WHERE workspace_id = $1",
      [patch.workspaceId],
    );
    const clash = findSame(patch.name, taken.rows);
    if (clash) throw new DuplicateName("series", clash);

    const row = await c.query<Row>(
      `INSERT INTO series
         (id, workspace_id, name, context, pack, numbered, part_label, next_part, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               (SELECT COALESCE(MAX(position), -1) + 1 FROM series WHERE workspace_id = $2))
       RETURNING *`,
      [
        id("ser"),
        patch.workspaceId,
        patch.name,
        patch.context ?? "",
        patch.pack ?? "",
        patch.numbered ?? true,
        patch.partLabel ?? "Part",
        patch.nextPart ?? 1,
      ],
    );
    return mapSeries(row.rows[0], []);
  });
}

export async function updateSeries(
  sid: string,
  patch: Partial<
    Pick<
      Series,
      | "name"
      | "context"
      | "pack"
      | "numbered"
      | "partLabel"
      | "briefFrom"
      | "source"
      | "nextPart"
      | "position"
    >
  >,
): Promise<Series | null> {
  /*
   * A rename is a create with the row already there: "Business" typed into
   * the second shelf's name is the same collision as making a second Business,
   * and the only difference is which screen it came from.
   */
  if (patch.name !== undefined) {
    const mine = await one<{ workspace_id: string }>(
      "SELECT workspace_id FROM series WHERE id = $1",
      [sid],
    );
    if (mine) {
      const taken = await q<{ id: string; name: string }>(
        "SELECT id, name FROM series WHERE workspace_id = $1 AND id <> $2",
        [mine.workspace_id, sid],
      );
      const clash = findSame(patch.name, taken);
      if (clash) throw new DuplicateName("series", clash);
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.context !== undefined) set("context", patch.context);
  if (patch.pack !== undefined) set("pack", patch.pack);
  if (patch.numbered !== undefined) set("numbered", patch.numbered);
  if (patch.partLabel !== undefined) set("part_label", patch.partLabel);
  if (patch.briefFrom !== undefined) set("brief_from", patch.briefFrom);
  if (patch.source !== undefined) {
    set("source", patch.source === null ? null : JSON.stringify(patch.source));
  }
  /*
   * A lower number is accepted and then ignored.
   *
   * The database clamps it forward — see the trigger in migration 0004 — so
   * this does not need to guard, and guarding here as well would mean two
   * places that have to agree about what "forward" means.
   */
  if (patch.nextPart !== undefined) set("next_part", patch.nextPart);
  if (patch.position !== undefined) set("position", patch.position);
  if (!sets.length) return getSeries(sid);

  sets.push("updated_at = now()");
  values.push(sid);
  await q(`UPDATE series SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  return getSeries(sid);
}

/** What a merge did, for the sentence the screen reports afterwards. */
export type MergeResult = {
  moved: number;
  /** Moved even though the name is already there, because it has content. */
  duplicatedWithContent: string[];
  /** Dropped: the same name, and nothing written under it. */
  dropped: string[];
};

/**
 * Fold one series into another and delete the empty one.
 *
 * The rule for a topic whose name the target already has:
 *
 *   nothing written under it → dropped. The subject is covered, and an idea
 *   with no content is not worth keeping a second copy of.
 *   something written under it → moved anyway. Two pieces of content about
 *   one subject is a mess, but deleting work to tidy it is worse; both land
 *   on the shelf and the report names them so you can decide.
 *
 * Runs are not touched: `runs.topic_id` outlives the topic by design, and a
 * moved topic keeps its id, so nothing loses its content either way.
 */
export async function mergeSeries(
  fromId: string,
  intoId: string,
): Promise<MergeResult> {
  if (fromId === intoId) throw new Error("A series cannot merge into itself");

  return tx(async (c) => {
    const ends = await c.query<{
      id: string;
      workspace_id: string;
      numbered: boolean;
      next_part: number;
    }>(
      "SELECT id, workspace_id, numbered, next_part FROM series WHERE id = ANY($1) FOR UPDATE",
      [[fromId, intoId]],
    );
    const from = ends.rows.find((r) => r.id === fromId);
    const into = ends.rows.find((r) => r.id === intoId);
    if (!from || !into) throw new Error("No such series");
    if (from.workspace_id !== into.workspace_id) {
      throw new Error("Those series are in different workspaces");
    }

    const mine = await c.query<{ id: string; name: string; runs: string }>(
      `SELECT t.id, t.name,
              (SELECT count(*) FROM runs r WHERE r.topic_id = t.id) AS runs
         FROM topics t WHERE t.series_id = $1 ORDER BY t.part NULLS LAST, t.created_at`,
      [fromId],
    );
    const theirs = await c.query<{ id: string; name: string }>(
      "SELECT id, name FROM topics WHERE series_id = $1",
      [intoId],
    );

    const numbered = into.numbered !== false;
    let part = Number(into.next_part);
    const result: MergeResult = {
      moved: 0,
      duplicatedWithContent: [],
      dropped: [],
    };

    for (const topic of mine.rows) {
      const clash = findSame(topic.name, theirs.rows);
      const hasContent = Number(topic.runs) > 0;

      if (clash && !hasContent) {
        await c.query("DELETE FROM topics WHERE id = $1", [topic.id]);
        result.dropped.push(topic.name);
        continue;
      }

      await c.query(
        "UPDATE topics SET series_id = $1, part = $2, updated_at = now() WHERE id = $3",
        [intoId, numbered ? part : null, topic.id],
      );
      theirs.rows.push({ id: topic.id, name: topic.name });
      result.moved += 1;
      if (clash) result.duplicatedWithContent.push(topic.name);
      if (numbered) part += 1;
    }

    if (numbered) {
      await c.query("UPDATE series SET next_part = $1 WHERE id = $2", [
        part,
        intoId,
      ]);
    }
    await c.query("DELETE FROM series WHERE id = $1", [fromId]);

    return result;
  });
}

/**
 * The shelf topics land on when the one they were standing on goes.
 *
 * Deliberately not numbered: it is a holding area, not a series, and a part
 * number there would claim a position in a sequence that does not exist. The
 * topics keep the numbers they already had, so nothing is lost on the way
 * through — moving one onto a real shelf later renumbers it then.
 */
export const HOLDING_SERIES = "Misc";

export type DeleteResult = {
  deleted: boolean;
  /** How many topics were moved out rather than deleted with the shelf. */
  moved: number;
  /** Where they went, when they went anywhere. */
  into: string;
};

export async function deleteSeries(
  sid: string,
  opts: { keepTopics?: boolean } = {},
): Promise<DeleteResult> {
  if (!opts.keepTopics) {
    // The topics go with it — the foreign key cascades, and the runs they
    // produced do not: `runs.topic_id` is ON DELETE SET NULL, so content
    // written from a deleted topic stays on Content.
    const rows = await q("DELETE FROM series WHERE id = $1 RETURNING id", [sid]);
    return { deleted: rows.length > 0, moved: 0, into: "" };
  }

  return tx(async (c) => {
    const mine = await c.query<{ workspace_id: string; name: string }>(
      "SELECT workspace_id, name FROM series WHERE id = $1 FOR UPDATE",
      [sid],
    );
    if (!mine.rows.length) return { deleted: false, moved: 0, into: "" };
    const workspaceId = mine.rows[0].workspace_id;

    await holdName(c, workspaceId, HOLDING_SERIES);

    // Find or make it. Matched by the same rule as everything else, so a
    // shelf the user already calls "misc" is the one that gets used rather
    // than a second one appearing beside it.
    const shelves = await c.query<{ id: string; name: string }>(
      "SELECT id, name FROM series WHERE workspace_id = $1 AND id <> $2",
      [workspaceId, sid],
    );
    let holding = findSame(HOLDING_SERIES, shelves.rows)?.id ?? "";

    if (!holding) {
      const made = await c.query<{ id: string }>(
        `INSERT INTO series
           (id, workspace_id, name, context, pack, numbered, part_label, next_part, position)
         VALUES ($1, $2, $3, '', '', false, 'Part', 1,
                 (SELECT COALESCE(MAX(position), -1) + 1 FROM series WHERE workspace_id = $2))
         RETURNING id`,
        [id("ser"), workspaceId, HOLDING_SERIES],
      );
      holding = made.rows[0].id;
    }

    const moved = await c.query(
      "UPDATE topics SET series_id = $1, updated_at = now() WHERE series_id = $2",
      [holding, sid],
    );
    const gone = await c.query("DELETE FROM series WHERE id = $1 RETURNING id", [
      sid,
    ]);

    return {
      deleted: gone.rowCount ? gone.rowCount > 0 : false,
      moved: moved.rowCount ?? 0,
      into: HOLDING_SERIES,
    };
  });
}

/* ── Topics ─────────────────────────────────────────────────────────────── */

export async function getTopic(tid: string): Promise<Topic | null> {
  const row = await one<Row>("SELECT * FROM topics WHERE id = $1", [tid]);
  return row ? mapTopic(row) : null;
}

/**
 * Write topics and advance the series' counter, atomically.
 *
 * The counter is read inside the transaction with `FOR UPDATE`, so two requests
 * adding topics at the same moment cannot both read part 7 and both claim it —
 * the second waits, then reads 8. That race is the whole reason the counter is
 * a column rather than `MAX(part) + 1`.
 */
/** What a batch of proposed topics turned into. */
export type AddedTopics = {
  added: Topic[];
  /** Names that were already covered, and where. */
  skipped: { name: string; series: string }[];
};

export async function addTopics(
  seriesId: string,
  names: { name: string; context?: string; status?: string }[],
): Promise<AddedTopics> {
  if (!names.length) return { added: [], skipped: [] };

  return tx(async (c) => {
    const locked = await c.query<{
      next_part: number;
      numbered: boolean;
      workspace_id: string;
    }>(
      "SELECT next_part, numbered, workspace_id FROM series WHERE id = $1 FOR UPDATE",
      [seriesId],
    );
    if (!locked.rows.length) return { added: [], skipped: [] };

    /*
     * Covered means covered anywhere in the workspace, not on this shelf.
     *
     * A topic already written under one series is written; adding it under
     * another produces a second piece of content about the same thing, which
     * is the exact outcome this is here to prevent. The name of the shelf it
     * is already on comes back with it, so the answer is "Squoosh is already
     * in Powerful websites" rather than a silent drop.
     */
    const covered = await c.query<{ id: string; name: string; series: string }>(
      `SELECT t.id, t.name, s.name AS series
         FROM topics t JOIN series s ON s.id = t.series_id
        WHERE s.workspace_id = $1`,
      [locked.rows[0].workspace_id],
    );

    const split = partitionNew(
      names.map((n) => n.name),
      covered.rows,
    );
    const byName = new Map(names.map((n) => [n.name.trim(), n]));
    const skipped = split.covered.map((c2) => ({
      name: c2.name,
      series:
        (c2.by as { series?: string } | null)?.series ?? "another series",
    }));
    if (!split.fresh.length) return { added: [], skipped };

    const numbered = locked.rows[0].numbered !== false;
    let part = Number(locked.rows[0].next_part);
    const made: Topic[] = [];

    for (const name of split.fresh) {
      const entry = byName.get(name) ?? { name };
      const res = await c.query<Row>(
        `INSERT INTO topics (id, series_id, name, part, context, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          id("top"),
          seriesId,
          entry.name,
          // Null on an unnumbered shelf. Not 0, and not the counter's value
          // held back for later: a topic with no part is a topic with no part.
          numbered ? part : null,
          entry.context ?? "",
          entry.status ?? "idea",
        ],
      );
      made.push(mapTopic(res.rows[0]));
      if (numbered) part += 1;
    }


    // Moves once, by however many landed — so a batch of three takes three
    // numbers and the next one carries on from there. An unnumbered shelf
    // leaves it exactly where it was, so switching numbering back on picks up
    // from the last part it actually issued rather than repeating it.
    if (numbered) {
      await c.query(
        "UPDATE series SET next_part = $1, updated_at = now() WHERE id = $2",
        [part, seriesId],
      );
    }
    return { added: made, skipped };
  });
}

export async function updateTopic(
  tid: string,
  patch: Partial<Pick<Topic, "name" | "context" | "status" | "decision" | "part">>,
): Promise<Topic | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.context !== undefined) set("context", patch.context);
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.decision !== undefined) set("decision", patch.decision);
  if (patch.part !== undefined) set("part", patch.part);
  if (!sets.length) return getTopic(tid);

  sets.push("updated_at = now()");
  values.push(tid);
  const row = await one<Row>(
    `UPDATE topics SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return row ? mapTopic(row) : null;
}

export async function deleteTopic(tid: string) {
  const rows = await q("DELETE FROM topics WHERE id = $1 RETURNING id", [tid]);
  return rows.length > 0;
}
