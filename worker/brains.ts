import {
  findBrain,
  type BrainDef,
  type Transport,
  type WriteRequest,
} from "../lib/server/brain-defs";
import {
  viaClaudeCli,
  viaCodexCli,
  viaGeminiCli,
  viaOllama,
} from "../lib/server/brain-transports";
import { toolStatuses } from "../lib/server/tools";
import type { Config } from "./config";
import { Refusal } from "./job-types";

/**
 * Reaching a model from this machine — the rules, not the flags.
 *
 * This file used to be a verbatim copy of the four transports in
 * `lib/server/brains.ts`, held under protest, because `write()` cannot be
 * called from here: it re-derives the transport through `brainStatuses()` →
 * `getSecret()` → Postgres, and a sidecar on somebody's desktop has neither a
 * database nor any business having one. The transports were private to that
 * module, so there was nothing to import either.
 *
 * Both halves are fixed. The brain table is `lib/server/brain-defs.ts`, which
 * imports nothing; the four transports are `lib/server/brain-transports.ts`,
 * which imports only `tools.ts` — no repo, no client, no `pg` — and every
 * hard-won flag in them now exists once. What is left here is the part that
 * was never a copy of anything: the decisions a worker makes, and the ones it
 * refuses to make.
 *
 * The rule that matters is negative. **There is no fallback.** A worker told
 * `cli` that has no CLI fails; it does not reach for an API key, and there is
 * no key on this machine to reach for. The API transports were deliberately
 * left behind in `brains.ts` with the keys, so this file cannot perform a
 * silent CLI-to-API downgrade even by accident — which is the outcome
 * `docs/DECISIONS.md` calls worse than an error, and importing the shared
 * transports must never become the day a worker acquires the ability.
 */

/**
 * A job's ask, in the shape the transports already take.
 *
 * `WriteRequest` minus `images`: bytes are the one field a worker never
 * carries. The frames arrive as URLs it downloads to its own disk and hands
 * over as paths, and the only transport that takes base64 is the Anthropic
 * API, which lives on the server. Naming the omission keeps a future payload
 * from quietly adding an image path through here.
 */
export type BrainCall = Omit<WriteRequest, "images"> & {
  brain: string;
  transport: Transport;
};

/**
 * Ask the model, exactly the way the payload said to.
 *
 * Everything editorial was settled on the server — which brain, which
 * transport, what to say — so nothing here chooses. It checks that this
 * machine can honour what it was told, and refuses by name when it cannot: a
 * refusal is an answer somebody can act on, and an answer produced some other
 * way than the run asked for, presented as though it had been, is the failure
 * this whole split was careful to make impossible.
 */
