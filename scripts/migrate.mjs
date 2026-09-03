/**
 * Apply any migrations the database has not seen.
 *
 *   npm run db:migrate
 *
 * The app runs these itself, once per process, on the first request. That is
 * enough in production, where a deploy starts a new process — and not enough
 * in development, where the dev server has usually been running since before
 * the migration was written, so a new one silently does not exist until you
 * restart. This applies them without taking the server down, and gives the
 * deploy a step it can run before the app comes up.
 *
 * Reads DATABASE_URL from the environment, or from .env beside it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

try {
  for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] ??= m[2];
  }
} catch {
  // No .env is fine when the environment already carries DATABASE_URL.
}

const { MIGRATIONS } = await import("../lib/server/db/schema.ts");
const { Pool } = await import("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://contentos:contentos@localhost:5437/contentos",
});

const client = await pool.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const done = new Set(
    (await client.query("SELECT name FROM migrations")).rows.map((r) => r.name),
  );

  let applied = 0;
  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) continue;
    // One transaction each: a half-applied migration is the one thing worse
    // than an unapplied one.
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO migrations (name) VALUES ($1)", [
        migration.name,
      ]);
      await client.query("COMMIT");
      console.log("applied", migration.name);
      applied += 1;
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`${migration.name} failed: ${e.message}`);
    }
  }

  console.log(applied ? `${applied} applied` : "already up to date");
} finally {
  client.release();
  await pool.end();
}
