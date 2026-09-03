import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { brainStatuses, findBrain, write } from "@/lib/server/brains";
import { getSettings, listSecrets, setSettings } from "@/lib/server/repos/settings";
import { toolStatuses } from "@/lib/server/tools";

const MEDIA = ["yt-dlp", "ffmpeg", "ffprobe", "whisper"];

/**
 * What this machine can actually reach, probed by running it.
 *
 * The models and the local binaries, each checked by invoking it rather than
 * by reading a flag somebody set. `?recheck=1` runs the probes again instead
 * of answering from the cache.
 */
@Controller("integrations")
export class IntegrationsController {
  @Get()
  async wiring(@Query("recheck") recheck?: string) {
    const again = recheck === "1";
    const [brains, tools, settings, keys] = await Promise.all([
      again ? toolStatuses(true).then(brainStatuses) : brainStatuses(),
      toolStatuses(again),
      getSettings(),
      listSecrets(),
    ]);
    return {
      brains,
      tools: tools.filter((t) => MEDIA.includes(t.id)),
      settings,
      keys: Object.keys(keys),
    };
  }

  /** Pick the brain, or switch local tools on and off. */
  @Patch()
  async update(@Body() body: { brain?: string; enabled?: string[] }) {
    if (body.brain) {
      const status = (await brainStatuses()).find((b) => b.id === body.brain);
      if (!status) throw new BadRequestException(`No model called "${body.brain}"`);
      if (!status.available) throw new ConflictException(status.reason);
    }
    return setSettings(body);
  }

  /** Ask a model for two words, and report what happened. */
  @Post("test")
  @HttpCode(200)
  async test(@Body() body: { id?: string }) {
    const def = findBrain(body.id ?? "");
    if (!def) throw new BadRequestException("No such model");

    const status = (await brainStatuses()).find((b) => b.id === def.id)!;
    if (!status.available) {
      return { ok: false, ms: 0, reply: "", error: status.reason, fix: "" };
    }

    const started = Date.now();
    try {
      const reply = await write(def.id, {
        system: "You are a terse assistant. Answer in one short line, no preamble.",
        user: "Reply with exactly: BRAIN OK",
        tier: "cheap",
        timeoutMs: 150_000,
      });
      return {
        ok: Boolean(reply.trim()),
        ms: Date.now() - started,
        reply: reply.slice(0, 200),
        error: reply.trim() ? "" : "It answered with nothing",
        fix: "",
        transport: status.transport,
      };
    } catch (e) {
      return {
        ok: false,
        ms: Date.now() - started,
        reply: "",
        error: e instanceof Error ? e.message.slice(0, 400) : "It did not answer",
        fix: e instanceof Error ? fixFor(def.id, e.message) : "",
        transport: status.transport,
      };
    }
  }
}

/** The one-line remedy for the failures people actually hit. */
function fixFor(id: string, message: string) {
  const m = message.toLowerCase();

  if (m.includes("unknown variant") || m.includes("failed to refresh available models")) {
    return id === "codex-cli"
      ? "That CLI is out of date — run: npm i -g @openai/codex@latest"
      : "That CLI is out of date — reinstall it at the latest version";
  }
  if (m.includes("auth method") || m.includes("not logged in") || m.includes("login")) {
    if (id === "gemini-cli") {
      return "Run `gemini` once in a terminal to sign in, or paste a Google AI key in Settings → API keys";
    }
    if (id === "codex-cli") return "Run `codex login` in a terminal";
    if (id === "claude-cli") return "Run `claude` once in a terminal to sign in";
  }
  if (m.includes("api key") || m.includes("401") || m.includes("unauthorized")) {
    return "The key was refused — check it in Settings → API keys";
  }
  if (m.includes("timed out") || m.includes("timeout")) {
    return "It did not answer in time. Try again, or pick another model.";
  }
  return "";
}
