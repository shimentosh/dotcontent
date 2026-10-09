import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The binaries on this machine, and how to run them.
 *
 * The Integrations page used to hold a set of ids in memory and call that a
 * connection. Nothing checked whether yt-dlp was installed; the page showed
 * "2024.08" next to a tool that might not exist. Every claim here is the
 * result of actually running the thing.
 */

export type ToolId =
  | "yt-dlp"
  | "ffmpeg"
  | "ffprobe"
  | "whisper"
  | "claude"
  | "codex"
  | "gemini";

/**
 * Which program answered, for a tool id that names more than one program.
 *
 * `whisper` is the only one, and the two are not variants of each other:
 * **whisper.cpp** is a single executable plus a `.bin` model, and
 * **openai-whisper** is a Python package that pulls PyTorch behind it. They
 * take different arguments and write their output to different places, so
 * whoever runs the tool has to know which one the probe found — and the probe
 * is the only thing that can know.
 *
 * Optional because a row read back out of `workers.tools` may have been
 * written by a worker from before this existed, and a missing flavour must
 * read as "unsaid" rather than crash a page.
 */
export type ToolFlavor = "" | "whisper.cpp" | "openai-whisper";

export type ToolStatus = {
  id: ToolId;
  /** The command that answered — not necessarily the first one tried. */
  command: string;
  /** Environment the tool needs to run at all. */
  env: Record<string, string>;
  /**
   * What has to come before the tool's own arguments.
   *
   * Empty for a plain binary; `["-m", "whisper"]` for one reached through
   * Python. Whoever runs the tool prepends these, so a module install and a
   * binary install are the same call site.
   */
  lead: string[];
  present: boolean;
  /** What `--version` said, trimmed to something a row can show. */
  version: string;
  /** Why it is not present, when it is not. */
  error: string;
  /** How to get it, for a tool that is missing. */
  install: string;
  /** Which program this is, when the id names more than one. */
  flavor?: ToolFlavor;
};

/** One way of reaching a tool: a command, its probe arguments, its quirks. */
type Attempt = {
  command: string;
  args: string[];
  /** Which program this invocation reaches. */
  flavor?: ToolFlavor;
  /** Environment this particular way of reaching the tool needs. */
  env?: Record<string, string>;
  /**
   * Something the answer has to contain before it counts.
   *
   * Only whisper.cpp needs this, and it needs it badly: its CLI used to be
   * called `main`, which is also the most ordinary name anybody has ever given
   * an executable. "It exited 0 and printed something" is not enough evidence
   * to hand a stranger a WAV file and believe the text that comes back, so the
   * output has to look like whisper's usage as well.
   */
  mustSay?: RegExp;
  /**
   * Whether this program is useless without a model file beside it.
   *
   * True for whisper.cpp, and it is the distinction the ingest kept getting
   * wrong in other places: a machine with the executable and no `.bin` is not
   * a machine that can transcribe. Reporting it as present would route
   * transcription jobs to it and fail every one of them, which is exactly the
   * "queued forever" failure `docs/WORKER.md` argues against.
   */
  needsModel?: boolean;
};

type Probe = Attempt & {
  id: ToolId;
  install: string;
  /**
   * Other ways the same tool can be reached, best first.
   *
   * `pip install openai-whisper` writes `whisper` into Python's Scripts
   * directory, which on Windows is usually not on PATH — so the tool is
   * installed, the probe says "not found", and the person is told to install
   * something they already have. Python can always run it as a module, so
   * that is tried next and, when it answers, becomes the command everything
   * else uses.
   */
  alternates?: Attempt[];
};

/**
 * A Python console is cp1252 on Windows and whisper's `--help` contains a
 * Japanese character: printing the help crashed with UnicodeEncodeError, so an
 * installed whisper reported itself as missing. The same encoding is used when
 * it actually runs, where the crash would land mid-transcript rather than
 * mid-probe.
 */
const PY = { PYTHONIOENCODING: "utf-8" };

/**
 * What whisper's usage says and a stray `main` on somebody's PATH does not.
 *
 * `-otxt, --output-txt` has been in whisper.cpp's usage since long before the
 * `main` → `whisper-cli` rename, so it matches the old builds this has to find
 * as well as the new ones.
 */
const WHISPER_CPP = /--output-txt|whisper/i;

/** One command, so the Integrations page's install line stays one line. */
const SETUP = "npm run worker:setup";

