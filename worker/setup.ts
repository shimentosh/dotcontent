import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { run, toolStatuses, toolsBin, whisperModels } from "../lib/server/tools";
import { toolsRoot } from "./config";

/**
 * `npm run worker:setup` — the tools, on a machine belonging to somebody who
 * does not have a compiler.
 *
 * The team this worker is for are not developers and they are on Windows.
 * That single fact decides everything in this file. `pip install openai-whisper`
 * is not an instruction you can give them: it needs a Python, then PyTorch,
 * then gigabytes, and then usually a conversation about CUDA. `winget install
 * Gyan.FFmpeg` needs an admin prompt and a PATH they will never look at again.
 * So this fetches four things into one folder inside the app and teaches the
 * worker to look there — and that is the whole mechanism. There is no
 * installer, no service, no registry key and nothing to uninstall.
 *
 * Five rules, and each of them is here because the alternative is somebody's
 * own computer:
 *
 * - **Pinned, and said out loud.** Every version is a constant in this file
 *   with the URL beside it, and the plan is printed before anything is
 *   fetched. Nothing here ever resolves "latest": a script that silently pulls
 *   whatever a server feels like handing over today is not something to run on
 *   a colleague's laptop, and a pinned version is also the only way "it worked
 *   last week" is a question with an answer.
 * - **Verified.** Every download is checked against a sha256 published by the
 *   project that made it, and against the exact byte count where the publisher
 *   states one. Bytes land in `downloads/` under a `.part` name and are only
 *   moved into place after they pass — because a half-downloaded `yt-dlp.exe`
 *   left in `bin/` by a dropped wifi connection is a file the probe will
 *   happily report as an installed tool, and the failure would surface a week
 *   later as an ingest that cannot read any link.
 * - **Inside its own folder, always.** No PATH edit, no registry, no admin, no
 *   `%APPDATA%`. Removing this app means deleting a folder, and that promise
 *   is worth keeping literally.
 * - **Windows first, and honest elsewhere.** ffmpeg and whisper.cpp are
 *   fetched as Windows x64 builds. On macOS and Linux this says so and prints
 *   the platform's own one-liner rather than downloading a binary that cannot
 *   run.
 * - **Re-runnable.** What is already here is reported and skipped. Running it
 *   twice is how somebody adds a bigger model later, and it must not mean
 *   re-downloading three gigabytes.
 *
 * What it deliberately does NOT install: `claude`, `codex` and `gemini`, which
 * need that person's own login and are the app's job to detect rather than to
 * provide; and Ollama, which is a 700 MB download with its own installer and
 * is pointed at rather than pulled down uninvited. Both are reported at the
 * end, so one command still answers "is this machine ready".
 */

/* ── What gets downloaded, pinned ───────────────────────────────────────── */

/**
 * yt-dlp, 2026-08-19.
 *
 * The one tool here that goes stale on a schedule nobody controls: it breaks
 * when a platform changes its player, which happens without warning and
 * roughly monthly. It also updates itself — `yt-dlp -U` replaces the very file
 * this puts in `bin/`, needs no admin because the file is ours, and is the
 * right answer when a link that used to work stops working.
 */
const YT_DLP = "2026.08.19";

/** FFmpeg 9.0.1, gyan.dev's "essentials" build — the one ffmpeg.org links to
 *  for Windows. Static, so ffmpeg.exe and ffprobe.exe carry no DLLs with them. */
const FFMPEG = "9.0.1";

/** whisper.cpp release b4938 (v1.9.3), 2026-08-20. */
const WHISPER = "b4938";

/** A file to fetch: where from, and what it must turn out to be. */
type Asset = {
  url: string;
  /** Lower-case hex, as the project that built the file publishes it. */
  sha256: string;
  /** Exact size, or 0 when the publisher does not state one. */
  bytes: number;
  /** Roughly how big, for the line printed before anything is downloaded. */
  about: string;
};

