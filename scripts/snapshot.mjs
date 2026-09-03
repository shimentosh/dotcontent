/**
 * Take the workspace with you.
 *
 *   node scripts/snapshot.mjs dump backup.sql     # from wherever DATABASE_URL points
 *   node scripts/snapshot.mjs restore backup.sql  # into wherever it points now
 *
 * Moving from the laptop to the server is one dump and one restore: the
 * templates, series, topics, every run and every section come across, so the
 * team opens the console and sees exactly what you see.
 *
 * Runs pg_dump/psql inside the Postgres container when there is one, so
 * nothing has to be installed on the machine doing it.
 */

import { spawnSync } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import path from "node:path";

try {
  for (const line of readFileSync(path.join(process.cwd(), ".env"), "utf8").split(
    /\r?\n/,
  )) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] ??= m[2];
  }
} catch {
  // The environment may carry DATABASE_URL on its own.
}

const [command, file] = process.argv.slice(2);
if (!command || !file) {
  console.error("usage: node scripts/snapshot.mjs <dump|restore> <file.sql>");
  process.exit(1);
}

const url =
  process.env.DATABASE_URL ??
  "postgres://contentos:contentos@localhost:5437/contentos";

/**
 * The local database runs in a container, so pg_dump lives in the container.
 * A host without the Postgres client tools installed is the normal case, and
 * "command not found" is a bad answer to "back up my work".
 */
const inContainer = spawnSync(
  "docker",
  ["compose", "ps", "-q", "postgres"],
  { encoding: "utf8" },
).stdout?.trim();

const run = (args, opts = {}) =>
  spawnSync(args[0], args.slice(1), { stdio: "inherit", shell: false, ...opts });

if (command === "dump") {
  const result = inContainer
    ? run([
        "docker",
        "compose",
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "--clean",
        "--if-exists",
        "-U",
        "contentos",
        "contentos",
      ], { stdio: ["ignore", openWrite(file), "inherit"] })
    : run(["pg_dump", "--clean", "--if-exists", url], {
        stdio: ["ignore", openWrite(file), "inherit"],
      });
  process.exit(result.status ?? 1);
}

if (command === "restore") {
  const result = inContainer
    ? run(["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "contentos", "contentos"], {
        stdio: [openRead(file), "inherit", "inherit"],
      })
    : run(["psql", url], { stdio: [openRead(file), "inherit", "inherit"] });
  process.exit(result.status ?? 1);
}

console.error(`unknown command: ${command}`);
process.exit(1);

function openWrite(name) {
  return openSync(name, "w");
}

function openRead(name) {
  return openSync(name, "r");
}
