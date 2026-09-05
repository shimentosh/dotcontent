import fs from "node:fs/promises";
import path from "node:path";

import { run, toolStatuses } from "../lib/server/tools";
import type { Api } from "./api";
import type { Config } from "./config";
import { Refusal, type JobResult, type TranscribePayload } from "./job-types";
import { discard, jobDir } from "./temp";

/**
 * The spoken audio, as text, on the machine that has a GPU.
 *
 * Its own job rather than the tail of an ingest, and the reason is a ratio.
 * Audio is roughly a thirtieth of a video, so what crosses the network is a
 * megabyte a minute rather than four hundred — which makes a round trip to a
 * second desktop affordable, and transcription is exactly the step worth
 * sending there: it is the one that wants a GPU and the one dependency the
 * server should not carry. It also means an upload, whose bytes never left the
 * server, gets transcribed by the same path as a link.
 *
 * The WAV and nothing else is downloaded. It is already 16 kHz mono because
 * whoever produced it — this worker's own ingest, or the server's ffmpeg for
 * an upload — made it that way on purpose: that is whisper.cpp's input format,
 * so the conversion is a step that had to happen somewhere and it happened
 * where the video already was.
 */
export async function transcribeAudio(
  cfg: Config,
  api: Api,
  jobId: string,
  payload: TranscribePayload,
): Promise<JobResult> {
  if (!payload.sourceId || !payload.audioUrl) {
    throw new Refusal("The transcription job arrived without any audio to transcribe.");
  }

  if (cfg.toolsOff.has("whisper")) {
    throw new Refusal("whisper is switched off on this machine (CONTENTOS_WORKER_TOOLS_OFF).");
  }

  /*
   * However this machine can reach whisper.
   *
   * `pip install openai-whisper` often lands the script somewhere not on PATH
   * — normal on Windows — so the probe also tries `python -m whisper` and
   * records whichever answered. Running the recorded invocation means an
   * install the probe found is an install this can use, rather than telling
   * somebody to install what they already have.
   */
  const tool = (await toolStatuses()).find((t) => t.id === "whisper");
  if (!tool?.present) {
    throw new Refusal(
      `whisper is not installed on this machine. Install it with: ${tool?.install ?? "pip install -U openai-whisper"}`,
    );
  }

  const dir = await jobDir(jobId, "audio");
  try {
    const wav = path.join(dir, "audio.wav");
    await api.download(payload.audioUrl, wav);

    const timeout = payload.timeoutMs ?? 600_000;
    const { code, err } = await run(
      tool.command,
      [
        ...tool.lead,
        wav,
        "--model",
        payload.model || "base",
        "--output_format",
        "txt",
        "--output_dir",
        dir,
        "--fp16",
        "False",
      ],
      { env: tool.env, timeout },
    );

    if (code !== 0) {
      /*
       * A timeout reads as its own thing, not as a crash.
       *
       * `run()` kills the child and returns -1 with "Timed out after ..." on
       * stderr, and that is the likeliest real failure here: the base model on
       * a CPU runs at roughly real time, so a long video runs out of clock
       * rather than crashing. The remedy is a shorter clip or a faster
       * machine, not a reinstall, so the sentence must not say what a crash
       * would say — and it stays retryable, because the next machine to claim
       * it may be the one with the GPU.
       */
      if (/Timed out after/.test(err)) {
        throw new Error(
          `whisper ran out of time after ${Math.round(timeout / 60_000)} minutes on this audio. A shorter clip will finish.`,
        );
      }
      throw new Error(`whisper failed: ${lastUseful(err) || `exit ${code}`}`);
    }

    const files = await fs.readdir(dir).catch(() => []);
    const txt = files.find((f) => f.endsWith(".txt"));
    if (!txt) {
      // Exited clean and left nothing behind: a directory it could not write
      // into, or a build that wrote some other format. Either way there is no
      // transcript, and it does not get to look like the fast path.
      throw new Error("whisper finished but wrote no text file.");
    }

    /*
     * An empty transcript is a result, not a failure.
     *
     * A reel with music and no speech genuinely has no words in it, and the
     * server says exactly that on the source. Failing the job instead would
     * spend a second machine's GPU discovering the same silence.
     */
    const text = (await fs.readFile(path.join(dir, txt), "utf8").catch(() => "")).trim();
    return { text };
  } finally {
    await discard(dir);
  }
}

/** The last line of stderr that says something, not a progress bar. */
function lastUseful(err: string) {
  const lines = err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\s*[|/\-\\]\s*$/.test(l));
  return lines.slice(-3).join(" ").slice(0, 300);
}