const PROBES: Probe[] = [
  {
    id: "yt-dlp",
    command: "yt-dlp",
    args: ["--version"],
    // The installer puts a pinned yt-dlp in this app's own folder, which is
    // the only route a teammate who is not a developer has. `pip install -U
    // yt-dlp` still works and is still in docs/WORKER.md for anybody who has
    // a Python to install it into.
    install: SETUP,
  },
  {
    id: "ffmpeg",
    command: "ffmpeg",
    args: ["-version"],
    install: SETUP,
  },
  {
    id: "ffprobe",
    command: "ffprobe",
    args: ["-version"],
    install: SETUP,
  },
  {
    id: "whisper",
    /*
     * whisper.cpp FIRST, and the order is the decision rather than an accident
     * of which was written down earlier.
     *
     * It is the one a non-developer can end up with: a single executable and a
     * downloaded `.bin`, fetched by `npm run worker:setup` without Python,
     * without PyTorch, without gigabytes and without a CUDA story. It is also
     * the one with a GPU path — the cuBLAS build is the same executable — and
     * it takes 16 kHz mono WAV, which is precisely what the ingest already
     * uploads. openai-whisper stays below it because a machine that has both
     * should use the one this project can install, update and explain.
     */
    command: "whisper-cli",
    args: ["-h"],
    flavor: "whisper.cpp",
    mustSay: WHISPER_CPP,
    needsModel: true,
    install: SETUP,
    alternates: [
      // whisper.cpp called its CLI `main` until v1.7.4, and somebody who built
      // it themselves a year ago still has that name. `mustSay` is what makes
      // trying a word this generic safe.
      {
        command: "main",
        args: ["-h"],
        flavor: "whisper.cpp",
        mustSay: WHISPER_CPP,
        needsModel: true,
      },
      { command: "whisper", args: ["--help"], flavor: "openai-whisper", env: PY },
      {
        command: "python",
        args: ["-m", "whisper", "--help"],
        flavor: "openai-whisper",
        env: PY,
      },
      {
        command: "python3",
        args: ["-m", "whisper", "--help"],
        flavor: "openai-whisper",
        env: PY,
      },
      {
        command: "py",
        args: ["-3", "-m", "whisper", "--help"],
        flavor: "openai-whisper",
        env: PY,
      },
    ],
  },
  {
    id: "claude",
    command: "claude",
    args: ["--version"],
    install: "npm i -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    command: "codex",
    args: ["--version"],
    install: "npm i -g @openai/codex",
  },
  {
    id: "gemini",
    command: "gemini",
    args: ["--version"],
    install: "npm i -g @google/gemini-cli",
  },
];

/**
 * One argument, safe to hand to a shell.
 *
 * Quoting lives here rather than at each call site. It was spread across three
 * files under two different names, which is how a URL with a space in it
 * becomes two arguments in one place and one in another — and the quoting was
 * inconsistent enough that Node warned about it on every spawn.
 */
