/**
 * Look at the running app, from the command line.
 *
 *   node scripts/browse.mjs shot content             → screenshot to .shots/
 *   node scripts/browse.mjs shot packs packs.png     → …under a name you pick
 *   node scripts/browse.mjs text content             → the page's visible text
 *   node scripts/browse.mjs eval content "<js>"      → run JS, print the result
 *   node scripts/browse.mjs click content "Read"     → click by label/text, then shoot
 *   node scripts/browse.mjs do builder "<js>" a.png  → run JS, THEN screenshot
 *
 * Paths take a leading slash or not; in Git Bash, leave it off.
 *
 * Why this exists: every agent session that wanted to SEE a change was writing
 * its own Chrome DevTools Protocol driver in a temp folder — launch Chrome,
 * open a socket, evaluate, screenshot — and then rediscovering that the app is
 * behind a sign-in gate and that a page load needs a session cookie. That is a
 * few thousand tokens each time, for a script that never changes.
 *
 * It launches headless Chrome if nothing is listening on the debug port, signs
 * in by borrowing a live session out of Postgres, and leaves Chrome running so
 * repeated calls are fast. `node scripts/browse.mjs stop` closes it.
 *
 * Flags: --port 3333, --debug 9222, --wait 3000 (ms after navigate), --anon
 * (skip the session cookie), --keep (leave Chrome up, the default).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = args[at + 1];
  args.splice(at, value && !value.startsWith("--") ? 2 : 1);
  return value && !value.startsWith("--") ? value : true;
};

const anon = Boolean(flag("anon", false));
const PORT = Number(flag("port", 3333));
const DEBUG = Number(flag("debug", 9222));
const WAIT = Number(flag("wait", 3000));

const [command, target, extra] = args;
const SHOTS = path.join(process.cwd(), ".shots");

/* ── Chrome ─────────────────────────────────────────────────────────────── */

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const listening = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
};

async function ensureChrome() {
  if (await listening()) return;

  const exe = CHROMES.find((p) => existsSync(p));
  if (!exe) {
    throw new Error(
      `No Chrome found. Set CHROME=<path to chrome> and try again.`,
    );
  }

  const profile = path.join(tmpdir(), "dotcontent-browse-profile");
  spawn(
    exe,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${DEBUG}`,
      `--user-data-dir=${profile}`,
      "--window-size=1600,1000",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  ).unref();

  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (await listening()) return;
  }
  throw new Error("Chrome did not open its debug port.");
}

/* ── The page ───────────────────────────────────────────────────────────── */

/**
 * A page target to drive, opening one if the browser has none.
 *
 * A running Chrome with zero tabs is not a broken Chrome, but it used to read
 * as one: this took the first page target on faith and died on
 * "Cannot read properties of undefined (reading 'webSocketDebuggerUrl')",
 * which says nothing about tabs and sends you looking for a Chrome that is
 * right there. Closing the last tab — which `stop` does — was enough to cause
 * it. /json/new must be a PUT; Chrome has refused the GET form since 111.
 */
async function pageTarget() {
  const list = async () =>
    (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find(
      (t) => t.type === "page",
    );

  const existing = await list();
  if (existing) return existing;

  const opened = await fetch(
    `http://127.0.0.1:${DEBUG}/json/new?about:blank`,
    { method: "PUT" },
  );
  if (opened.ok) return opened.json();

  const retried = await list();
  if (retried) return retried;
  throw new Error(
    "Chrome is running but has no page to drive, and would not open one. " +
      "Run `node scripts/browse.mjs stop` and try again.",
  );
}

async function attach() {
  const page = await pageTarget();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done) => (ws.onopen = done));

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const waiting = msg.id && pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    if (msg.error) waiting.reject(new Error(JSON.stringify(msg.error)));
    else waiting.resolve(msg.result);
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = (id += 1);
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    }
    return r.result.value;
  };

  return { ws, send, evaluate };
}

