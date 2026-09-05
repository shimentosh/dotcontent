import path from "node:path";

import type { Api } from "./api";
import { callBrain } from "./brains";
import type { Config } from "./config";
import { Refusal, type JobResult, type WritePayload } from "./job-types";
import { discard, jobDir } from "./temp";

/**
 * Write one section, on this machine, exactly as the payload says.
 *
 * The server has already done all the thinking: resolved the pack, checked the
 * dependencies, gathered the finished upstream sections, fetched the website
 * or the source brief, and run `systemPrompt()` and `userPrompt()`. What
 * arrives here is their output — text and a command — so there is nothing in
 * this file that knows what a pack is, and that is the point: business logic
 * shipped to fifteen desktops would need fifteen updates to change a prompt,
 * and the prompt changes weekly.
 *
 * `ms` is measured here rather than on the server because the server's clock
 * would include the queue wait: a section would report six minutes because a
 * laptop was shut, and "how long does this model take" would stop being a
 * question anybody could answer.
 */
export async function writeSection(
  cfg: Config,
  api: Api,
  jobId: string,
  payload: WritePayload,
): Promise<JobResult> {
  if (!payload.system?.trim() || !payload.user?.trim()) {
    // A bad payload will be exactly as bad on the next machine, so it does not
    // get a second attempt.
    throw new Refusal("The job arrived with no prompt in it.");
  }

  const dir = payload.frames?.length ? await jobDir(jobId, "frames") : "";
  try {
    const imageFiles = dir ? await fetchFrames(api, dir, payload.frames ?? []) : [];

    const started = Date.now();
    const { text, using } = await callBrain(cfg, {
      brain: payload.brain,
      transport: payload.transport,
      system: payload.system,
      user: payload.user,
      tier: payload.tier,
      timeoutMs: payload.timeoutMs,
      ...(imageFiles.length ? { imageFiles } : {}),
      allowFrameRead: payload.allowFrameRead,
    });
    const ms = Date.now() - started;

    /*
     * Nothing back is a failure, not an empty section.
     *
     * The server draws the same conclusion in `sectionResult`, and it is worth
     * drawing on both sides: a `write_section` result arrives whole or not at
     * all, and posting an empty one as a success would put an approved-looking
     * blank on the page for every downstream section to be written against.
     */
    if (!text.trim()) {
      throw new Error("The model exited cleanly and wrote nothing.");
    }

    return { text, ms, using };
  } finally {
    /*
     * The frames go, whether the call worked or not.
     *
     * In a `finally` because the interesting case is the failure: a CLI that
     * timed out has still left eight JPEGs on somebody's desktop, and a worker
     * that ran all week would leave a week of them.
     */
    if (dir) await discard(dir);
  }
}

/**
 * The stills, on this machine's disk, in the order the payload named them.
 *
 * None of the three CLIs takes bytes and each takes a file differently, so the
 * frames have to become local absolute paths before a model can be asked about
 * them — which is the whole reason the server can stay the only place they
 * actually live. They are downloaded through the worker's own door
 * (`/api/workers/sources/...`), because a bearer token is not a session and
 * must not be able to walk the browser's routes.
 *
 * Named by position rather than by the name the server used. The order is the
 * only thing the prompt depends on, and a filename taken off a URL and joined
 * to a directory is a path traversal waiting for the day something upstream
 * stops checking it. Positions cannot traverse anything.
 */
async function fetchFrames(
  api: Api,
  dir: string,
  frames: { url: string; at: number }[],
) {
  const files: string[] = [];
  for (const [i, frame] of frames.entries()) {
    if (!frame?.url) continue;
    const file = path.join(dir, `frame-${String(i + 1).padStart(2, "0")}.jpg`);
    await api.download(frame.url, file);
    files.push(file);
  }
  if (!files.length) {
    // Frames were asked for and none arrived: the section is about what is on
    // screen, and answering it from the words alone is the one outcome
    // `docs/DECISIONS.md` calls worse than an error. Retryable, because a
    // download that failed once may be a network that came back.
    throw new Error("The frames this section is about could not be downloaded.");
  }
  return files;
}
