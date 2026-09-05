import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import {
  BRAINS,
  findBrain,
  type BrainDef,
  type Transport,
} from "@/lib/server/brain-defs";
import { enqueue, getJob } from "@/lib/server/repos/jobs";
import { getSettings, listSecrets } from "@/lib/server/repos/settings";
import {
  getWorker,
  listWorkers,
  updateWorker,
  type Worker,
} from "@/lib/server/repos/workers";
import { getWorkspace, updateWorkspace } from "@/lib/server/repos/workspaces";

const MEDIA = ["yt-dlp", "ffmpeg", "ffprobe", "whisper"];

/**
 * What a MACHINE can reach — read, not probed.
 *
 * This controller used to call `toolStatuses()` and `brainStatuses()`, which
 * spawn `claude --version` and `yt-dlp --version` in the API process. That was
 * exactly right while the API process was also the machine with the binaries
 * on it. On a server it is a question asked of the wrong box: the answer is
 * "nothing installed", forever, and the Integrations page becomes a list of
 * red rows about a machine nobody uses — while the four laptops that really do
 * have the tools are invisible.
 *
 * So the page stops asking "what is on this machine" and starts asking "what
 * is on WHICH machine". Every row here comes out of `workers.tools`, which the
 * worker probed on its own hardware and reported when it registered — the same
 * `ToolStatus` shape, so the component barely changes. "Re-check" stops
 * meaning "spawn five processes here" and starts meaning "ask that machine to
 * probe again", which is what re-registration already is.
 *
 * The distinction the page has to be able to draw, and could not before:
 * `whisper` is not installed on that machine, versus that machine has not been
 * seen since Tuesday. One is an install command; the other is "open your
 * laptop".
 */
@Controller("integrations")
export class IntegrationsController {
  /**
   * The wiring, as of one machine.
   *
   * `machine` names a worker; without one the most recently seen live machine
   * is used, because "where can this run right now" is the question the page
   * is actually asking and a laptop shut since Tuesday is not an answer to it.
   * `workspace` names whose brain and API-fallback switch to report — both of
   * those moved off the global settings in migration 0016, and neither has a
   * console-wide value any more.
   */
  @Get()
  async wiring(
    @Query("machine") machineId?: string,
    @Query("workspace") workspaceId?: string,
  ) {
    const [machines, settings, keys] = await Promise.all([
      listWorkers(),
      getSettings(),
      listSecrets(),
    ]);

    const machine =
      (machineId ? machines.find((m) => m.id === machineId) : undefined) ??
      machines.find((m) => m.live) ??
      machines[0] ??
      null;

    const workspace = workspaceId ? await getWorkspace(workspaceId) : null;

    return {
      /*
       * Everything the picker needs, and nothing a token could be rebuilt
       * from. `token_hash` never leaves the repo; the rest of a worker row is
       * what the page draws.
       */
      machines: machines.map((m) => ({
        id: m.id,
        name: m.name,
        platform: m.platform,
        version: m.version,
        lastSeenAt: m.lastSeenAt,
        live: m.live,
      })),
      machine: machine
        ? {
            id: machine.id,
            name: machine.name,
            live: machine.live,
            lastSeenAt: machine.lastSeenAt,
          }
        : null,
      brains: brainsOn(machine, Object.keys(keys)),
      // Read off the row rather than probed. No machine enrolled yet means an
      // empty list, which the page must render as "no machines" rather than as
      // "nothing installed" — those are opposite sentences.
      tools: (machine?.tools ?? []).filter((t) => MEDIA.includes(t.id)),
      /** The subset the machine's owner has switched on. `workers.enabled`. */
      enabled: machine?.enabled ?? [],
      /** `workers.can_read_frames`, which defaults OFF. Per machine, on purpose. */
      canReadFrames: machine?.canReadFrames ?? false,
      /** Per workspace now, not per console. Null when none was named. */
      brain: workspace?.brain ?? null,
      apiFallback: workspace?.apiFallback ?? null,
      settings,
      keys: Object.keys(keys),
    };
  }

