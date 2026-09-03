import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { MIGRATIONS } from "./schema";

/**
 * The database.
 *
 * Postgres, in the container `docker-compose.yml` describes. A pool rather than
 * a connection per request: Next route handlers are short-lived and a fresh TCP
 * connect and auth handshake per request is most of the latency of a small
 * query.
 *
 * Server-only. Importing this from a client component would ship `pg` to the
 * browser, which is a build error waiting to happen and a deliberate one.
 */

const URL =
  process.env.DATABASE_URL ??
  "postgres://contentos:contentos@localhost:5437/contentos";

/*
 * Kept on `globalThis` across hot reloads.
 *
 * Next's dev server re-evaluates modules on every edit. A module-level pool
 * would leak one per reload until Postgres refuses new connections — which
 * shows up as an unrelated-looking "too many clients" an hour into a session.
 */
const store = globalThis as unknown as {
  __contentosPool?: Pool;
  __contentosReady?: Promise<void>;
};

export function pool(): Pool {
  if (!store.__contentosPool) {
    store.__contentosPool = new Pool({ connectionString: URL, max: 8 });
  }
  return store.__contentosPool;
}

/**
 * Runs the migrations once per process, and only once even under concurrency.
 *
 * A FAILED run is not cached. Holding on to a rejected promise meant that if
 * the database was not up when the first request arrived, every later request
 * re-threw that same connection error — so starting Postgres changed nothing
 * until the server itself was restarted, and the app went on insisting the
 * database was down while it was plainly running.
 */
export function ready(): Promise<void> {
  if (!store.__contentosReady) {
    store.__contentosReady = migrate().catch((e) => {
      store.__contentosReady = undefined;
      throw e;
    });
  }
  return store.__contentosReady;
}

async function migrate() {
  const conn = await pool().connect();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const done = new Set(
      (await conn.query<{ name: string }>("SELECT name FROM migrations")).rows.map(
        (r) => r.name,
      ),
    );

    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      await conn.query("BEGIN");
      try {
        await conn.query(m.sql);
        await conn.query("INSERT INTO migrations (name) VALUES ($1)", [m.name]);
        await conn.query("COMMIT");
      } catch (e) {
        await conn.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    conn.release();
  }
}

/** One query. Migrations are guaranteed to have run before it. */
export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  await ready();
  const res = await pool().query<T>(text, values as never[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(text, values);
  return rows[0] ?? null;
}

/**
 * Several statements that must all land or none.
 *
 * Takes a client rather than running on the pool: `BEGIN` on a pool is a
 * transaction on whichever connection answered, and the next statement can get
 * a different one — which silently commits half the work.
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const out = await fn(conn);
    await conn.query("COMMIT");
    return out;
  } catch (e) {
    await conn.query("ROLLBACK");
    throw e;
  } finally {
    conn.release();
  }
}

/** A short, sortable, readable id. */
export function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Postgres hands back Date objects; the API speaks ISO strings. */
export const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : String(v ?? "");
