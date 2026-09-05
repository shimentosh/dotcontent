import { createHash } from "node:crypto";

import type { ToolStatus } from "@/lib/server/tools";
import { id, iso, one, q } from "@/lib/server/db/client";

/**
 * The machines.
 *
 * One row is one desktop with one signed-in CLI on it. Everything the server
 * used to learn by spawning `claude --version` in its own process it now reads
 * out of this table, because the box that answers HTTP is no longer the box
 * with the binaries: `toolStatuses()` on a VPS returns "nothing installed",
 * forever, and an Integrations page built on it is a list of red rows about a
 * machine nobody uses.
 *
 * A worker is a credential as well as a fact. The token is minted by the
 * caller, shown to a person once, and never stored — only its sha256 lives
 * here, so a database dump is not a list of live logins. Revoking is deleting
 * the row.
 */

/**
 * How long since `last_seen_at` before a machine reads as offline.
 *
 * The worker re-registers and heartbeats on a timer measured in seconds, so
 * two minutes is many missed beats rather than one slow one. It is a display
 * notion only — nothing routes on it — because "that laptop is shut" is a
 * sentence for a person, and the claim query already handles the machine that
 * simply never asks for work.
 */
export const LIVE_WINDOW_MS = 120_000;

export type Worker = {
  id: string;
  userId: string;
  name: string;
  platform: string;
  version: string;
  /** What the machine probed, whole, in the shape the Integrations page draws. */
  tools: ToolStatus[];
  /** The subset its owner has switched on. Tool ids. */
  enabled: string[];
  /** Empty means every workspace. See migration 0015. */
  workspaceIds: string[];
  canReadFrames: boolean;
  maxConcurrency: number;
  lastSeenAt: string | null;
  /** Derived, not stored: seen inside LIVE_WINDOW_MS. */
  live: boolean;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const mapWorker = (r: Row): Worker => {
  const lastSeenAt = r.last_seen_at == null ? null : iso(r.last_seen_at);
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    platform: String(r.platform ?? ""),
    version: String(r.version ?? ""),
    tools: asArray<ToolStatus>(r.tools),
    enabled: asArray<string>(r.enabled).map(String),
    workspaceIds: asArray<string>(r.workspace_ids).map(String),
    canReadFrames: r.can_read_frames === true,
    maxConcurrency: Number(r.max_concurrency ?? 1),
    lastSeenAt,
    live: lastSeenAt
      ? Date.now() - new Date(lastSeenAt).getTime() < LIVE_WINDOW_MS
      : false,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
};

/**
 * The one place a worker token is turned into what the database stores.
 *
 * Exported, and the only hashing in the codebase, so that no controller can
 * ever put a raw token in a column by writing its own `createHash` call and
 * getting the encoding subtly different — or by forgetting. `token_hash` is
 * UNIQUE, so a caller that stored the raw token would also silently break
 * every later lookup, which is the kind of bug that shows up as "enrolment
 * worked and then the machine could never claim anything".
 *
 * sha256 with no salt and no work factor on purpose: this is a 256-bit random
 * token, not a password. There is nothing to guess and nothing to slow down,
 * and the lookup has to be a single indexed equality on every request the
 * worker makes.
 */
export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Enrol a machine, or update the one already holding this token.
 *
 * Idempotent on the token hash, which is what makes re-registration the way a
 * worker reports itself rather than a second row: the desktop app registers at
 * every start and after every update, and a newly installed `whisper` becomes
 * visible by the machine saying so again. This is what replaces
 * `toolStatuses(force)` and the 60s cache in `tools.ts` — both of which
 * belonged to a server that could probe itself.
 *
 * `canReadFrames`, `maxConcurrency` and `workspaceIds` are deliberately NOT
 * overwritten on re-registration. They are the owner's settings, set in the
 * console; a worker restarting with its defaults must not silently hand itself
 * back the file-read permission somebody switched off.
 */
export async function registerWorker(patch: {
  userId: string;
  name: string;
  /** Raw token. Hashed here; never stored. */
  token: string;
  platform?: string;
  version?: string;
  tools?: ToolStatus[];
  enabled?: string[];
}): Promise<Worker> {
  const hash = hashToken(patch.token);
  /*
   * Only what is actually THERE counts as reportable.
   *
   * A machine reports every tool it probed, present or missing, because the
   * Machines page has to be able to say "whisper is not installed on that
   * computer". `enabled` is a different question — what may be USED — and
   * seeding it from the whole report switched on tools the machine does not
   * have. `routeFor` checks presence before it routes, so nothing was
   * misrouted; but the claim query matches `needs` against `enabled` alone, so
   * the guard was one function thinner than it looked, and the page showed a
   * tool as switched on that could not run.
   */
  const reported = (patch.tools ?? [])
    .filter((t) => t.present)
    .map((t) => t.id as string);

  /*
   * What stays switched on, when a machine reports itself again.
   *
   * A worker re-registers every few minutes — that is how a newly installed
   * whisper becomes visible at all. Two obvious rules are both wrong:
   *
   *  - Take the report's `enabled` wholesale, and the switch in Settings →
   *    Machines is a lie. Turn a tool off, and the machine turns it back on by
   *    itself within the tick.
   *  - Keep the stored value wholesale, and a tool installed after enrolment
   *    is reported, listed, and never used, because nothing ever adds it.
   *
   * So the owner's set is kept, and only ids this report knows about that the
   * previous one did not are added. Something in neither was switched off on
   * purpose, and stays off. On the first insert everything reported is on,
   * because enrolling a machine to then go and switch its tools on one at a
   * time is not a decision anybody wants to be asked for.
   *
   * Read-then-write rather than one statement: the merge is a set operation
   * with a rule worth reading, and this runs on a five-minute timer, not in
   * the claim path. Two registrations of the SAME token racing would settle on
   * one of two nearly identical sets, which is not worth a lock.
   */
  const before = await one<{ tools: ToolStatus[]; enabled: string[] }>(
    "SELECT tools, enabled FROM workers WHERE token_hash = $1",
    [hash],
  );

  const enabled = before
    ? (() => {
        const known = new Set((before.tools ?? []).map((t) => t.id as string));
        const on = new Set(before.enabled ?? []);
        for (const t of reported) if (!known.has(t)) on.add(t);
        return [...on];
      })()
    : (patch.enabled?.length ? patch.enabled : reported);

  const row = await one<Row>(
    `INSERT INTO workers
       (id, user_id, name, token_hash, platform, version, tools, enabled,
        last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now())
     ON CONFLICT (token_hash) DO UPDATE SET
       name         = EXCLUDED.name,
       platform     = EXCLUDED.platform,
       version      = EXCLUDED.version,
       tools        = EXCLUDED.tools,
       enabled      = EXCLUDED.enabled,
       last_seen_at = now(),
       updated_at   = now()
     RETURNING *`,
    [
      id("wrk"),
      patch.userId,
      patch.name,
      hash,
      patch.platform ?? "",
      patch.version ?? "",
      JSON.stringify(patch.tools ?? []),
      JSON.stringify(enabled),
    ],
  );
  return mapWorker(row!);
}

/**
 * The guard's lookup: bearer token in, machine out.
 *
 * Takes the raw token rather than a hash so that the hashing stays on this
 * side of the boundary and a caller cannot pass the wrong thing that happens
 * to typecheck.
 */
export async function workerByToken(token: string): Promise<Worker | null> {
  if (!token) return null;
  const row = await one<Row>("SELECT * FROM workers WHERE token_hash = $1", [
    hashToken(token),
  ]);
  return row ? mapWorker(row) : null;
}

export async function getWorker(wid: string): Promise<Worker | null> {
  const row = await one<Row>("SELECT * FROM workers WHERE id = $1", [wid]);
  return row ? mapWorker(row) : null;
}

/**
 * Every machine, most recently seen first.
 *
 * What the machine picker reads. Sorted by liveness rather than by name
 * because the question the page is answering is "where can this run right
 * now", and a laptop that has been shut since Tuesday is not an answer to it.
 * NULLS LAST keeps a machine that has never checked in at the bottom instead
 * of the top, where Postgres would otherwise put it for a DESC sort.
 */
export async function listWorkers(userId?: string): Promise<Worker[]> {
  const rows = userId
    ? await q<Row>(
        `SELECT * FROM workers WHERE user_id = $1
          ORDER BY last_seen_at DESC NULLS LAST, created_at`,
        [userId],
      )
    : await q<Row>(
        `SELECT * FROM workers
          ORDER BY last_seen_at DESC NULLS LAST, created_at`,
      );
  return rows.map(mapWorker);
}

/**
 * Mark a machine as having just spoken.
 *
 * Called by the guard on every worker request, so it is one indexed UPDATE and
 * nothing else — no RETURNING, no row mapping. Liveness is the only thing that
 * reads it, and liveness is a display notion, so the write does not need to be
 * awaited on a path where latency matters.
 */
export async function touchWorker(wid: string) {
  await q("UPDATE workers SET last_seen_at = now() WHERE id = $1", [wid]);
}

/**
 * The switches that belong to whoever owns the machine.
 *
 * Separate from `registerWorker` because these are the console's writes and
 * that is the worker's. Nothing here can be set by the machine reporting
 * itself: `can_read_frames` grants the `Read` tool on one specific person's
 * filesystem, and a worker that could set it for itself would make the switch
 * meaningless. `tools` is absent for the mirror-image reason — a person
 * cannot type a binary into existence.
 *
 * Returns null when the row is gone, so a caller can tell "nothing changed"
 * from "no such machine" without a second query.
 */
export async function updateWorker(
  wid: string,
  patch: Partial<
    Pick<
      Worker,
      "name" | "enabled" | "canReadFrames" | "maxConcurrency" | "workspaceIds"
    >
  >,
): Promise<Worker | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.enabled !== undefined)
    set("enabled", JSON.stringify(patch.enabled));
  if (patch.canReadFrames !== undefined)
    set("can_read_frames", patch.canReadFrames);
  // One machine is one CLI login. Clamped rather than rejected because this
  // arrives from a number input and the useful range is two values wide.
  if (patch.maxConcurrency !== undefined)
    set("max_concurrency", Math.max(1, Math.min(8, patch.maxConcurrency)));
  if (patch.workspaceIds !== undefined)
    set("workspace_ids", JSON.stringify(patch.workspaceIds));

  if (!sets.length) return getWorker(wid);

  sets.push("updated_at = now()");
  values.push(wid);
  const row = await one<Row>(
    `UPDATE workers SET ${sets.join(", ")}
      WHERE id = $${values.length}
      RETURNING *`,
    values,
  );
  return row ? mapWorker(row) : null;
}