  /**
   * Set one of the things this page can set — each on the thing it belongs to.
   *
   * There is no `setSettings({ brain, enabled })` any more, and that is the
   * point of migration 0016: `brain` is an editorial choice about a
   * workspace's content, `enabled` is a fact about one person's machine, and a
   * single PATCH that wrote both into a console-wide table let a teammate
   * retune every brand in the database and switch off a binary on somebody
   * else's desktop with the same click.
   *
   * `enabled` is also settable on `PATCH /api/machines/:id`, which is the
   * canonical place for a machine's switches; it is accepted here because it
   * is what the toggle on this page does, and it goes through the same repo
   * call rather than a second copy of the rule.
   */
  @Patch()
  async update(
    @Body()
    body: {
      workspace?: string;
      brain?: string;
      apiFallback?: boolean;
      machine?: string;
      enabled?: string[];
    },
  ) {
    if (body.brain !== undefined || body.apiFallback !== undefined) {
      if (!body.workspace) {
        throw new BadRequestException(
          "Which workspace? The model and the API-key fallback are per workspace now, not per console.",
        );
      }
      if (body.brain !== undefined && !findBrain(body.brain)) {
        throw new BadRequestException(`No model called "${body.brain}"`);
      }
      /*
       * Not checked against a machine before saving, on purpose.
       *
       * The old code refused a brain whose CLI this box did not have. A
       * workspace's model is an editorial decision that outlives whichever
       * laptops happen to be awake when it is made, and a machine with the CLI
       * may be enrolled an hour later. A run that cannot be routed says so at
       * enqueue, by name, with the install command — which is a better place
       * to find out than a picker that would not let you choose.
       */
      const updated = await updateWorkspace(body.workspace, {
        ...(body.brain !== undefined ? { brain: body.brain } : {}),
        ...(body.apiFallback !== undefined ? { apiFallback: body.apiFallback } : {}),
      });
      if (!updated) throw new NotFoundException("No such workspace");
      return { brain: updated.brain, apiFallback: updated.apiFallback };
    }

    if (body.enabled !== undefined) {
      if (!body.machine) {
        throw new BadRequestException(
          "Which machine? A tool being switched off is a fact about one desktop, not about the console.",
        );
      }
      const updated = await updateWorker(body.machine, { enabled: body.enabled });
      if (!updated) throw new NotFoundException("No such machine");
      return { machine: updated.id, enabled: updated.enabled };
    }

    /*
     * Nothing else on this page is a setting any more.
     *
     * `quality`, `autoApprove` and `reduceMotion` are genuinely console-wide
     * and are edited through `PATCH /api/settings`, which is where they always
     * were. Refusing here rather than quietly succeeding matters because an
     * old client still sends `{ brain }` or `{ enabled }` with no scope, and a
     * 200 with nothing written would look exactly like a saved switch that
     * silently is not.
     */
    throw new BadRequestException(
      "Nothing to set. `brain` and `apiFallback` need a workspace; `enabled` needs a machine.",
    );
  }

