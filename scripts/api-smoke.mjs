#!/usr/bin/env node
/**
 * Is the API up, locked, and answering for a signed-in session?
 *
 *   npm run api:smoke                          # http://localhost:4000, a session off the local database
 *   API_URL=https://api.example.com npm run api:smoke
 *   API_URL=https://api.example.com SESSION=<cookie value> npm run api:smoke
 *
 * Six requests, printed one per line: the public probe, two that must be
 * refused (no cookie, forged cookie), two that must answer for a real
 * session, and the CORS preflight from WEB_ORIGIN. It exits non-zero if any
 * of them is wrong, so it can sit at the end of a deploy.
 *
 * A session comes from SESSION, or — on a machine that can reach the
 * database — from the newest live row in `sessions`, the same borrowing
 * scripts/browse.mjs does.
 */

import fs from "node:fs";
import pg from "pg";

const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const WEB = process.env.WEB_ORIGIN ?? "http://localhost:3333";

async function session() {
  if (process.env.SESSION) return process.env.SESSION;
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const url =
    env.split(/\r?\n/).map((l) => l.match(/^DATABASE_URL=(.*)$/)).find(Boolean)?.[1] ??
    process.env.DATABASE_URL ??
    "postgres://contentos:contentos@localhost:5437/contentos";
  const c = new pg.Client({ connectionString: url.trim() });
  try {
    await c.connect();
    const { rows } = await c.query(
      "SELECT id FROM sessions WHERE expires_at > now() ORDER BY created_at DESC LIMIT 1",
    );
    return rows[0]?.id ?? "";
  } catch {
    return "";
  } finally {
    await c.end().catch(() => {});
  }
}

let failed = 0;
const line = (ok, label, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(30)} ${detail}`);
};

async function check(label, path, init, expect) {
  try {
    const res = await fetch(`${API}/api${path}`, init);
    const text = await res.text();
    line(res.status === expect, label, `${res.status} ${text.slice(0, 60).replace(/\s+/g, " ")}`);
    return res;
  } catch (e) {
    line(false, label, `unreachable — ${e.message}`);
    return null;
  }
}

const sid = await session();
const cookie = sid ? { cookie: `contentos_session=${sid}` } : null;

console.log(`API ${API}   web origin ${WEB}${sid ? "" : "   (no session — signed-in checks skipped)"}\n`);

await check("public: auth/me", "/auth/me", {}, 200);
await check("refused: no cookie", "/packs", {}, 401);
await check("refused: forged cookie", "/packs", { headers: { cookie: "contentos_session=forged" } }, 401);
if (cookie) {
  await check("signed in: packs", "/packs", { headers: cookie }, 200);
  await check("signed in: workspaces", "/workspaces", { headers: cookie }, 200);
}

/*
 * The worker's door, and the console's, tried with each other's key.
 *
 * `POST /api/workers/claim` is the cheapest worker route to probe: refused,
 * it writes nothing, and it is the one every machine calls constantly.
 */
const claim = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ max: 1 }),
};

await check("refused: worker route, no token", "/workers/claim", claim, 401);
await check(
  "refused: worker route, forged token",
  "/workers/claim",
  { ...claim, headers: { ...claim.headers, authorization: "Bearer forged" } },
  401,
);
if (cookie) {
  // The crossing that matters most. A session is a credential over the whole
  // console; if it also satisfied a worker route, every signed-in browser
  // could claim and answer jobs.
  await check(
    "refused: worker route, session cookie",
    "/workers/claim",
    { ...claim, headers: { ...claim.headers, ...cookie } },
    401,
  );
}
// And the other way: a bearer token, however good, is not a way into the
// library. Forged here because a real one is not this script's to have — a
// valid one must fail the same way, for the same reason.
await check(
  "refused: console route, worker token",
  "/packs",
  { headers: { authorization: "Bearer forged" } },
  401,
);

/*
 * Whether anything can actually run.
 *
 * The server writes nothing itself: with no machine enrolled every run ends
 * `unroutable`. That is not a broken deploy, so it is a note rather than a
 * failure — but it is the first thing to know after one.
 */
if (cookie) {
  const machines = await fetch(`${API}/api/machines`, { headers: cookie })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (Array.isArray(machines)) {
    const live = machines.filter((m) => m.live).length;
    console.log(
      machines.length
        ? `  note  ${machines.length} machine(s) enrolled, ${live} reachable now`
        : "  note  no machines enrolled — nothing can run until one is (Settings → Machines)",
    );
  }
}

const pre = await fetch(`${API}/api/packs`, {
  method: "OPTIONS",
  headers: { origin: WEB, "access-control-request-method": "GET" },
}).catch(() => null);
const origin = pre?.headers.get("access-control-allow-origin");
const creds = pre?.headers.get("access-control-allow-credentials");
line(
  origin === WEB && creds === "true",
  "cors: preflight from web",
  pre ? `origin=${origin} credentials=${creds}` : "unreachable",
);

console.log(failed ? `\n${failed} wrong` : "\nall good");
/*
 * The code is set, not forced.
 *
 * `process.exit()` here tore the process down while fetch's keep-alive
 * sockets were still open, and libuv asserted on the way out — after the
 * report had printed, so the run looked fine while the exit code was a
 * crash's. A script whose whole job is to end a deploy with a truthful
 * status must not be the thing reporting a false one. Setting `exitCode`
 * lets Node close what it opened and leave with the number this earned.
 */
process.exitCode = failed ? 1 : 0;