const YT_DLP_ASSETS: Record<string, Asset> = {
  win32: {
    url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP}/yt-dlp.exe`,
    sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
    bytes: 17_840_399,
    about: "17 MB",
  },
  linux: {
    url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP}/yt-dlp_linux`,
    sha256: "b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc",
    bytes: 40_446_224,
    about: "40 MB",
  },
  darwin: {
    url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP}/yt-dlp_macos`,
    sha256: "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
    bytes: 37_146_048,
    about: "37 MB",
  },
};

/**
 * gyan.dev states a sha256 next to each package and does not state a byte
 * count, so `bytes` is 0 and the digest carries the whole verification. Taken
 * from https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-essentials_build.zip.sha256
 */
const FFMPEG_ASSET: Asset = {
  url: `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${FFMPEG}-essentials_build.zip`,
  sha256: "fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9",
  bytes: 0,
  about: "~106 MB",
};

/**
 * Two whisper.cpp builds, and the second one is a decision worth making
 * deliberately.
 *
 * `cpu` is eight megabytes and runs anywhere. `cublas` is the same program
 * built against CUDA 12.4 — the GPU path, and the reason transcription is
 * worth sending to a desktop at all — but it is 671 MB and it does nothing at
 * all without an NVIDIA card and a current driver. Defaulting to it would mean
 * two thirds of a gigabyte downloaded onto a laptop that cannot use a byte of
 * it, so it is asked for by name.
 */
const WHISPER_ASSETS: Record<string, Asset> = {
  cpu: {
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER}/whisper-bin-x64.zip`,
    sha256: "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d",
    bytes: 8_361_840,
    about: "8 MB",
  },
  cublas: {
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER}/whisper-cublas-12.4.0-bin-x64.zip`,
    sha256: "c1b17166e1e31a91cc8e9c1f910d3785e3ce757bb2958bf9dce13fdb4880005f",
    bytes: 671_045_732,
    about: "671 MB — needs an NVIDIA GPU and a CUDA 12 driver",
  },
};

/**
 * The models, and what each one costs.
 *
 * This table is the point of the `--models` flag: choosing a whisper model is
 * a trade between disk, time and how many words come back wrong, and nobody
 * can make it from a list of names. Speeds are for a CPU; a GPU build moves
 * every row up by roughly an order of magnitude.
 *
 * sha256 and byte counts come from the Hugging Face API for
 * `ggerganov/whisper.cpp`, which stores them as the LFS object id — so these
 * are the digests the file is addressed by, not ones anybody typed.
 */
const MODELS: Record<string, Asset & { accuracy: string }> = {
  tiny: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    bytes: 77_691_713,
    about: "74 MB",
    accuracy: "roughest. Clear English only; mangles names and accents. Several times faster than real time.",
  },
  base: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    bytes: 147_951_465,
    about: "141 MB",
    accuracy: "the default. Fine on clean speech, roughly real time on a CPU, wrong often enough on strong accents and music beds to notice.",
  },
  small: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    bytes: 487_601_967,
    about: "465 MB",
    accuracy: "clearly better on accents, noise and non-English. About three times slower than base.",
  },
  medium: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    bytes: 1_533_763_059,
    about: "1.4 GB",
    accuracy: "close to the best. Slow enough on a CPU that a ten-minute reel can outlast the job's timeout.",
  },
  "large-v3-turbo": {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    bytes: 1_624_555_275,
    about: "1.5 GB",
    accuracy: "near-large accuracy at roughly medium speed. The best trade on a machine with a GPU.",
  },
  "large-v3": {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
    bytes: 3_095_033_483,
    about: "2.9 GB",
    accuracy: "the best there is. Hours per hour of audio without a GPU — do not pick this for a laptop.",
  },
};

/** Named so somebody reading the folder knows what put it there. */
const MANIFEST = "installed.json";

type Manifest = {
  updatedAt?: string;
  tools?: Record<string, { version?: string; from?: string; sha256?: string; at?: string }>;
};

/* ── Running it ─────────────────────────────────────────────────────────── */

type Args = {
  yes: boolean;
  force: boolean;
  help: boolean;
  listModels: boolean;
  dryRun: boolean;
  only: Set<string>;
  model: string;
  whisperBuild: string;
  dir: string;
};

const KNOWN = ["yt-dlp", "ffmpeg", "whisper"];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    yes: false,
    force: false,
    help: false,
    listModels: false,
    dryRun: false,
    only: new Set<string>(),
    model: "base",
    whisperBuild: "cpu",
    dir: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "-y" || a === "--yes") args.yes = true;
    else if (a === "--force") args.force = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--models") args.listModels = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") for (const id of next().split(",")) args.only.add(id.trim());
    else if (a === "--model") args.model = next().trim();
    else if (a === "--whisper") args.whisperBuild = next().trim();
    else if (a === "--dir") args.dir = next().trim();
    else throw new Error(`I do not know the option "${a}". Run with --help to see the ones I do.`);
  }
  const unknown = [...args.only].filter((id) => !KNOWN.includes(id));
  if (unknown.length) {
    throw new Error(`--only takes ${KNOWN.join(", ")}; "${unknown.join(", ")}" is none of them.`);
  }
  if (!MODELS[args.model]) {
    throw new Error(
      `There is no whisper model called "${args.model}". Run with --models to see the choices.`,
    );
  }
  if (!WHISPER_ASSETS[args.whisperBuild]) {
    throw new Error(`--whisper takes cpu or cublas, not "${args.whisperBuild}".`);
  }
  return args;
}

function help() {
  say(`npm run worker:setup -- [options]

