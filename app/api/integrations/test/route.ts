import { requireUser } from "@/lib/server/auth";
import { brainStatuses, findBrain, write } from "@/lib/server/brains";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** A cold CLI can take a while to answer its first prompt. */
export const maxDuration = 200;

/**
 * Ask a model to say one word, and report exactly what happened.
 *
 * Installed is not the same as working, and the difference is invisible until
 * something is actually sent: a CLI can be on PATH, report a version, even be
 * logged in, and still fail — out of date, no auth method configured, a model
 * name the account cannot reach. Every one of those looks identical to a
 * `--version` probe, and the first time you would otherwise find out is six
 * minutes into a twelve-section run.
 */
export async function POST(request: Request) {
  try {
    await ready();
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const def = findBrain(body.id ?? "");
    if (!def) return fail("No such model");

    const status = (await brainStatuses()).find((b) => b.id === def.id)!;
    if (!status.available) {
      return ok({ ok: false, ms: 0, reply: "", error: status.reason, fix: "" });
    }

    const started = Date.now();
    try {
      const reply = await write(def.id, {
        system: "You are a terse assistant. Answer in one short line, no preamble.",
        user: "Reply with exactly: BRAIN OK",
        tier: "cheap",
        timeoutMs: 150_000,
      });
      return ok({
        ok: Boolean(reply.trim()),
        ms: Date.now() - started,
        reply: reply.slice(0, 200),
        error: reply.trim() ? "" : "It answered with nothing",
        fix: "",
        transport: status.transport,
      });
    } catch (e) {
      return ok({
        ok: false,
        ms: Date.now() - started,
        reply: "",
        // The tool's own words, not a summary of them. "Please set an Auth
        // method" is the whole fix; "could not reach Gemini" is not.
        error: e instanceof Error ? e.message.slice(0, 400) : "It did not answer",
        fix: e instanceof Error ? fixFor(def.id, e.message) : "",
        transport: status.transport,
      });
    }
  } catch (e) {
    return caught(e);
  }
}

/**
 * The command that fixes the failure, when the failure names itself.
 *
 * A CLI's error is precise about what is wrong and silent about what to do —
 * "unknown variant `max`" is a version mismatch, but only if you already know
 * that. These map the handful of failures that have one obvious fix.
 */
function fixFor(id: string, message: string) {
  const m = message.toLowerCase();

  if (m.includes("unknown variant") || m.includes("failed to refresh available models")) {
    // The CLI is older than the service it is talking to and cannot parse the
    // reply any more. Nothing about the account or the prompt is wrong.
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