const quote = (value: string) =>
  /*
   * Which shell, decided by which platform.
   *
   * `shell: true` runs cmd.exe on Windows and /bin/sh everywhere else, and
   * they do not escape the same way at all: cmd has no backslash escaping and
   * treats `$` and backticks as ordinary characters, so escaping them there
   * puts literal backslashes into the argument. Only the quote itself needs
   * handling. sh is the opposite — single quotes take everything literally,
   * and only an embedded single quote has to be broken out of.
   */
  process.platform === "win32"
    ? '"' + value.replace(/"/g, '\\"') + '"'
    : "'" + value.replace(/'/g, "'\\''") + "'";

/**
 * Where a model CLI is started from: an empty directory of our own.
 *
 * `claude`, `codex` and `gemini` all read the project they are started in —
 * CLAUDE.md, AGENTS.md, whatever sits in the working directory and its
 * parents — and fold it into the conversation. Spawned from the repo, every
 * script was quietly being written with this codebase's developer notes in
 * the model's context. Spawned from api/, the CLI walked up to the repo's
 * CLAUDE.md, was refused the `@AGENTS.md` it includes, and put a paragraph
 * about the refusal at the top of an English script.
 *
 * So the CLI gets a directory with nothing in it, under the data root, and
 * nothing about this codebase ever reaches a content run.
 */
export function cliHome() {
  const root = path.resolve(
    process.env.DOTCONTENT_DATA_DIR ?? path.join(process.cwd(), ".data"),
  );
  const dir = path.join(root, "cli");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Where `npm run worker:setup` puts the tools it fetched.
 *
 * The installer writes nothing outside this directory — no PATH edit, no
 * registry key, no admin prompt, no per-user Python — so removing the app
 * really is removing a folder. That promise is only worth something if the
 * probe looks in here, which is what `ours()` below does before it falls back
 * to PATH.
 *
 * Found through an environment variable rather than through `import.meta.url`,
 * and that is not a style preference: this file is also type-checked by
 * `api/tsconfig.json` as CommonJS, where `import.meta` is a compile error
 * (TS1343). `loadConfig()` in `worker/config.ts` sets the variable from its
 * own file's location, so a sidecar started from any working directory finds
 * the folder; `process.cwd()` is the fallback, which is the repo root for
 * every npm script in this project. The same variable is the seam for putting
 * the tools on another drive.
 *
 * Under `.data/` because `.gitignore` already ignores that directory. Anywhere
 * else and the first teammate to run the installer would find two hundred
 * megabytes of executables in `git status`, and the fix for that would be
 * somebody committing them.
 */
export function toolsDir() {
  const set = (process.env.DOTCONTENT_TOOLS_DIR ?? "").trim();
  return path.resolve(set || path.join(process.cwd(), ".data", "tools"));
}

/** The executables the installer downloaded. One flat directory on purpose:
 *  whisper.cpp needs its DLLs beside its .exe, and the probe needs one place
 *  to look rather than a list that has to be kept in step with the catalogue. */
export const toolsBin = () => path.join(toolsDir(), "bin");

/** The `.bin` files whisper.cpp is useless without. */
export const whisperModels = () => path.join(toolsDir(), "models");

/**
 * The same command, but ours if we have one.
 *
 * PATH is the fallback here, not the first answer, and the order matters twice
 * over. A teammate who has just run the installer has yt-dlp inside the app
 * folder and nothing whatsoever on PATH — that is the whole point of not
 * editing PATH — so a probe that asked only PATH would report a machine with
 * no tools on it five minutes after installing them. And where both exist,
 * ours is the one whose version is pinned, checksummed and updatable; PATH may
 * hold a yt-dlp somebody pip-installed in 2021, which fails on today's
 * YouTube and is a genuinely confusing way to fail.
 */
function ours(command: string) {
  // .exe first: on Windows a name with no extension is not runnable, and
  // .cmd/.bat cover a shim if some future tool ships one.
  const names =
    process.platform === "win32"
      ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command]
      : [command];
  for (const name of names) {
    const full = path.join(toolsBin(), name);
    try {
      if (statSync(full).isFile()) return full;
    } catch {
      // Not that name. Try the next, then fall through to PATH.
    }
  }
  return "";
}

export type WhisperModelFile = { file: string; name: string };

const GGML = /^ggml-(.+)\.bin$/i;

/**
 * Smallest and roughest to largest and best. Used only to answer "the model
 * you asked for is not here, which of the ones that are is closest".
 */
const LADDER = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v2", "large-v3"];

const rank = (name: string) => {
  const i = LADDER.indexOf(name.replace(/\.en$/i, "").toLowerCase());
  return i < 0 ? LADDER.length : i;
};

/**
 * The `.bin` to hand whisper.cpp, or null when there is not one.
 *
 * Its absence is a **different failure from a missing executable** and has a
 * different remedy, which is why it is answered here rather than being left to
 * whisper.cpp's own "failed to load model" on stderr twenty minutes into a
 * queue. The probe uses this to decide whether whisper.cpp counts as present
 * at all, so a machine with the program and no model never gets handed a
 * transcription job it cannot do.
 *
 * `DOTCONTENT_WHISPER_MODEL` names one file and means it: somebody who already
 * has a models folder from another project points at it, and if that path is
 * wrong they are told so rather than being quietly given a different model.
 * Otherwise the exact name wins, then the nearest size that is actually here —
 * a machine with `base` installed should transcribe when the server asks for
 * `small`, at the accuracy it has, rather than failing a job over a preference.
 */
export function whisperModel(want = ""): WhisperModelFile | null {
  const named = (process.env.DOTCONTENT_WHISPER_MODEL ?? "").trim();
  if (named) {
    try {
      if (statSync(named).isFile()) return { file: named, name: path.basename(named) };
    } catch {
      // Named and not there. Deliberately not falling back to a different
      // model: a person who set this variable asked for one specific file.
    }
    return null;
  }

  let files: string[] = [];
  try {
    files = readdirSync(whisperModels());
  } catch {
    return null;
  }
  const models = files.filter((f) => GGML.test(f));
  if (!models.length) return null;

  const asked = (want || "base").trim().toLowerCase();
  const exact =
    models.find((f) => f.toLowerCase() === `ggml-${asked}.bin`) ??
    models.find((f) => f.toLowerCase() === `ggml-${asked}.en.bin`);

  const target = rank(asked);
  const chosen =
    exact ??
    [...models].sort((a, b) => {
      const ra = rank(a.replace(GGML, "$1"));
      const rb = rank(b.replace(GGML, "$1"));
      // Closest to what was asked for; on a tie the more accurate one, because
      // a transcript that took longer is recoverable and a worse one is not.
      return Math.abs(ra - target) - Math.abs(rb - target) || rb - ra;
    })[0];

  return { file: path.join(whisperModels(), chosen), name: chosen.replace(GGML, "$1") };
}

/** The sentence for a machine that has whisper.cpp and nothing to run it on. */
export function whisperModelGap() {
  const named = (process.env.DOTCONTENT_WHISPER_MODEL ?? "").trim();
  return named
    ? `whisper.cpp is installed here, but DOTCONTENT_WHISPER_MODEL points at ${named}, which is not a file.`
    : `whisper.cpp is installed here, but there is no model file in ${whisperModels()} for it to load.`;
}

/** Getting a model is a different command from getting the program. */
const MODEL_INSTALL = `${SETUP} -- --only whisper`;

export function run(
  command: string,
  args: string[],
  opts: {
    input?: string;
    timeout?: number;
    cwd?: string;
    /** Added to this process's environment for the child. */
    env?: Record<string, string>;
  } = {},
): Promise<{ code: number; out: string; err: string }> {
  /*
   * Run something and collect what it said.
   *
   * `shell: true` because on Windows these are almost always .cmd or .ps1
   * shims rather than real executables, and spawning one directly fails with
   * ENOENT even though it is plainly on PATH.
   *
   * The command is assembled into one string rather than passed as an argv
   * array: with a shell, Node concatenates the array anyway WITHOUT escaping
   * it, and says so in a deprecation warning on every call. Doing it here
   * means the escaping is ours, visible, and applied exactly once.
   *
   * A flag is passed through as written — `--model` must not arrive quoted —
   * so anything that is not a bare flag is quoted.
   */
  const line = [
    /*
     * The command is quoted too, once it stops being a bare name.
     *
     * It never used to be one: everything came off PATH as `ffmpeg`. Now the
     * installer hands back an absolute path inside the app folder, and on
     * Windows that folder is very often under `C:\Users\First Last\`. Unquoted,
     * the space splits it in two and cmd.exe reports that `C:\Users\First` is
     * not recognised — a sentence naming half a path nobody typed, about a
     * tool that is sitting right there.
     */
    /\s/.test(command) ? quote(command) : command,
    ...args.map((a) => (/^-{1,2}[\w:-]+$/.test(a) ? a : quote(a))),
  ].join(" ");

  return new Promise((resolve) => {
    const child = spawn(line, {
      shell: true,
      cwd: opts.cwd,
      windowsHide: true,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

    let out = "";
    let err = "";
    let settled = false;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, err });
    };

    const timer = setTimeout(() => {
      child.kill();
      err += `\nTimed out after ${opts.timeout ?? 30_000}ms`;
      finish(-1);
    }, opts.timeout ?? 30_000);

    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    // A missing binary is a failed probe, not a crashed server.
    child.on("error", (e) => {
      err += e.message;
      finish(-1);
    });
    child.on("close", (code) => finish(code ?? -1));

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

/*
 * Probes are cached for a minute.
 *
 * The integrations page polls, and asking Windows to start five processes on
 * every render is both slow and pointless — nothing installs itself between
 * two renders. Short enough that installing yt-dlp and coming back shows it.
 */
const CACHE_MS = 60_000;
const store = globalThis as unknown as {
  __dotcontentTools?: { at: number; value: ToolStatus[] };
};

/** One line out of a `--version` dump, which is often a whole banner. */
function firstVersion(text: string) {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  // A tool probed with --help answers with its usage, which is not a version
  // and reads as garbage in a column that expects one.
  if (/^usage:/i.test(line.trim())) return "installed";
  const semver = /\d+\.\d+(\.\d+)?([\w.-]*)/.exec(line);
  if (/^\d/.test(line.trim())) return line.trim().slice(0, 40);
  return (semver?.[0] ?? line.trim()).slice(0, 40);
}

/**
 * What the installer wrote down about what it put there.
 *
 * whisper.cpp's CLI has no `--version` flag at all, so a build we downloaded
 * ourselves would sit in the Integrations table saying "installed" next to a
 * yt-dlp saying `2026.08.19`. The installer records the release it pinned, and
 * a tool resolved out of our own bin directory reports that instead — a
 * version that is true because we chose it, rather than one the binary was
 * asked for and could not give.
 */
function pinnedVersion(id: ToolId) {
  try {
    const raw = readFileSync(path.join(toolsDir(), "installed.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      tools?: Record<string, { version?: string } | undefined>;
    };
    return String(parsed.tools?.[id]?.version ?? "");
  } catch {
    // No manifest, or one somebody hand-edited into invalid JSON. Neither is
    // a reason to report a tool that plainly answered as missing.
    return "";
  }
}

/** Everything before the tool's own flags: nothing for a binary,
 *  ["-m", "whisper"] for one reached through Python. */
const leadOf = (args: string[]) =>
  args.filter((a) => a === "-3" || a === "-m" || !a.startsWith("-"));

async function probe(p: Probe): Promise<ToolStatus> {
  const tries: Attempt[] = [p, ...(p.alternates ?? [])];

  let lastError = "";
  /*
   * A program that answered but still cannot do the job, remembered apart from
   * the ordinary "not found".
   *
   * whisper.cpp with no model is not the same failure as no whisper.cpp, and
   * telling somebody to install a program they are looking at is how a person
   * decides the tool report is lying to them. It is kept rather than returned
   * because openai-whisper may yet answer further down the list, and a machine
   * that can transcribe should say so.
   */
  let gap = "";

  for (const attempt of tries) {
    // Ours before PATH. See `ours()` — the installer never edits PATH, so a
    // freshly set-up machine has everything here and nothing there.
    const local = ours(attempt.command);
    const command = local || attempt.command;
    const env = attempt.env;

    const { code, out, err } = await run(command, attempt.args, { timeout: 12_000, env });
    const text = out || err;

    // `--help` exits 0 and prints usage; a missing binary exits non-zero with
    // "not found". Both are answered by whether anything came back at all.
    if (code !== 0 || !text.trim()) {
      lastError = err;
      continue;
    }

    if (attempt.mustSay && !attempt.mustSay.test(text)) {
      // Something is on PATH under that name and it is not this tool. Naming
      // it beats "not found", which would send somebody installing a program
      // that is already there under a name that is already taken.
      lastError = `\`${attempt.command}\` answered, but it is not ${p.id}`;
      continue;
    }

    if (attempt.needsModel && !whisperModel()) {
      gap = whisperModelGap();
      continue;
    }

    return {
      id: p.id,
      // The invocation that ANSWERED, not the one tried first, so whoever
      // runs the tool later runs the one that works — absolute path and all.
      command,
      env: env ?? {},
      lead: leadOf(attempt.args),
      present: true,
      version: (local && pinnedVersion(p.id)) || firstVersion(text),
      error: "",
      install: p.install,
      flavor: attempt.flavor ?? "",
    };
  }

  return {
    id: p.id,
    command: p.command,
    env: p.env ?? {},
    lead: [],
    present: false,
    version: "",
    // The specific failure beats the generic one. "not found" for a machine
    // that has whisper.cpp sitting in its own tools folder is a sentence that
    // sends somebody to reinstall what is already installed.
    error: gap || (lastError.split(/\r?\n/)[0] || "not found").trim().slice(0, 160),
    install: gap ? MODEL_INSTALL : p.install,
    flavor: "",
  };
}

export async function toolStatuses(force = false): Promise<ToolStatus[]> {
  const cached = store.__dotcontentTools;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await Promise.all(PROBES.map(probe));
  store.__dotcontentTools = { at: Date.now(), value };
  return value;
}

export async function toolStatus(id: ToolId) {
  return (await toolStatuses()).find((t) => t.id === id)!;
}

/** Throws the message a person needs, rather than whatever ENOENT says. */
export async function requireTool(id: ToolId) {
  const status = await toolStatus(id);
  if (!status.present) {
    throw new Error(
      `${id} is not installed on this machine. Install it with: ${status.install}`,
    );
  }
  return status;
}