Downloads the tools this machine is missing into the app's own folder. Nothing
is installed system-wide: no PATH edit, no registry, no admin. Undo it by
deleting that folder.

  -y, --yes            Do not ask before downloading.
      --force          Fetch again even if the tool is already here.
      --only a,b       Only these: ${KNOWN.join(", ")}.
      --model NAME     Which whisper model (default: base). --models lists them.
      --whisper cpu    Which whisper.cpp build. "cublas" is the GPU one:
                       671 MB, and useless without an NVIDIA card.
      --dir PATH       Put the tools somewhere else. Also settable as
                       DOTCONTENT_TOOLS_DIR, which the worker reads too.
      --dry-run        Print the plan and stop.
      --models         Print the model sizes and what they cost in accuracy.
  -h, --help           This.`);
}

function listModels() {
  say("whisper models — disk, and what the size buys:\n");
  for (const [name, m] of Object.entries(MODELS)) {
    say(`  ${name.padEnd(16)} ${m.about.padEnd(8)} ${m.accuracy}`);
  }
  say(`
Every one of them is multilingual; the ".en" variants are English-only and are
deliberately not offered, because this console is used for Bangla as well.
Pick one with:  npm run worker:setup -- --model small`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (args.listModels) return listModels();

  // Before anything reads the tools directory: --dir wins, then whatever is
  // already in the environment, then the folder beside worker/.
  if (args.dir) process.env.DOTCONTENT_TOOLS_DIR = path.resolve(args.dir);
  const root = toolsRoot();
  const bin = toolsBin();
  const models = whisperModels();

  say(`dotcontent worker setup`);
  say(`Tools folder: ${root}`);
  say(`Platform:     ${process.platform} ${process.arch}\n`);

  const steps = await plan(args, bin, models);

  for (const step of steps.filter((s) => s.state !== "fetch")) {
    // The path matters when the answer is "it is already there" and is noise
    // when the answer is "you did not ask for it".
    say(`  ${mark(step.state)} ${step.title}${step.state === "skip" ? "" : ` — ${step.why}`}`);
  }

  const fetching = steps.filter((s) => s.state === "fetch");
  if (!fetching.length) {
    say("\nNothing to download.\n");
    await report(root);
    return;
  }

  /*
   * Everything, out loud, before a byte moves.
   *
   * This is the part that is not negotiable. Somebody is being asked to let a
   * script pull two hundred megabytes of executables onto their own computer,
   * and the least they are owed is the list: what, from whose server, how big,
   * and pinned to which version.
   */
  say("\nAbout to download:\n");
  for (const step of fetching) {
    say(`  ${step.title}  (${step.asset.about})`);
    say(`      from ${step.asset.url}`);
    say(`      sha256 ${step.asset.sha256}`);
  }
  say(`\n  into ${root}`);
  say("  Nothing outside that folder is written, changed or added to PATH.\n");

  if (args.dryRun) return say("--dry-run: stopping here.");
  if (!(await confirm(args.yes))) return say("Nothing was downloaded.");

  say("");
  const manifest = await readManifest(root);
  manifest.tools ??= {};

  for (const step of fetching) {
    await step.install();
    manifest.tools[step.id] = {
      version: step.version,
      from: step.asset.url,
      sha256: step.asset.sha256,
      at: new Date().toISOString(),
    };
    await writeManifest(root, manifest);
  }

  // The staging area is scratch, and a gigabyte of it. Nothing here is needed
  // once the files have been verified and moved.
  await fs.rm(path.join(root, "downloads"), { recursive: true, force: true }).catch(() => {});

  say("");
  await report(root);
}

/* ── The plan ───────────────────────────────────────────────────────────── */

type State = "fetch" | "have" | "skip" | "unsupported";

type Step = {
  id: string;
  title: string;
  version: string;
  asset: Asset;
  state: State;
  why: string;
  install: () => Promise<void>;
};

const mark = (state: State) =>
  (state === "have" ? "already here:" : state === "unsupported" ? "not here:" : "not asked for:").padEnd(15);

/**
 * What each tool's state is, and why, before anything is downloaded.
 *
 * Four states rather than two, because "I am not going to download this" has
 * three different meanings and a person deciding what to do next needs to know
 * which: it is already here, you did not ask for it, or this platform is not
 * one I have a binary for. Collapsing them into a silent skip is how somebody
 * ends up waiting for an ffmpeg that was never going to arrive.
 */
async function plan(args: Args, bin: string, models: string): Promise<Step[]> {
  const wanted = (id: string) => args.only.size === 0 || args.only.has(id);
  const win = process.platform === "win32";
  const steps: Step[] = [];

  const decide = async (id: string, supported: boolean, already: Promise<boolean> | boolean) =>
    !wanted(id) ? "skip" : !supported ? "unsupported" : (await already) ? "have" : ("fetch" as State);

  /* yt-dlp — one file, one download, and the project builds one per platform. */
  const ytAsset = YT_DLP_ASSETS[process.platform] ?? YT_DLP_ASSETS.linux;
  const ytName = win ? "yt-dlp.exe" : "yt-dlp";
  const ytHere = path.join(bin, ytName);
  const ytState = await decide(
    "yt-dlp",
    Boolean(YT_DLP_ASSETS[process.platform]),
    settled(ytHere, ytAsset.bytes, args.force),
  );
  steps.push({
    id: "yt-dlp",
    title: `yt-dlp ${YT_DLP}`,
    version: YT_DLP,
    asset: ytAsset,
    state: ytState,
    why:
      ytState === "unsupported"
        ? `yt-dlp publishes no single-file build for ${process.platform}; install it the way this machine installs things.`
        : ytHere,
    install: async () => {
      const file = await fetchVerified(ytAsset, "yt-dlp", bin, ytName);
      // Downloaded files are not executable on macOS or Linux, and the failure
      // is EACCES from a shell rather than anything that names the cause.
      if (!win) await fs.chmod(file, 0o755).catch(() => {});
    },
  });

  /* ffmpeg + ffprobe — one zip, two executables out of it. */
  const ffHere = path.join(bin, win ? "ffmpeg.exe" : "ffmpeg");
  const ffState = await decide(
    "ffmpeg",
    win,
    (async () =>
      (await exists(ffHere)) && (await exists(path.join(bin, win ? "ffprobe.exe" : "ffprobe"))) &&
      !args.force)(),
  );
  steps.push({
    id: "ffmpeg",
    title: `ffmpeg + ffprobe ${FFMPEG}`,
    version: FFMPEG,
    asset: FFMPEG_ASSET,
    state: ffState,
    why: ffState === "unsupported" ? nativeAdvice("ffmpeg") : ffHere,
    install: async () => {
      const zip = await fetchVerified(FFMPEG_ASSET, "ffmpeg", "", "");
      const stage = await unzip(zip, "ffmpeg");
      // Found by walking rather than by the folder name inside the archive:
      // that name carries the version, so hard-coding it would mean this
      // function needs editing every time the pin moves.
      for (const want of ["ffmpeg.exe", "ffprobe.exe"]) {
        const found = await findFile(stage, want);
        if (!found) throw new Error(`The FFmpeg archive did not contain ${want}.`);
        await place(found, path.join(bin, want));
      }
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    },
  });

  /* whisper.cpp — the executable, its DLLs, and separately a model. */
  const whisperAsset = WHISPER_ASSETS[args.whisperBuild];
  const whisperHere = path.join(bin, "whisper-cli.exe");
  const whisperState = await decide(
    "whisper",
    win,
    (async () => (await exists(whisperHere)) && !args.force)(),
  );
  steps.push({
    id: "whisper",
    title: `whisper.cpp ${WHISPER} (${args.whisperBuild})`,
    version: `${WHISPER} ${args.whisperBuild}`,
    asset: whisperAsset,
    state: whisperState,
    why: whisperState === "unsupported" ? nativeAdvice("whisper.cpp") : whisperHere,
    install: async () => {
      const zip = await fetchVerified(whisperAsset, "whisper", "", "");
      const stage = await unzip(zip, "whisper");
      const exe = (await findFile(stage, "whisper-cli.exe")) ?? (await findFile(stage, "main.exe"));
      if (!exe) throw new Error("The whisper.cpp archive did not contain whisper-cli.exe.");
      await place(exe, path.join(bin, "whisper-cli.exe"));
      /*
       * The DLLs beside it, all of them.
       *
       * whisper.cpp's Windows build is not one static file: whisper.dll,
       * ggml.dll and a handful of ggml-cpu-* variants sit next to the exe and
       * are loaded from the exe's own directory. Copying only the executable
       * produces a program that exists, is found by the probe, and dies on
       * launch with a dialog about a missing DLL — which reaches the console
       * as a whisper that "crashed" for no stated reason.
       */
      const beside = path.dirname(exe);
      for (const file of await fs.readdir(beside)) {
        if (file.toLowerCase().endsWith(".dll")) {
          await place(path.join(beside, file), path.join(bin, file));
        }
      }
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    },
  });

  /*
   * The model, which is a separate step because it is a separate failure.
   *
   * A machine with whisper-cli.exe and no `.bin` cannot transcribe anything,
   * and the probe in lib/server/tools.ts reports exactly that rather than
   * calling whisper present — so this row going missing is visible on the
   * Integrations page as its own sentence with its own fix.
   */
  const model = MODELS[args.model];
  const modelFile = path.join(models, `ggml-${args.model}.bin`);
  steps.push({
    id: "whisper-model",
    title: `whisper model "${args.model}"`,
    version: args.model,
    asset: model,
    // Always supported: a model is a data file, and somebody who installed
    // whisper.cpp with brew still needs one.
    state: await decide("whisper", true, settled(modelFile, model.bytes, args.force)),
    why: `${modelFile} — ${model.accuracy}`,
    install: async () => {
      await fetchVerified(model, "whisper-model", models, `ggml-${args.model}.bin`);
    },
  });

  return steps;
}

/** What to type on a platform this script does not fetch binaries for. */
function nativeAdvice(what: string) {
  const mac = what === "ffmpeg" ? "brew install ffmpeg" : "brew install whisper-cpp";
  const linux = what === "ffmpeg" ? "sudo apt install ffmpeg" : "build it from ggml-org/whisper.cpp";
  return process.platform === "darwin"
    ? `only fetched for Windows here. On macOS: ${mac}`
    : `only fetched for Windows here. On Linux: ${linux}`;
}

/* ── Fetching, and being sure about what arrived ────────────────────────── */

/**
 * Download one file, prove it is the right one, then put it where it goes.
 *
 * The order is the whole point. Bytes go to `downloads/<name>.part`, the hash
 * and the length are computed while they stream past, and only a file that
 * matches both is moved into `bin/` or `models/`. A dropped connection, a
 * captive-portal login page served with a 200, a proxy that truncates at 2 GB
 * — every one of those leaves a `.part` behind and nothing that the probe will
 * later mistake for an installed tool.
 *
 * `dest`/`name` empty means "leave it in downloads": the archives are unpacked
 * from there and never belong in bin/.
 */
async function fetchVerified(asset: Asset, label: string, dest: string, name: string) {
  const staging = path.join(toolsRoot(), "downloads");
  await fs.mkdir(staging, { recursive: true });
  const part = path.join(staging, `${label}.part`);
  /*
   * An archive keeps the extension it was published with.
   *
   * `Expand-Archive` refuses, by name, any path that does not end in `.zip` —
   * it is a check on the string, not on the bytes — so a staged file called
   * `ffmpeg` would unpack fine through `tar` and fail on exactly the machines
   * old enough to need the PowerShell fallback.
   */
  const final = dest
    ? path.join(dest, name)
    : path.join(staging, label + path.extname(new URL(asset.url).pathname));

  await fs.rm(part, { force: true }).catch(() => {});

  const res = await fetch(asset.url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`${asset.url} answered ${res.status} ${res.statusText}. Nothing was written.`);
  }

  /*
   * Content-Length, checked before the download rather than after it.
   *
   * When the server states a length and it is not the length we pinned, the
   * file at that URL is not the file this script was written against — a
   * re-rolled release, a mirror, or an error page with a 200 on it — and there
   * is no point spending somebody's bandwidth to find that out at the end.
   */
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (asset.bytes && declared && declared !== asset.bytes) {
    throw new Error(
      `${asset.url} is ${declared} bytes and this expects ${asset.bytes}. ` +
        `That is not the file this version was pinned to; nothing was written.`,
    );
  }

  const hash = createHash("sha256");
  let got = 0;
  let shown = 0;
  const watch = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      got += chunk.length;
      const total = asset.bytes || declared;
      if (total && got - shown > total / 20) {
        shown = got;
        progress(label, got, total);
      }
      done(null, chunk);
    },
  });

  say(`  ${label}: downloading ${asset.about}…`);
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    watch,
    createWriteStream(part),
  );
  progress(label, got, asset.bytes || declared || got);
  if (process.stdout.isTTY) process.stdout.write("\n");

  const digest = hash.digest("hex");
  if (digest !== asset.sha256) {
    await fs.rm(part, { force: true }).catch(() => {});
    throw new Error(
      `${label} downloaded, but its sha256 is ${digest} and this expects ${asset.sha256}. ` +
        `The file was deleted. Either the release was re-published or something is between ` +
        `this machine and ${new URL(asset.url).host}.`,
    );
  }
  if (asset.bytes && got !== asset.bytes) {
    await fs.rm(part, { force: true }).catch(() => {});
    throw new Error(`${label} arrived as ${got} bytes, not ${asset.bytes}. The file was deleted.`);
  }
  if (!got) {
    await fs.rm(part, { force: true }).catch(() => {});
    throw new Error(`${label} arrived empty. The file was deleted.`);
  }

  await fs.mkdir(path.dirname(final), { recursive: true });
  // rename, not copy: it is one filesystem operation, it cannot half-happen,
  // and there is never a moment when a partly-written file sits at the name
  // the probe looks for.
  await fs.rename(part, final);
  say(`  ${label}: verified (sha256 ok, ${got.toLocaleString()} bytes) → ${final}`);
  return final;
}

/** Whether a file is here AND the size it should be. */
async function settled(file: string, bytes: number, force: boolean) {
  if (force) return false;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    /*
     * A model half-copied off a USB stick, or left by a version of this script
     * that did not stage its downloads, is a file that exists and does not
     * work. Skipping it because the name is right is how somebody spends a
     * week being told whisper crashed.
     */
    if (bytes && stat.size !== bytes) return false;
    return true;
  } catch {
    return false;
  }
}

const exists = (file: string) =>
  fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false);

/**
 * Unpack a zip with what Windows already has.
 *
 * `tar` has shipped in Windows since 1803 and reads zips, which makes it the
 * cheapest option and the one that does not load a PowerShell profile. If it
 * is not there, `Expand-Archive` is. Neither needs a dependency in
 * package.json, which is deliberate: a setup script whose job is to avoid
 * making people install things should not itself need an install.
 */
async function unzip(zip: string, label: string) {
  const stage = path.join(toolsRoot(), "downloads", `${label}-unpacked`);
  await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(stage, { recursive: true });

  const viaTar = await run("tar", ["-xf", zip, "-C", stage], { timeout: 600_000 });
  if (viaTar.code === 0) return stage;

  if (process.platform === "win32") {
    // Single quotes inside the -Command string, so nothing has to survive
    // cmd.exe's idea of a backslash-escaped double quote on the way in.
    const ps = (v: string) => `'${v.replace(/'/g, "''")}'`;
    const viaPs = await run(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath ${ps(zip)} -DestinationPath ${ps(stage)} -Force`,
      ],
      { timeout: 600_000 },
    );
    if (viaPs.code === 0) return stage;
    throw new Error(
      `Could not unpack ${path.basename(zip)}. tar said "${firstLine(viaTar.err)}" and ` +
        `Expand-Archive said "${firstLine(viaPs.err)}".`,
    );
  }

  throw new Error(
    `Could not unpack ${path.basename(zip)}: ${firstLine(viaTar.err) || `tar exited ${viaTar.code}`}`,
  );
}

/** The first file with this name, anywhere under a directory. */
async function findFile(root: string, name: string): Promise<string> {
  const want = name.toLowerCase();
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const deeper = await findFile(full, name);
      if (deeper) return deeper;
    } else if (entry.name.toLowerCase() === want) {
      return full;
    }
  }
  return "";
}

/** Copy one file into place, replacing whatever was there. */
async function place(from: string, to: string) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.copyFile(from, to);
  } catch (e) {
    /*
     * Windows will not overwrite a file something has open, and the something
     * is almost always the worker itself — an ffmpeg mid-ingest, or a
     * whisper-cli holding its own DLLs. "EBUSY: resource busy or locked" names
     * the syscall and not the situation, and the fix is one sentence.
     */
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "ETXTBSY") {
      throw new Error(
        `${path.basename(to)} is in use, so it cannot be replaced. Stop the worker (Ctrl-C in its window) and run this again.`,
      );
    }
    throw e;
  }
}

/* ── Saying what happened ───────────────────────────────────────────────── */

/**
 * What this machine can actually do now, probed rather than assumed.
 *
 * The same `toolStatuses()` the worker reports at registration, forced past
 * its cache — so this is not a summary of what was downloaded, it is the
 * worker's own answer to "what is on this machine", asked immediately. A tool
 * that downloaded perfectly and cannot run — a missing Visual C++ runtime, an
 * antivirus that quarantined the exe — shows up here rather than three days
 * later as a job that failed on somebody's laptop.
 */
async function report(root: string) {
  say("This machine, as the worker sees it:\n");
  const tools = await toolStatuses(true);
  for (const tool of tools) {
    const what = tool.present
      ? `${tool.version || "installed"}${tool.flavor ? ` (${tool.flavor})` : ""}`
      : tool.error;
    say(`  ${tool.present ? "yes" : "no "}  ${tool.id.padEnd(10)} ${what}`);
  }

  const missing = tools.filter((t) => !t.present);
  const clis = missing.filter((t) => ["claude", "codex", "gemini"].includes(t.id));
  if (clis.length) {
    say(`
The model CLIs are not installed by this script on purpose: each one signs in
as you, with your own subscription, and the app's job is to detect them rather
than to own them. Install and sign in to whichever you use:`);
    for (const cli of clis) say(`  ${cli.id.padEnd(8)} ${cli.install}`);
  }

  await ollama();

  say(`
Everything this script installed lives in ${root}. Nothing else on this
computer was changed — no PATH, no registry, nothing installed for all users.
To undo it, delete that folder.

yt-dlp goes stale when a platform changes its player, which is why an ingest
that worked last month can stop. It updates itself:
  ${path.join(toolsBin(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")} -U

Now start the worker:  npm run worker`);
}

/**
 * Ollama, detected and pointed at rather than downloaded.
 *
 * It is roughly 700 MB with its own installer and its own model downloads on
 * top, and it is optional — one brain out of four, and the only one that is an
 * HTTP server rather than a CLI. Pulling that down uninvited on somebody's
 * laptop to save them a click is not a trade this script gets to make.
 */
async function ollama() {
  const url = (process.env.DOTCONTENT_OLLAMA_URL ?? "").trim().replace(/\/+$/, "") ||
    "http://localhost:11434";
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const body = (await res.json()) as { models?: { name?: string }[] };
      const names = (body.models ?? []).map((m) => m.name).filter(Boolean);
      say(`
Ollama is running at ${url}${names.length ? ` with ${names.length} model(s): ${names.slice(0, 4).join(", ")}` : " with no models pulled yet — try: ollama pull llama3.1"}.`);
      return;
    }
  } catch {
    // Not running, not installed, or a firewall. All three are the same
    // sentence to whoever is reading, and none of them is an error here.
  }
  say(`
Ollama is optional and is not answering at ${url}. It is only needed for the
local-model brain; if you want it, it has its own installer at
https://ollama.com/download and then: ollama pull llama3.1`);
}

/* ── Small things ───────────────────────────────────────────────────────── */

async function readManifest(root: string): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, MANIFEST), "utf8")) as Manifest;
  } catch {
    return {};
  }
}