  /**
   * Ask a model for two words — on a named machine.
   *
   * It cannot be answered here any more. `write()` on the server would spawn a
   * CLI that is not installed, or quietly spend an API key to answer a
   * question about somebody's laptop; neither tells you the thing the button
   * exists to tell you, which is whether THAT machine can write. So it becomes
   * a `test_brain` job, and the answer arrives by polling it.
   *
   * A model that works on one teammate's laptop and not on another's is now
   * something the page can express, and before this it could not even ask.
   */
  @Post("test")
  @HttpCode(200)
  async test(@Body() body: { id?: string; machine?: string }) {
    const def = findBrain(body.id ?? "");
    if (!def) throw new BadRequestException("No such model");
    if (!body.machine) throw new BadRequestException("Which machine should try it?");

    const machine = await getWorker(body.machine);
    if (!machine) throw new NotFoundException("No such machine");

    /*
     * Refuse before queueing when the machine plainly cannot do it.
     *
     * A job pinned to a worker that does not have the CLI would sit queued
     * until `wait_until` and then fail on a deadline, which reads as "it was
     * slow" rather than "it is not installed there". Answering now is the same
     * information, two minutes earlier and in the right words.
     */
    const tool = def.command
      ? machine.tools.find((t) => t.id === def.command)
      : undefined;
    if (def.command && !tool?.present) {
      return {
        ok: false,
        ms: 0,
        reply: "",
        error: `${def.command} is not installed on ${machine.name}`,
        fix: tool?.install
          ? `On ${machine.name}: ${tool.install}`
          : `Install the ${def.command} CLI on ${machine.name}`,
        machine: machine.name,
      };
    }

    const { job } = await enqueue({
      kind: "test_brain",
      wantsWorker: machine.id,
      needs: def.command ? [def.command] : [],
      // One attempt. A retry would ask the same machine the same question and,
      // if it is asleep, take twice as long to say so.
      maxAttempts: 1,
      // Short, because somebody is watching this button. Past it the reaper
      // fails the job naming the machine — which is the honest answer when a
      // laptop is shut, and the one this page could not give before.
      waitUntil: new Date(Date.now() + 120_000),
      error: machine.live
        ? ""
        : `${machine.name} has not been seen recently, so nothing picked this up.`,
      payload: {
        brain: def.id,
        transport: (def.command ? "cli" : "api") as Transport,
        system: "You are a terse assistant. Answer in one short line, no preamble.",
        user: "Reply with exactly: BRAIN OK",
        tier: "cheap",
        timeoutMs: 150_000,
      },
    });

    return { jobId: job.id, machine: machine.name, state: job.state };
  }

  /**
   * How the test went, once a machine has answered.
   *
   * Polled by the page, because the result no longer comes back from the POST
   * that started it: the work happens on a laptop the request has no way to
   * wait for. `fixFor` runs here rather than on the worker for the same reason
   * it always did — it is a lookup from an error string to a sentence, and the
   * sentences belong with the console that shows them.
   */
  @Get("test/:jobId")
  async testResult(@Param("jobId") jobId: string) {
    const job = await getJob(jobId);
    if (!job || job.kind !== "test_brain") {
      throw new NotFoundException("No such test");
    }

    const machine = job.workerId ? await getWorker(job.workerId) : null;
    const where = machine?.name ?? "";
    const brainId = String(job.payload.brain ?? "");

    if (job.state === "queued" || job.state === "claimed") {
      // `job.error` carries the sentence written at enqueue when the machine
      // was not live, so "waiting for a laptop that is shut" is visible while
      // it is still true rather than only once the deadline passes.
      return { state: job.state, running: true, machine: where, note: job.error };
    }

    const result = job.result as {
      ok?: boolean;
      ms?: number;
      reply?: string;
      error?: string;
      transport?: Transport;
    };
    const reply = String(result.reply ?? "");
    const error = String(result.error || job.error || "");

    return {
      state: job.state,
      running: false,
      // Answering with nothing is not a pass. The button exists to prove the
      // model writes, and an empty string proves the opposite.
      ok: job.state === "done" && result.ok !== false && Boolean(reply.trim()),
      ms: Number(result.ms ?? 0),
      reply: reply.slice(0, 200),
      error,
      fix: error ? fixFor(brainId, error, where) : "",
      transport: result.transport ?? "",
      machine: where,
    };
  }
}

/**
 * Which models this machine could write with, derived from what it reported.
 *
 * The same shape `brainStatuses()` produced, built from a table instead of
 * from five child processes. `cli` is present AND switched on, because the
 * claim query intersects a job's `needs` against `workers.enabled` — a CLI
 * that is installed but off is a model no job will ever reach that machine
 * for, and a page calling it available would be describing a route that does
 * not exist.
 *
 * `api` stays a fact about the SERVER rather than about the machine: the keys
 * live here, encrypted, and the API path runs here as the workspace's
 * fallback. That is why the two halves of one row can be true of two different
 * computers, and why the reason strings have to say which.
 */
