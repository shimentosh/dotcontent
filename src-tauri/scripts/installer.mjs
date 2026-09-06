/**
 * `npm run desktop:installer` — the two build steps, and the two questions the
 * build must not skip.
 *
 * The app is compiled with **two** addresses, from `CONTENTOS_CONSOLE_URL` and
 * `CONTENTOS_API_URL` (see `built_in` in `src-tauri/src/settings.rs`). They are
 * two because the deployment is two: `docs/DEPLOYING.md` puts the web app on
 * `APP_HOST` and the NestJS API on `API_HOST`, the browser calls the API
 * cross-origin, and there is no `/api` under Next. The console is what the
 * window opens; the API is what every worker calls for jobs. Neither is
 * derivable from the other — `api.` in front of the console's host is this
 * repository's compose convention, not a rule — so both have to be stated.
 *
 * That is the whole point of baking them in: whoever builds the installer
 * already knows both, so none of the fifteen people who install it should have
 * to be told, or be able to mistype them. Which means the failure worth
 * catching is building an installer that is missing one — it works, so nothing
 * downstream complains, and the cost lands on every teammate individually,
 * weeks later, as a support question. An installer with a console and no API
 * is the *quietest* version of it: the window opens, the person sees their
 * team's Content OS, and only the worker is dead.
 *
 * **A warning, not a refusal**, and the reasoning is worth keeping:
 *
 * - An installer with no addresses is a real, working artifact. It falls back
 *   to asking, exactly as this app did before any of this existed, so refusing
 *   to produce one would take away a build that is sometimes the right one — a
 *   smoke test, or a copy handed to a second team whose servers this machine
 *   does not know.
 * - An installer with the WRONG address is strictly worse than one with none.
 *   The missing one asks; the wrong one confidently sends a machine at a
 *   server that is not its team's and hides the field that would fix it. A
 *   hard failure here is a hard failure a hurried person gets past by typing
 *   any string that parses, which manufactures exactly that.
 *
 * So it says so loudly, twice — before the build and again after it, because
 * `tauri build` prints several hundred lines in between and a warning nobody
 * scrolls back to is a warning that was not given.
 *
 * A malformed address IS a hard failure, for the same reason: it can only have
 * been a mistake, and baking it in produces the wrong-address case above.
 *
 *   npm run desktop:installer                 # extra arguments are passed to `tauri build`
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const RULE = "─".repeat(72);

/**
 * The pair, in the order everything here prints them. One list rather than two
 * variables threaded through, so that a build cannot end up checking one
 * address and baking in two.
 */
const ADDRESSES = [
  {
    name: "CONTENTOS_CONSOLE_URL",
    what: "the console — the pages the app opens",
    example: "https://contentos.yourteam.com",
  },
  {
    name: "CONTENTOS_API_URL",
    what: "the API — the server every worker calls for jobs",
    example: "https://api.contentos.yourteam.com",
  },
];

/** The width of the longest variable name, so the two columns line up. */
const COLUMN = Math.max(...ADDRESSES.map((a) => a.name.length));

/**
 * The same forgiveness `normalise` in `src-tauri/src/settings.rs` extends, and
 * the same refusals — a host with no scheme becomes https, a trailing slash is
 * dropped, and anything that is not a web address stops the build. Kept in
 * step by hand, and small enough to stay that way; what it must not do is
 * accept something the app would then reject.
 *
 * One function for both, named by whichever it was given, because a message
 * that said `CONTENTOS_CONSOLE_URL` about the API value would send somebody to
 * correct a variable that was already right.
 */
function address(spec, raw) {
  const typed = raw.trim();
  if (!typed) return "";

  const withScheme = typed.includes("://") ? typed : `https://${typed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(
      `${spec.name} is "${typed}", which is not a web address. It should look like ${spec.example}.`,
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(
      `${spec.name} is "${typed}", which has to start with https:// (or http:// on your own network).`,
    );
  }
  if (!url.hostname) {
    throw new Error(`${spec.name} is "${typed}", which has no server name in it.`);
  }
  return withScheme.replace(/\/+$/, "");
}

/**
 * What this installer will carry, and what it will not.
 *
 * Both lists every time, and both printed before and after the build. The
 * addresses are the one thing about the artifact that cannot be seen by
 * looking at it, and an installer built with one of the two is a build that
 * looks entirely successful.
 */
function announce(set, missing, tense) {
  if (set.length) {
    console.log(`\n${tense} an installer for:\n`);
    for (const [spec, url] of set) {
      console.log(`  ${spec.name.padEnd(COLUMN)}  ${url}`);
    }
    console.log("");
  }
  if (missing.length) warn(missing);
}

function warn(missing) {
  const lines = missing.map((spec) => `    ${spec.name.padEnd(COLUMN)}  ${spec.what}`).join("\n");
  const it = missing.length === ADDRESSES.length ? "them" : "it";
  console.log(`
${RULE}
  This installer is being built with no value for:

${lines}

  Everyone who installs it will be asked to type ${it} in before their
  machine can do anything — which is the typo, the support question,
  and the piece of knowledge that building ${it} in exists to remove.

  The two are separate on purpose and neither can be guessed from the
  other: docs/DEPLOYING.md puts the web app on APP_HOST and the NestJS
  API on API_HOST, and says they may be anywhere. Set both:

    PowerShell   $env:CONTENTOS_CONSOLE_URL = "https://contentos.yourteam.com"
                 $env:CONTENTOS_API_URL = "https://api.contentos.yourteam.com"
                 npm run desktop:installer

    bash         export CONTENTOS_CONSOLE_URL=https://contentos.yourteam.com
                 export CONTENTOS_API_URL=https://api.contentos.yourteam.com
                 npm run desktop:installer

  Building anyway — an installer that asks still works.
${RULE}
`);
}

function run(what, args) {
  const done = spawnSync(what, args, { cwd: root, stdio: "inherit", env: process.env });
  if (done.error) throw done.error;
  if (done.status !== 0) process.exit(done.status ?? 1);
}

function main() {
  const set = [];
  const missing = [];
  for (const spec of ADDRESSES) {
    const url = address(spec, process.env[spec.name] ?? "");
    if (url) {
      // Put back tidied, so what is compiled in is exactly what was checked
      // and printed rather than something a slash apart from it.
      process.env[spec.name] = url;
      set.push([spec, url]);
    } else {
      missing.push(spec);
    }
  }

  announce(set, missing, "Building");

  // The pinned Node the app carries, then the bundle. Both are run with this
  // process's Node and this repository's own CLI rather than through `npm run`
  // and `npx`, so that neither step depends on a shell resolving a name.
  run(process.execPath, [path.join(root, "src-tauri", "scripts", "fetch-node.mjs")]);

  const tauri = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  if (!existsSync(tauri)) {
    throw new Error(
      "The Tauri CLI is not installed. It is a devDependency of this repository — run `npm install`.",
    );
  }
  run(process.execPath, [tauri, "build", ...process.argv.slice(2)]);

  // Said again, because several hundred lines of build output have gone past
  // since the first time and this is the one thing about the artifact that
  // cannot be seen by looking at it.
  announce(set, missing, "Built");
}

try {
  main();
} catch (e) {
  console.error(`\nCould not build the installer: ${e.message ?? e}\n`);
  process.exit(1);
}
