import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
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
};

type Probe = {
  id: ToolId;
  command: string;
  args: string[];
  /** Environment the probe and the tool both need. */
  env?: Record<string, string>;
  install: string;
  /**
   * Other ways the same tool can be reached.
   *
   * `pip install openai-whisper` writes `whisper` into Python's Scripts
   * directory, which on Windows is usually not on PATH — so the tool is
   * installed, the probe says "not found", and the person is told to install
   * something they already have. Python can always run it as a module, so
   * that is tried next and, when it answers, becomes the command everything
   * else uses.
   */
  alternates?: { command: string; args: string[] }[];
};

const PROBES: Probe[] = [
  {
    id: "yt-dlp",
    command: "yt-dlp",
    args: ["--version"],
    install: "pip install -U yt-dlp",
  },
  {
    id: "ffmpeg",
    command: "ffmpeg",
    args: ["-version"],
    install: "winget install Gyan.FFmpeg",
  },
  {
    id: "ffprobe",
    command: "ffprobe",
    args: ["-version"],
    install: "Ships with FFmpeg",
  },
  {
    id: "whisper",
    command: "whisper",
    args: ["--help"],
    install: "pip install -U openai-whisper",
    /*
     * Its --help contains a Japanese character, and a Windows console is
     * cp1252 by default: printing the help crashes with UnicodeEncodeError,
     * so an installed whisper reported itself as missing. The same encoding
     * is used when it actually runs, where the crash would land mid-transcript
     * instead of mid-probe.
     */
    env: { PYTHONIOENCODING: "utf-8" },
    alternates: [
      { command: "python", args: ["-m", "whisper", "--help"] },
      { command: "python3", args: ["-m", "whisper", "--help"] },
      { command: "py", args: ["-3", "-m", "whisper", "--help"] },
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
 * Run something and collect what it said.
 *
 * `shell: true` because on Windows these are almost always .cmd or .ps1 shims
 * rather than real executables, and spawning one directly fails with ENOENT
 * even though it is plainly on PATH.
 *
 * The command is assembled into one string rather than passed as an argv
 * array: with a shell, Node concatenates the array anyway WITHOUT escaping it,
 * and says so in a deprecation warning on every call. Doing it here means the
 * escaping is ours, visible, and applied exactly once.
 *
 * A flag is passed through as written — `--model` must not arrive quoted —
 * so anything that is not a bare flag is quoted.
 */
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
    process.env.CONTENTOS_DATA_DIR ?? path.join(process.cwd(), ".data"),
  );
  const dir = path.join(root, "cli");
  mkdirSync(dir, { recursive: true });
  return dir;
}

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
  const line = [
    command,
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
  __contentosTools?: { at: number; value: ToolStatus[] };
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

async function probe(p: Probe): Promise<ToolStatus> {
  const tries = [{ command: p.command, args: p.args }, ...(p.alternates ?? [])];

  let lastError = "";
  for (const attempt of tries) {
    const { code, out, err } = await run(attempt.command, attempt.args, {
      timeout: 12_000,
      env: p.env,
    });
    const text = out || err;
    // `--help` exits 0 and prints usage; a missing binary exits non-zero with
    // "not found". Both are answered by whether anything came back at all.
    if (code === 0 && text.trim().length > 0) {
      return {
        id: p.id,
        // The invocation that ANSWERED, not the one tried first, so whoever
        // runs the tool later runs the one that works.
        command: attempt.command,
        env: p.env ?? {},
        // Everything before the tool's own flags: nothing for a binary,
        // ["-m", "whisper"] for one reached through Python.
        lead: attempt.args.filter((a) => a === "-3" || a === "-m" || !a.startsWith("-")),
        present: true,
        version: firstVersion(text),
        error: "",
        install: p.install,
      };
    }
    lastError = err;
  }

  return {
    id: p.id,
    command: p.command,
    env: p.env ?? {},
    lead: [],
    present: false,
    version: "",
    error: (lastError.split(/\r?\n/)[0] || "not found").trim().slice(0, 120),
    install: p.install,
  };
}

export async function toolStatuses(force = false): Promise<ToolStatus[]> {
  const cached = store.__contentosTools;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await Promise.all(PROBES.map(probe));
  store.__contentosTools = { at: Date.now(), value };
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