/**
 * Revoke a machine.
 *
 * Deleting the row IS revoking the token — there is no separate revoked flag,
 * because a hash that is not in the table cannot authenticate and a row that
 * exists but is refused is a second state to keep in sync with the first.
 * Jobs the machine held survive it: `jobs.worker_id` is ON DELETE SET NULL,
 * and a claimed job whose worker vanished simply loses its lease and is
 * reaped back to `queued` like any other.
 */
export async function deleteWorker(wid: string) {
  const rows = await q("DELETE FROM workers WHERE id = $1 RETURNING id", [wid]);
  return rows.length > 0;
}

/**
 * Can anything on this estate run a job that needs these tools?
 *
 * The question behind the three cases in "Capability matching": a tool no
 * machine has ever advertised means the job is unroutable and must fail at
 * enqueue with a sentence naming the tool, while a tool only offline machines
 * have means queue it and say who we are waiting for. Answered here rather
 * than in the queue because it is a fact about the machines.
 *
 * `capable` counts only machines with the tool present AND switched on, since
 * the claim query intersects against `enabled` and a job that matches only a
 * disabled tool would queue forever.
 */
export async function routeFor(needs: string[]): Promise<{
  /** Machines that could run it, offline ones included. */
  capable: Worker[];
  /** Of those, the ones seen recently enough to be expected to pick it up. */
  live: Worker[];
  /** Needed tools no machine anywhere advertises with it switched on. */
  missing: string[];
}> {
  const all = await listWorkers();
  const has = (w: Worker, need: string) =>
    w.enabled.includes(need) && w.tools.some((t) => t.id === need && t.present);

  const capable = all.filter((w) => needs.every((need) => has(w, need)));
  const missing = needs.filter((need) => !all.some((w) => has(w, need)));
  return { capable, live: capable.filter((w) => w.live), missing };
}