/**
 * A live session id, straight out of the sessions table.
 *
 * The whole app sits behind `middleware.ts`, so an unauthenticated page load
 * lands on /login and every /api/* call answers 401 "Sign in first". Rather
 * than type a password, borrow the newest session that has not expired — the
 * cookie only has to be present and resolvable.
 */
async function sessionCookie() {
  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] ??= m[2];
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      "SELECT id FROM sessions WHERE expires_at > now() ORDER BY created_at DESC LIMIT 1",
    );
    return rows[0]?.id ?? null;
  } finally {
    await pool.end();
  }
}

/**
 * A route argument, whatever the shell did to it.
 *
 * Git Bash rewrites a bare `/content` into `C:/Program Files/Git/content` on
 * its way to the process — MSYS path translation, on by default, and the
 * reason a first run of this reads "Cannot navigate to invalid URL". Both
 * `/content` and `content` are accepted, and a mangled path is unwound.
 */
function route(target, port) {
  if (/^https?:\/\//.test(target)) return target;

  const mangled = /^[A-Za-z]:[\/].*?[\/]Git[\/](.*)$/.exec(target);
  const clean = mangled ? mangled[1] : target;
  return `http://localhost:${port}/${clean.replace(/^\/+/, "")}`;
}

/* ── Commands ───────────────────────────────────────────────────────────── */

const CLICK = (what) => `(() => {
  const wanted = ${JSON.stringify(what)};
  const all = [...document.querySelectorAll("[role=button], button, a, [aria-label]")];
  const el =
    all.find((n) => n.getAttribute("aria-label") === wanted) ||
    all.find((n) => n.innerText.replace(/\\s+/g, " ").trim() === wanted) ||
    all.find((n) => n.innerText.replace(/\\s+/g, " ").trim().includes(wanted));
  if (!el) return "MISS: nothing labelled " + JSON.stringify(wanted);
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.click();
  return "clicked " + (el.getAttribute("aria-label") || el.innerText.trim().slice(0, 40));
})()`;

async function main() {
  if (command === "stop") {
    if (await listening()) {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
      for (const t of targets) {
        await fetch(`http://127.0.0.1:${DEBUG}/json/close/${t.id}`).catch(() => {});
      }
    }
    console.log("chrome closed");
    return;
  }

  if (!command || !target) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0]);
    process.exit(1);
  }

  await ensureChrome();
  const { ws, send, evaluate } = await attach();

  if (!anon) {
    const sid = await sessionCookie();
    if (sid) {
      await send("Network.setCookie", {
        name: "dotcontent_session",
        value: sid,
        domain: "localhost",
        path: "/",
      });
    } else {
      console.error("! no live session in the database — expect /login");
    }
  }

  const url = route(target, PORT);
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, WAIT));

  if (command === "click") {
    console.log(await evaluate(CLICK(extra)));
    await new Promise((r) => setTimeout(r, 900));
  }

  if (command === "do") {
    /*
     * Drive, then look.
     *
     * `eval` and `shot` each navigate first, so checking a screen you have to
     * click your way into — step 2 of a wizard, a panel behind a tab — was
     * impossible: the screenshot reloaded the page and undid the clicks. This
     * runs the script and photographs whatever it left on screen.
     */
    const value = await evaluate(extra);
    if (value !== undefined) console.log(JSON.stringify(value, null, 2));
    mkdirSync(SHOTS, { recursive: true });
    const name = args[3] ?? "do.png";
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const file = path.join(SHOTS, name);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(file);
  } else if (command === "eval") {
    console.log(JSON.stringify(await evaluate(extra), null, 2));
  } else if (command === "text") {
    console.log(await evaluate("document.body.innerText"));
  } else if (command === "shot" || command === "click") {
    mkdirSync(SHOTS, { recursive: true });
    const name =
      (command === "shot" ? extra : null) ??
      `${target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}.png`;
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const file = path.join(SHOTS, name);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(file);
  } else if (command !== "eval") {
    console.error(`unknown command: ${command}`);
  }

  ws.close();
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