/**
 * Written after every tool rather than once at the end.
 *
 * A run that fails on the third download has still installed the first two,
 * and a manifest that only exists on a clean finish would describe a folder
 * that does not match it — which matters because `lib/server/tools.ts` reads
 * this file to report the version of a whisper.cpp that has no --version flag.
 */
async function writeManifest(root: string, manifest: Manifest) {
  manifest.updatedAt = new Date().toISOString();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Ask, unless told not to.
 *
 * A prompt is only possible when somebody is there to answer it. With no
 * terminal — a CI job, a Tauri sidecar, a scheduled task — the answer is not
 * "assume yes": the whole rule is that nothing downloads without somebody
 * having said so, and in that situation `--yes` is how they say it.
 */
async function confirm(yes: boolean) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    say(
      "There is no terminal here to ask, and nothing downloads unasked.\n" +
        "Run it again with --yes if this is what you want:  npm run worker:setup -- --yes",
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Download these? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function progress(label: string, got: number, total: number) {
  if (!process.stdout.isTTY) return;
  const mb = (n: number) => (n / 1_048_576).toFixed(1);
  const pct = total ? ` ${Math.min(100, Math.round((got / total) * 100))}%` : "";
  process.stdout.write(`\r  ${label}: ${mb(got)} / ${mb(total)} MB${pct}   `);
}

const firstLine = (text: string) => (text.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();

function say(line: string) {
  console.log(line);
}

main().catch((e: unknown) => {
  /*
   * One sentence, no stack trace.
   *
   * Whoever is reading this is looking at a console window on their own
   * laptop because somebody told them to run one command, and every failure
   * this script can have — a wrong option, a checksum that did not match, no
   * network — is already written as a sentence that says what to do next.
   */
  console.error(`\nSetup stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
