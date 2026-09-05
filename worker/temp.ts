import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Where a job's scratch files go — and, just as importantly, where they do not.
 *
 * NOT `cliHome()`. That directory is deliberately empty so that `claude`,
 * `codex` and `gemini`, all of which read the project they are started in,
 * have nothing to find; filling it with JPEGs would undo the reasoning in
 * `docs/DECISIONS.md` one frame at a time and put a stray file in the model's
 * context on the next run. The CLI still starts in `cliHome()`; the frames sit
 * somewhere else entirely and are named to it by absolute path.
 *
 * Under one root rather than scattered through the temp directory, so a worker
 * that was killed — a closed lid, a `taskkill`, a crash — leaves its litter
 * somewhere the next start can find and clear in one line.
 */
export const TEMP_ROOT = path.join(os.tmpdir(), "contentos-worker");

/** A directory of this job's own, named so a leftover says which job left it. */
export async function jobDir(jobId: string, what: string) {
  const dir = path.join(TEMP_ROOT, `${jobId}-${what}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Remove a directory and never throw for it.
 *
 * Called from a `finally`, where an exception would replace the real failure
 * with a housekeeping one — and on Windows the real failure is often exactly
 * why the directory is still locked.
 */
export async function discard(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Everything left behind by an earlier run of this worker.
 *
 * Swept at start rather than only at shutdown, because the shutdown that
 * matters is the one that did not happen: a killed process cleans up nothing,
 * and a laptop that has been fetching videos for a month should not be storing
 * a month of them in its temp directory.
 */
export async function sweepTemp() {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TEMP_ROOT, { recursive: true }).catch(() => {});
}
