/**
 * The Node the installer carries, fetched before the bundle is built.
 *
 * The app this repository ships is for a teammate who is not a developer. Every
 * other requirement follows from that, and so does this one: "install Node
 * first" is precisely the instruction the desktop app exists to delete. So the
 * runtime travels inside the installer, as a Tauri sidecar, and this is the
 * script that puts it where the bundler will find it.
 *
 * It is deliberately the same shape as `worker/setup.ts`, which fetches yt-dlp,
 * ffmpeg and whisper.cpp onto a colleague's laptop — one catalogue, an exact
 * version, a URL and a sha256 beside it, printed before anything is fetched,
 * checked before anything is used, and staged under a `.part` name so a dropped
 * connection cannot leave a half-written `node.exe` where the next build will
 * bundle it. Inventing a second, weaker convention next to that one would mean
 * two answers to "how do we know this binary is the one we think it is".
 *
 * Two things are different from `worker/setup.ts`, both because of who runs it:
 *
 * - **It does not ask.** `worker/setup.ts` prints its plan and waits for a
 *   yes, because it is running on somebody else's computer and "nobody was
 *   there" is not consent. This runs on the build machine, for a person who
 *   just typed a build command, and a prompt in the middle of `npm run
 *   desktop:installer` would only be a thing to answer.
 * - **It fetches for one target triple**, because that is what `externalBin`
 *   consumes: Tauri looks for `binaries/node-<triple><.exe>` and silently
 *   bundles nothing when the name does not match.
 *
 *   node src-tauri/scripts/fetch-node.mjs [--target <triple>] [--force]
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/* ── What gets downloaded, pinned ───────────────────────────────────────── */

/**
 * Node 24.20.0 — the active LTS line, released 2026-08-26.
 *
 * Two constraints decide this, and only one of them is "recent". The floor is
 * **22.18**, the first release that strips types out of a `.ts` file on its
 * own; below it the worker does not run at all, which is the `NodeTooOld`
 * state in `src-tauri/src/worker.rs`. The ceiling is judgement: an LTS line
 * gets security fixes for years, and a machine in somebody's studio should not
 * be carrying a runtime that stops being patched in six months.
 *
 * Bumping it is this constant, the two digests below, and nothing else — the
 * digests come from `https://nodejs.org/dist/v<version>/SHASUMS256.txt`, which
 * is the file the Node project signs.
 */
const NODE = "24.20.0";

/**
 * The bare `node.exe`, not the zip.
 *
 * Node on Windows is a single statically linked executable — no DLLs, no
 * `npm/`, no install step — so the one file *is* the runtime, and unpacking a
 * 50 MB archive to throw away everything but one member would be work done to
 * arrive at the same place. The worker imports nothing from `node_modules`
 * (verified: every import in `worker/*.ts` is either `node:*`, another
 * `worker/` file, or one of the three `lib/server` files bundled beside it),
 * which is the fact that makes this true.
 *
 * `bytes` is the exact `Content-Length` nodejs.org serves; a digest already
 * catches a truncated file, but a length that is checked as the bytes go past
 * fails a dropped connection immediately rather than after hashing 90 MB.
 *
 * Windows only, and said out loud rather than half-attempted. `worker/setup.ts`
 * takes the same line for ffmpeg and whisper.cpp, for the same reason: this
 * team runs Windows, and a macOS or Linux entry here would be a tarball to
 * unpack, a `bin/node` to chmod, and a bundle nobody has ever built or run.
 * Adding one is a catalogue entry and an extract step, on the day somebody
 * needs it.
 */
const ASSETS = {
  "x86_64-pc-windows-msvc": {
    url: `https://nodejs.org/dist/v${NODE}/win-x64/node.exe`,
    sha256: "5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5",
    bytes: 93_381_448,
    about: "89 MB",
  },
  "aarch64-pc-windows-msvc": {
    url: `https://nodejs.org/dist/v${NODE}/win-arm64/node.exe`,
    sha256: "92949e7764e56e305cb84ea3d575912e822c79e85599362e8d408b04b9ffd326",
    bytes: 81_727_304,
    about: "78 MB",
  },
};

/** Resolved from this file, not from the working directory: the bundler reads
 *  `binaries/` relative to `src-tauri`, wherever the build was started from. */
