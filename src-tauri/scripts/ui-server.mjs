/**
 * The setup window's HTML, served instead of baked in, so an edit shows up
 * without a Rust rebuild.
 *
 * `frontendDist: "ui"` embeds `src-tauri/ui` into the binary at compile time,
 * which is right for something a teammate installs and wrong for working on
 * it: a comma in a stylesheet cost a full `cargo build`. Tauri prefers
 * `build.devUrl` over the embedded copy in a debug build, so in development
 * the window loads from here and a save is a reload.
 *
 * Deliberately not a dependency. This serves four files from one directory to
 * one localhost window; a bundler and its config would be more moving parts
 * than the thing they were moving.
 *
 * It is only ever reachable from this machine: bound to 127.0.0.1, never
 * started by a release build, and it serves nothing outside `src-tauri/ui`.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/*
 * How the page learns it is stale.
 *
 * A version that changes when a file does, and a page that asks for it every
 * second. Polling rather than a socket because the whole exchange is a number
 * on localhost: a socket would need a protocol, a reconnect and a story about
 * what happens when this process restarts, to save an HTTP request a second
 * from one window.
 *
 * `location.reload()` and nothing cleverer. The setup window keeps no state a
 * person would mind losing — what it shows is polled from Rust a moment later
 * anyway — so trying to preserve any would be work in exchange for a subtler
 * kind of wrong.
 */
const RELOAD = `
<script>
  (async () => {
    let mine = null;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const now = await (await fetch("/__version", { cache: "no-store" })).text();
        if (mine === null) mine = now;
        else if (now !== mine) location.reload();
      } catch {
        // The server is restarting, or gone. Neither is worth a console full
        // of red on a screen somebody is looking at.
      }
    }
  })();
</script>`;

export function serveUi(dir, port) {
  let version = String(Date.now());

  // One watcher for the directory. Editors save by writing a temp file and
  // renaming it, so the event that arrives is not always "change" — the
  // version is bumped for any of them.
  watch(dir, { recursive: false }, () => {
    version = String(Date.now());
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/__version") {
      res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end(version);
      return;
    }

    /*
     * Resolved against the directory and then checked to still be inside it.
     * `path.join` alone would happily walk out of it with enough `..`, and
     * this process can read everything the person running it can.
     */
    const name = url.pathname === "/" ? "setup.html" : url.pathname.slice(1);
    const file = path.resolve(dir, name);
    if (!file.startsWith(path.resolve(dir) + path.sep)) {
      res.writeHead(403).end("outside the ui directory");
      return;
    }

    try {
      await stat(file);
      const body = await readFile(file);
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      // The reload snippet goes only into HTML, and only in development —
      // this file is never reached by a release build.
      res.end(ext === ".html" ? body.toString("utf8") + RELOAD : body);
    } catch {
      res.writeHead(404).end("not here");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
