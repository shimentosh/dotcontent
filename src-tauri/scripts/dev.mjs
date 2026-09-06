/**
 * `npm run desktop` — the app, pointed at the console on this laptop.
 *
 * A launcher rather than a line in package.json for one dull reason: npm runs
 * scripts through `sh` on a Mac and `cmd.exe` on Windows, and `VAR=x cargo
 * run` is a parse error in one of them. This repository is Windows-first and
 * developed on both, so the variable is set here, where there is only one
 * language.
 *
 * It sets **two** addresses, and they are not interchangeable: the window
 * opens the first, the worker calls the second. See `settings.rs` for why the
 * app refuses to derive either from the other.
 *
 * Why this is not `.cargo/config.toml`, which would have been the
 * tidier-looking answer: an `[env]` block there applies to every cargo
 * invocation under `src-tauri`, including `cargo build --release` and the one
 * `tauri build` runs — and `option_env!` in `settings.rs` reads the compiler's
 * environment. Development addresses would have been baked into production
 * installers, silently, which is the exact failure the whole built-in-address
 * change exists to prevent.
 *
 * Anything already exported wins, so pointing a debug build at a staging
 * deployment is `CONTENTOS_CONSOLE_URL=… CONTENTOS_API_URL=… npm run desktop`
 * and nothing else. Export one and not the other and you get a hybrid — a
 * window on staging beside a worker on localhost — so they are printed on
 * every start, with what each is for beside it, rather than being assumed.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serveUi } from "./ui-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The console, which is Next — port 3333, because that is where `start.sh`
 * puts it and what `docs/DEVELOPING.md` tells everybody to assume.
 */
const CONSOLE = "http://localhost:3333";

/**
 * The API, which is NestJS on its own origin — see `lib/api-base.ts`. The two
 * are not the same server in a checkout, and the worker talks to the second
 * one, so a development run has to say both or the window works and the
 * machine beside it takes no jobs.
 */
const API = "http://localhost:4000";

const env = { ...process.env };
env.CONTENTOS_CONSOLE_URL = (env.CONTENTOS_CONSOLE_URL ?? "").trim() || CONSOLE;
env.CONTENTOS_API_URL = (env.CONTENTOS_API_URL ?? "").trim() || API;

// Named, not just listed. The two lines look nearly identical, and the whole
// class of mistake here is reading one for the other.
console.log(`CONTENTOS_CONSOLE_URL  ${env.CONTENTOS_CONSOLE_URL}   the window opens this (Next)`);
console.log(`CONTENTOS_API_URL      ${env.CONTENTOS_API_URL}   the worker calls this (NestJS)`);
console.log("");

/*
 * The setup window's HTML, served rather than embedded, so editing it is a
 * save and not a `cargo build`. `tauri.conf.json` points `build.devUrl` here,
 * and Tauri prefers it over the compiled-in copy in a debug build — release
 * builds never see this file at all.
 *
 * A port already in use is not worth stopping for: the app still runs, it
 * just uses the embedded copy, which is what it did before any of this.
 */
const UI_PORT = 1421;
const ui = await serveUi(path.join(root, "src-tauri", "ui"), UI_PORT).catch((e) => {
  console.log(`ui: not serving on ${UI_PORT} (${e.code ?? e.message}) — the window will use its built-in copy`);
  console.log("");
  return null;
});
if (ui) {
  console.log(`ui                     http://localhost:${UI_PORT}   setup.html, reloading on save`);
  console.log("");
}

const child = spawn(
  "cargo",
  ["run", "--manifest-path", "src-tauri/Cargo.toml", ...process.argv.slice(2)],
  { cwd: root, env, stdio: "inherit" },
);

child.on("error", (e) => {
  // The one failure worth a sentence: cargo is not a thing this repository can
  // install for somebody, and "spawn cargo ENOENT" does not say that.
  const why =
    e.code === "ENOENT"
      ? "cargo is not on PATH. The desktop app needs the Rust MSVC toolchain — rustup.rs, then a new terminal."
      : e.message;
  console.error(why);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // The server holds the process open on its own, so closing the window would
  // otherwise leave a port bound and the next run quietly on the built-in copy.
  ui?.close();
  process.exit(signal ? 1 : (code ?? 1));
});