export async function callBrain(
  cfg: Config,
  req: BrainCall,
): Promise<{ text: string; using: string }> {
  const def = findBrain(req.brain);
  if (!def) {
    /*
     * The table is the server's own now, so an unknown id means this machine
     * is running an older worker than the console that queued the job. Say
     * that, rather than picking the nearest row: guessing means running a
     * different model than the run was costed for, and saying afterwards that
     * it was the one asked for.
     */
    throw new Refusal(
      `This machine's worker does not know a model called "${req.brain}". Update the worker on this machine.`,
    );
  }

  const frames = req.imageFiles ?? [];

  /*
   * Ollama is a server on this machine, not a command on it.
   *
   * So its transport is `api` and always was — that is `transportFor()` on the
   * server saying "no command to install", not a downgrade — and it is the one
   * `api` a worker may honour, because the address is local and nothing is
   * spent per token. It is also the one brain that cannot be shown a picture:
   * it is handed a prompt and nothing else, and answering a question about
   * frames from the words alone is the outcome worse than an error.
   */
  if (def.id === "ollama") {
    if (req.transport !== "api") {
      throw new Refusal(
        `The job asked for Ollama over "${req.transport}", and Ollama is only ever reached over its own HTTP API.`,
      );
    }
    if (frames.length) {
      throw new Refusal(
        "Ollama cannot be shown frames, so it must not answer a question about them.",
      );
    }
    /*
     * This machine's address, not the console's. `ollama-url` is a setting
     * about one host, and the host that matters is whichever one this laptop
     * can reach.
     */
    return { text: await viaOllama(def, req, cfg.ollamaUrl), using: def.model };
  }

  if (req.transport !== "cli") {
    /*
     * A key would work here, and that is precisely why it is refused.
     *
     * The API transports stay on the server, deliberately: this split exists
     * so a run costs a subscription somebody already pays for, and a worker
     * that quietly spent money per token when its CLI was missing would do it
     * on the evening nobody was watching.
     */
    throw new Refusal(
      `This machine only writes through a signed-in CLI, and the job asked for ${def.name} over an API key. API keys stay on the server.`,
    );
  }

  const tool = await toolFor(cfg, def);

  if (frames.length && def.id === "claude-cli") {
    /*
     * Two checks, and this is the second one.
     *
     * The server sent `allowFrameRead` from `workers.can_read_frames`; this
     * machine checks its own switch again before granting Claude the `Read`
     * tool, because the grant lands on this filesystem and the person who owns
     * this filesystem gets the last word. Codex and Gemini are handed the
     * picture and granted nothing, so neither comes through here.
     */
    if (req.allowFrameRead !== true) {
      throw new Refusal(
        "Claude can read the frames, but the console has not allowed this machine to open frame files. Turn it on for this machine in Settings → Machines.",
      );
    }
    if (!cfg.allowFrameRead) {
      throw new Refusal(
        "Claude can read the frames, but this worker is not allowed to open files: set DOTCONTENT_WORKER_ALLOW_FRAME_READ=1 on this machine and restart it.",
      );
    }
  }

  /*
   * What was actually asked for, which is not always `model`: a CLI with no
   * override uses whatever the signed-in account defaults to, and reporting a
   * model name it was never told is how "which model wrote this" stops being
   * answerable.
   */
  const using = def.cliModel ?? "the account's default model";

  // Named one by one rather than falling through to a last branch. A chain
  // whose `else` was gemini would answer a fifth brand as Gemini the day one
  // is added to the table — a substitution nobody asked for and nobody would
  // see, which is the exact failure this file exists to prevent.
  if (def.id === "claude-cli") return { text: await viaClaudeCli(def, req, tool), using };
  if (def.id === "codex-cli") return { text: await viaCodexCli(def, req, tool), using };
  if (def.id === "gemini-cli") return { text: await viaGeminiCli(def, req, tool), using };

  throw new Refusal(
    `This machine has no way to write with ${def.name}, and it must not answer as some other model instead.`,
  );
}

/**
 * The invocation that answered the probe, or the reason there was none.
 *
 * `tool.command` and `tool.lead` rather than the brand's own command string,
 * for the reason `probe()` records them at all: an install the probe reached a
 * second way — `python -m whisper` is the usual one — is an install this can
 * use, and hard-coding the first name means telling somebody to install what
 * they already have. The whole `ToolStatus` goes to the transport, which takes
 * it as its `CliSpawn`; the server, which has no probe at the call site,
 * passes nothing and gets the brand's own command name.
 */
async function toolFor(cfg: Config, def: BrainDef) {
  // Every brand that reaches this line has a command — Ollama returned above,
  // and it is the only row without one.
  const id = def.command ?? def.id;
  const status = (await toolStatuses()).find((t) => t.id === id);
  if (!status?.present) {
    throw new Refusal(
      `${def.name}'s CLI is not installed on this machine. Install it with: ${status?.install ?? id}`,
    );
  }
  if (cfg.toolsOff.has(id)) {
    throw new Refusal(
      `${id} is switched off on this machine (DOTCONTENT_WORKER_TOOLS_OFF), so it must not be used to write.`,
    );
  }
  return status;
}
