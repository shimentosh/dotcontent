import { callBrain } from "./brains";
import type { Config } from "./config";
import type { JobResult, TestPayload } from "./job-types";

/**
 * Can this machine write?
 *
 * The smallest job, and the one that makes the whole design legible: a person
 * in Settings → Integrations picks a model and a machine and finds out whether
 * that pair works. A model that writes on one teammate's laptop and not on
 * another's is now a thing the console can express, and before the split it
 * could not even ask the question.
 *
 * This never fails the job, and that is deliberate. The refusal IS the answer
 * — "codex is not signed in on this machine" is what the button was pressed to
 * discover — so it comes back as a result with `ok: false`, which is what the
 * page polls for. Failing the job instead would put the sentence in `error`,
 * spend an attempt, and leave the button spinning while the queue decided
 * whether to try again.
 */
export async function testBrain(cfg: Config, payload: TestPayload): Promise<JobResult> {
  const started = Date.now();
  try {
    const { text } = await callBrain(cfg, {
      brain: payload.brain,
      transport: payload.transport,
      system: payload.system,
      user: payload.user,
      tier: payload.tier,
      timeoutMs: payload.timeoutMs ?? 150_000,
    });
    const reply = text.trim();
    return {
      // Answering with nothing is not a pass. The button exists to prove the
      // model writes, and an empty string proves the opposite.
      ok: Boolean(reply),
      ms: Date.now() - started,
      reply: reply.slice(0, 2000),
      error: reply ? "" : "The model answered with nothing.",
      transport: payload.transport,
    };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      reply: "",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
      transport: payload.transport,
    };
  }
}