function brainsOn(machine: Worker | null, storedKeys: string[]) {
  return BRAINS.map((def) => {
    const tool = def.command
      ? machine?.tools.find((t) => t.id === def.command)
      : undefined;
    const cli = Boolean(
      def.command && tool?.present && machine?.enabled.includes(def.command),
    );
    const { api, apiFrom } = keyState(def, storedKeys);
    const available = cli || api;

    return {
      ...def,
      cli,
      cliVersion: tool?.version ?? "",
      api,
      apiFrom,
      available,
      transport: (available ? (cli ? "cli" : "api") : "") as Transport | "",
      // A CLI with no override uses whatever the signed-in account defaults
      // to, and that account is on the machine, not here.
      using:
        available && cli ? (def.cliModel ?? "the account's default model") : def.model,
      reason: reasonFor(def, machine, cli, api, tool?.present === true),
    };
  });
}

/** A key is set, in this process's environment or in the settings table. */
function keyState(def: BrainDef, storedKeys: string[]) {
  if (def.env && (process.env[def.env] ?? "").trim()) {
    return { api: true, apiFrom: "env" as const };
  }
  if (def.secret && storedKeys.includes(def.secret)) {
    return { api: true, apiFrom: "settings" as const };
  }
  return { api: false, apiFrom: "" as const };
}

/**
 * Why it cannot be used — and on which computer.
 *
 * "Install the claude CLI" was a complete sentence when the reader was sitting
 * at the machine that would run it. On a team it is an instruction with no
 * address on it, and the commonest case is not a missing binary at all: it is
 * a machine that is simply not switched on, which no install command fixes.
 */
function reasonFor(
  def: BrainDef,
  machine: Worker | null,
  cli: boolean,
  api: boolean,
  installed: boolean,
) {
  if (cli || api) return "";
  if (!machine) {
    return "No machine has been enrolled yet — install the desktop app on one and add it in Settings → Machines";
  }
  if (def.id === "ollama") {
    // Ollama is an HTTP server on the machine that runs it, so there is no
    // binary in `tools` to look for and nothing here can reach it. Only that
    // machine can answer this, which is what Test now asks it to do.
    return `Ollama runs on the machine itself — press Test to ask ${machine.name}`;
  }
  if (installed) {
    return `${def.command} is installed on ${machine.name} but switched off for it`;
  }
  return `Install the ${def.command} CLI on ${machine.name}, or paste a key in Settings → API keys`;
}

/**
 * The one-line remedy for the failures people actually hit.
 *
 * Kept, because it is a lookup from an error string to a sentence and that
 * does not move anywhere. What changed is who is being told: every one of
 * these is now advice about a terminal on a machine the reader may not be
 * sitting at, so the machine's name goes into the sentence. "Run `codex
 * login` in a terminal" is still the right advice, and it is useless run on
 * the wrong computer.
 */
function fixFor(id: string, message: string, machine: string) {
  const m = message.toLowerCase();
  // "On Shakhawat's desktop: " — dropped when nothing ever claimed the job,
  // because an instruction addressed to nowhere is worse than one addressed
  // to you.
  const on = machine ? `On ${machine}: ` : "";

  if (m.includes("unknown variant") || m.includes("failed to refresh available models")) {
    return id === "codex-cli"
      ? `${on}that CLI is out of date — run: npm i -g @openai/codex@latest`
      : `${on}that CLI is out of date — reinstall it at the latest version`;
  }
  if (m.includes("auth method") || m.includes("not logged in") || m.includes("login")) {
    if (id === "gemini-cli") {
      return `${on}run \`gemini\` once in a terminal to sign in, or paste a Google AI key in Settings → API keys`;
    }
    if (id === "codex-cli") return `${on}run \`codex login\` in a terminal`;
    if (id === "claude-cli") return `${on}run \`claude\` once in a terminal to sign in`;
  }
  if (m.includes("api key") || m.includes("401") || m.includes("unauthorized")) {
    // The only one with no machine in it, and correctly so: the keys are on
    // the server, so this is the same sentence wherever the job ran.
    return "The key was refused — check it in Settings → API keys";
  }
  if (m.includes("timed out") || m.includes("timeout")) {
    return `${on}it did not answer in time. Try again, or pick another model.`;
  }
  if (m.includes("not been seen") || m.includes("waiting for")) {
    return machine ? `Open ${machine} and try again` : "Open that machine and try again";
  }
  return "";
}
