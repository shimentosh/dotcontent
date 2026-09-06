import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  run,
  toolStatuses,
  whisperModel,
  whisperModelGap,
  type ToolStatus,
} from "../lib/server/tools";
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
 *
 * **Two programs answer to the name `whisper` and this runs whichever is
 * here.** whisper.cpp is an executable plus a `.bin`; openai-whisper is a
 * Python package with PyTorch behind it. They share no arguments and they do
 * not write their output to the same place. The probe in `lib/server/tools.ts`
 * says which one it found and prefers whisper.cpp, because that is the one
 * `npm run worker:setup` can put on a machine belonging to somebody who does
 * not have a Python.
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
   * Two separate installs hide from a plain PATH lookup, and the probe knows
   * about both: `pip install openai-whisper` often lands its script somewhere
   * not on PATH, which is normal on Windows, so `python -m whisper` is tried
   * too; and `npm run worker:setup` deliberately edits no PATH at all, so
   * whisper.cpp is looked for in the app's own tools folder first. Running the
   * invocation the probe recorded means an install it found is an install this
   * can use, rather than telling somebody to install what they already have.
   */
  const tool = (await toolStatuses()).find((t) => t.id === "whisper");
  if (!tool?.present) {
    /*
     * Three different absences, and only one of them is "install whisper".
     *
     * The probe already distinguishes them and puts the specific sentence in
     * `error` with the specific remedy in `install` — most importantly the
     * case where whisper.cpp IS here and its model file is not, which is a
     * download rather than an installation and would otherwise send somebody
     * to reinstall a program they can see in the folder.
     */
    throw new Refusal(
      tool?.error
        ? `${tool.error} Fix it with: ${tool.install}`
        : `whisper is not installed on this machine. Install it with: ${tool?.install ?? "npm run worker:setup"}`,
    );
  }

  const cpp = tool.flavor === "whisper.cpp";
  const name = cpp ? "whisper.cpp" : "openai-whisper";

  /*
   * whisper.cpp is a program AND a file, and the file is the half that goes
   * missing.
   *
   * Checked again here rather than trusted from the probe, because the probe
   * only asked whether ANY model exists and this job asked for a particular
   * one; and because a probe is up to a minute old, which is long enough for
   * somebody to have moved the folder. `whisperModel` answers with the nearest
   * size that is actually present, so a machine holding `base` still does the
   * job when the server asked for `small` — at the accuracy it has, which is
   * reported back rather than left for somebody to wonder about.
   */
  const model = cpp ? whisperModel(payload.model) : null;
  if (cpp && !model) {
    throw new Refusal(`${whisperModelGap()} Fix it with: npm run worker:setup -- --only whisper`);
  }

  const dir = await jobDir(jobId, "audio");
  try {
    const wav = path.join(dir, "audio.wav");
    await api.download(payload.audioUrl, wav);

    const timeout = payload.timeoutMs ?? 600_000;
    const { code, err } = await run(tool.command, argsFor(tool, payload, wav, dir, model), {
      env: tool.env,
      timeout,
    });

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
          `${name} ran out of time after ${Math.round(timeout / 60_000)} minutes on this audio. A shorter clip will finish.`,
        );
      }
      /*
       * A crash, and the build is named in it.
       *
       * Two programs can fail here and their fixes have nothing in common —
       * one wants a Visual C++ runtime or a different `.bin`, the other wants
       * a working PyTorch — so a sentence that only said "whisper failed"
       * would send somebody looking in the wrong half of their machine.
       */
      throw new Error(`${name} failed: ${lastUseful(err) || `exit ${code}`}`);
    }

    /*
     * Whatever it wrote, wherever it decided to write it.
     *
     * openai-whisper names the file after the input inside `--output_dir`;
     * whisper.cpp appends `.txt` to the input path. Both land in this job's own
     * directory, which holds exactly one WAV and nothing else, so looking for
     * the `.txt` is more robust than either program's naming rule and survives
     * the next time one of them changes it.
     */
    const files = await fs.readdir(dir).catch(() => []);
    const txt = files.find((f) => f.endsWith(".txt"));
    if (!txt) {
      // Exited clean and left nothing behind: a directory it could not write
      // into, or a build that wrote some other format. Either way there is no
      // transcript, and it does not get to look like the fast path.
      throw new Error(`${name} finished but wrote no text file.`);
    }

    /*
     * An empty transcript is a result, not a failure.
     *
     * A reel with music and no speech genuinely has no words in it, and the
     * server says exactly that on the source. Failing the job instead would
     * spend a second machine's GPU discovering the same silence. This is the
     * one place where "wrote nothing" and "wrote an empty file" have to stay
     * different sentences: the first is a broken install, the second is a
     * silent video, and collapsing them cost a real afternoon.
     */
    const text = (await fs.readFile(path.join(dir, txt), "utf8").catch(() => "")).trim();
    // `text` is what the server stores; the rest is the operational record on
    // the job row — which machine's build did this, and at what accuracy.
    return { text, using: name, model: model?.name ?? payload.model ?? "" };
  } finally {
    await discard(dir);
  }
}

/**
 * The same request, in whichever program's language.
 *
 * They agree on nothing. openai-whisper takes the audio as a bare argument, a
 * model *name* it will download for itself, and an output directory.
 * whisper.cpp takes `-f` for the audio and `-m` for a model *file* that has to
 * already exist, and writes beside the input.
 */
function argsFor(
  tool: ToolStatus,
  payload: TranscribePayload,
  wav: string,
  dir: string,
  model: { file: string; name: string } | null,
) {
  if (tool.flavor === "whisper.cpp" && model) {
    return [
      ...tool.lead,
      "-m",
      model.file,
      "-f",
      wav,
      // Without this it writes no file at all — it prints to the console and
      // exits 0, which arrives here as "finished but wrote no text file".
      "-otxt",
      /*
       * Detect the language rather than assume one.
       *
       * whisper.cpp defaults to `-l en`, and openai-whisper defaults to
       * detecting — so a Bangla source that transcribed correctly under the
       * Python one would come back as English-shaped nonsense under this one,
       * with nothing anywhere saying why. An `.en` model ignores this and says
       * so on stderr, which is the honest outcome for a model that only knows
       * one language.
       */
      "-l",
      "auto",
      "-t",
      String(threads()),
    ];
  }

  return [
    ...tool.lead,
    wav,
    "--model",
    payload.model || "base",
    "--output_format",
    "txt",
    "--output_dir",
    dir,
    // CPU builds of PyTorch cannot do fp16 and warn about it on every run;
    // saying so up front keeps the warning out of the stderr this reads for
    // real failures.
    "--fp16",
    "False",
  ];
}

/**
 * How many cores to give it.
 *
 * whisper.cpp defaults to four, which is a decision made for laptops in 2022
 * and leaves most of a modern desktop idle — and the failure this job actually
 * has is running out of clock, not running out of cores. Capped at eight
 * because the gain flattens there and the machine belongs to somebody who is
 * probably also using it.
 */
const threads = () => Math.max(1, Math.min(8, os.cpus().length || 4));

/** The last line of stderr that says something, not a progress bar. */
function lastUseful(err: string) {
  const lines = err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\s*[|/\-\\]\s*$/.test(l));
  return lines.slice(-3).join(" ").slice(0, 300);
}
