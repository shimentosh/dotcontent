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
  /** How often to re-report the tool probe. */
  registerEveryMs: number;
};

class ConfigError extends Error {}

const here = path.dirname(fileURLToPath(import.meta.url));

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
    registerEveryMs: 5 * 60_000,
  };
}

export const isConfigError = (e: unknown) => e instanceof ConfigError;