const here = path.dirname(fileURLToPath(import.meta.url));
const BINARIES = path.join(here, "..", "binaries");

/** The triple Tauri will look for, which is the one this machine compiles to. */
function hostTriple() {
  const asked = process.argv.indexOf("--target");
  if (asked !== -1 && process.argv[asked + 1]) return process.argv[asked + 1];
  try {
    const line = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
      .split(/\r?\n/)
      .find((l) => l.startsWith("host: "));
    if (line) return line.slice("host: ".length).trim();
  } catch {
    // rustc is not on PATH in this shell. The guess below is right on every
    // machine that can build this app anyway, and `--target` overrides it.
  }
  return process.arch === "arm64"
    ? "aarch64-pc-windows-msvc"
    : "x86_64-pc-windows-msvc";
}

/**
 * Read an existing file's digest, so a build that has already fetched this
 * runtime does not fetch it again — and so a file of the *wrong* digest, left
 * by an older pin or an interrupted copy, is replaced rather than trusted.
 *
 * `createReadStream` rather than a `FileHandle`, because the caller may delete
 * this file a moment later and an open handle on Windows is how that turns
 * into EBUSY.
 */
async function sha256Of(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function main() {
  const force = process.argv.includes("--force");
  const triple = hostTriple();
  const asset = ASSETS[triple];
  if (!asset) {
    console.error(
      `This build targets ${triple}, and the desktop app only carries a Node for ` +
        `${Object.keys(ASSETS).join(" and ")}.\n` +
        `Add it to the catalogue in ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} ` +
        `with the digest from https://nodejs.org/dist/v${NODE}/SHASUMS256.txt.`,
    );
    process.exit(1);
  }

  // The name is not cosmetic: Tauri resolves `externalBin: ["binaries/node"]`
  // to exactly this, and a file under any other name means an installer that
  // builds cleanly and ships no runtime at all.
  const final = path.join(BINARIES, `node-${triple}.exe`);

  console.log(`Node ${NODE} for ${triple}`);
  console.log(`  from ${asset.url}`);
  console.log(`  ${asset.about}, sha256 ${asset.sha256}`);
  console.log(`  into ${final}`);

  if (!force) {
    const digest = await sha256Of(final).catch(() => "");
    if (digest === asset.sha256) {
      console.log("  already here and verified — nothing to fetch.");
      return;
    }
    if (digest) {
      console.log("  a different file is here; replacing it.");
    }
  }

  await fs.mkdir(BINARIES, { recursive: true });

  /*
   * Bytes land under `.part` and are moved into place only after they pass.
   *
   * The staging is the whole point, and it is the same reasoning as
   * `worker/setup.ts`: a captive portal that answers with a login page and a
   * 200, a proxy that gives up half way, a dropped connection — every one of
   * those otherwise leaves a plausible-looking `node-<triple>.exe` in
   * `binaries/`, which the next build bundles into an installer that ships a
   * runtime Windows refuses to start. `rename` is one filesystem operation and
   * cannot half-happen.
   */
  const part = `${final}.part`;
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`nodejs.org answered ${response.status} ${response.statusText}.`);
  }

  const hash = createHash("sha256");
  let got = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        got += chunk.length;
        yield chunk;
      }
    },
    createWriteStream(part),
  );

  const digest = hash.digest("hex");
  const wrong =
    got !== asset.bytes
      ? `it is ${got.toLocaleString()} bytes and this expects ${asset.bytes.toLocaleString()}`
      : digest !== asset.sha256
        ? `its sha256 is ${digest} and this expects ${asset.sha256}`
        : "";
  if (wrong) {
    await fs.rm(part, { force: true });
    throw new Error(
      `The download from nodejs.org is not the file this build expects: ${wrong}. ` +
        `Nothing was kept. If nodejs.org has re-published v${NODE}, take the new digest ` +
        `from its SHASUMS256.txt and change it in this file, where it is reviewed.`,
    );
  }

  await fs.rm(final, { force: true });
  await fs.rename(part, final);
  console.log(`  verified (sha256 ok, ${got.toLocaleString()} bytes).`);
}

main().catch((e) => {
  console.error(`Could not fetch Node: ${e.message ?? e}`);
  process.exit(1);
});
