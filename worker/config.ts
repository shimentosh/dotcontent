import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Everything this machine needs to be told, and where it is told it.
 *
 * Environment rather than a config file, because the same code has to start
 * three ways: `npm run worker` in a checkout today, a service on somebody's
 * desktop, and a Tauri sidecar tomorrow — and only one of those has a
 * directory anybody would think to put a config file in. The desktop app will
 * hand the token over from the OS keychain as an env var, which is the whole
 * reason it is read from here and never from a file next to the binary.
 *
 * Two of these are required and there is no default that could be right for
 * either: an API URL guessed as localhost would silently make a worker that
 * serves nobody, and a blank token authenticates as nothing. A missing one is
 * reported as the sentence naming what to set, not as a stack trace — the
 * person reading it is looking at a console window on their own laptop, not at
 * a server log.
 */
export type Config = {
  /** The console's origin, no trailing slash. */
  base: string;
  /** The bearer token minted in Settings → Machines, shown once. */
  token: string;
  /** What the machine picker calls this machine. */
  name: string;
  /** Sidecar version, reported so a stale desktop app is visible. */
  version: string;
  /** How many jobs to ask for at once. */
  maxJobs: number;
  /**
   * Whether Claude's CLI may be granted `Read` on THIS filesystem.
   *
   * Checked again here even though the payload already carries the server's
   * answer, because the grant lands on this disk and whoever owns the disk
   * gets the last word. Defaults off: starting a worker must not silently
   * carry over a permission somebody granted on a different machine.
   */
  allowFrameRead: boolean;
  /** Tool ids switched off on this machine, whatever the probe found. */
  toolsOff: Set<string>;
  /** Where Ollama is, for the one brain that is an HTTP server rather than a CLI. */
  ollamaUrl: string;
  /** Where `npm run worker:setup` put yt-dlp, ffmpeg and whisper.cpp. */
  toolsDir: string;
  /** How often to re-report the tool probe. */
  registerEveryMs: number;
};

class ConfigError extends Error {}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the installed tools live, decided once and put in the environment.
 *
 * Resolved from THIS FILE's location rather than from the working directory,
 * because a sidecar is started by whatever launched it and a desktop app
 * launches it from wherever Windows felt like — while the tools sit in the app
 * folder, next to `worker/`, always.
 *
 * It goes into the environment because `lib/server/tools.ts` cannot work this
 * out for itself: that file is also type-checked by `api/tsconfig.json` as
 * CommonJS, where `import.meta.url` is a compile error (TS1343), so it reads
 * `CONTENTOS_TOOLS_DIR` and this is what sets it. An explicit value always
 * wins, which is how somebody puts a three-gigabyte whisper model on the drive
 * that has room for it.
 *
 * `.data/tools`, not `.tools`, and for one flat reason: `.gitignore` already
 * ignores `.data/`. A tools folder anywhere else would put two hundred
 * megabytes of downloaded executables into `git status` for every teammate who
 * ran the installer. It is deliberately NOT under `CONTENTOS_DATA_DIR` — that
 * variable belongs to `cliHome()` and to nothing else, and quietly widening it
 * would make the sentence in docs/WORKER.md about it false.
 *
 * Called by the executor as well as by the supervisor, because each job runs
 * in a process of its own and an environment variable does not survive a
 * `spawn` of a fresh node.
 */
export function toolsRoot() {
  const set = (process.env.CONTENTOS_TOOLS_DIR ?? "").trim();
  const dir = set ? path.resolve(set) : path.resolve(here, "..", ".data", "tools");
  process.env.CONTENTOS_TOOLS_DIR = dir;
  return dir;
}

/**
 * The version, off the repo's package.json.
 *
 * Read rather than imported: an import assertion would tie the worker to a
 * JSON module flag, and a sidecar that cannot find its own package.json should
 * report an honest "0.0.0-dev" rather than refusing to start over a version
 * string nothing depends on.
 */
function version() {
  try {
    const raw = fs.readFileSync(path.join(here, "..", "package.json"), "utf8");
    return String((JSON.parse(raw) as { version?: string }).version ?? "") || "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

const flag = (value: string | undefined, fallback = false) =>
  value === undefined || value.trim() === ""
    ? fallback
    : /^(1|true|yes|on)$/i.test(value.trim());

export function loadConfig(): Config {
  const base = (process.env.CONTENTOS_API_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.CONTENTOS_WORKER_TOKEN ?? "").trim();

  if (!base) {
    throw new ConfigError(
      "Set CONTENTOS_API_URL to the console this machine works for, for example http://localhost:4000.",
    );
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new ConfigError(
      `CONTENTOS_API_URL is "${base}", which is not a URL — it has to start with http:// or https://.`,
    );
  }
  if (!token) {
    throw new ConfigError(
      "Set CONTENTOS_WORKER_TOKEN to the token from Settings → Machines. It is shown once, when the machine is added.",
    );
  }

  const asked = Number(process.env.CONTENTOS_WORKER_MAX_JOBS ?? "1");
  return {
    base,
    token,
    name: (process.env.CONTENTOS_WORKER_NAME ?? "").trim() || os.hostname(),
    version: version(),
    /*
     * One at a time unless the owner says otherwise, and capped low.
     *
     * One machine is one CLI login, so two sections in parallel are two
     * processes competing for the same subscription and the same GPU. The
     * parallelism this design is after comes from more laptops; the server
     * caps it as well, at `workers.max_concurrency`, and the smaller of the
     * two wins.
     */
    maxJobs: Number.isFinite(asked) ? Math.max(1, Math.min(4, Math.trunc(asked))) : 1,
    allowFrameRead: flag(process.env.CONTENTOS_WORKER_ALLOW_FRAME_READ, false),
    toolsOff: new Set(
      (process.env.CONTENTOS_WORKER_TOOLS_OFF ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
    ollamaUrl:
      (process.env.CONTENTOS_OLLAMA_URL ?? "").trim().replace(/\/+$/, "") ||
      "http://localhost:11434",
    // Called for its side effect as much as for its value: from here on,
    // every probe in this process — and in the executor processes it spawns —
    // looks in the app's own tools folder before it looks at PATH.
    toolsDir: toolsRoot(),
    registerEveryMs: 5 * 60_000,
  };
}

export const isConfigError = (e: unknown) => e instanceof ConfigError;
