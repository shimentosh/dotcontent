import {
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { getJob, reap, sweepPayloads } from "@/lib/server/repos/jobs";
import { sectionFailed } from "@/lib/server/services/runs";

/**
 * How often the queue is looked at, and how often the prompts are thrown away.
 *
 * Fifteen seconds is a quarter of the ninety-second lease, so a job whose
 * machine has gone quiet is back in the queue within six missed heartbeats
 * plus a tick — noticed before anybody has reloaded the page twice.
 *
 * The payload sweep runs on its own, much slower clock. It only ever matches
 * jobs that finished a day ago, so running it every fifteen seconds would be
 * the same UPDATE finding nothing hundreds of times an hour; five minutes is
 * often enough that a row is never carrying a prompt for long after its day,
 * and rare enough to stay invisible.
 */
const REAP_MS = 15_000;
const SWEEP_EVERY = 20; // ticks — five minutes

/**
 * The one thing that moves a job out of `claimed` without the worker's say-so.
 *
 * It does it on evidence — a lease that ran out — rather than on the
 * assumption `resumeOrphans()` used to make at boot, that a `writing` row must
 * be dead because the process that started it was. That reasoning held while
 * there was one process and the model was its own child; the moment the work
 * runs on somebody's laptop it is false, and a deploy would requeue a section
 * a machine was four minutes into writing, pay for it twice, and let the
 * second answer overwrite the first.
 *
 * `reap` and `sweepPayloads` are both single UPDATEs with their conditions in
 * the WHERE clause, so two API replicas running this interval at the same
 * millisecond is uninteresting: the second one matches no rows. That is the
 * property that lets this be an unguarded `setInterval` rather than a leader
 * election.
 *
 * Three things the lifecycle has to get right, and each has a failure behind
 * it:
 *
 * - Registered once. `onModuleInit` runs once per application, and the handle
 *   is kept so a second call cannot stack a second interval on top of the
 *   first — two reapers is not a correctness problem but it is a doubled load
 *   on the one query that must stay fast.
 * - Cleared on shutdown. Without `onApplicationShutdown` a test or a dev
 *   reload leaves a timer holding a database pool open, and the process never
 *   exits.
 * - A tick that throws must not take the process with it. `setInterval` with
 *   an async callback produces an unhandled rejection when the database blinks
 *   — a restart, a failover, `docker compose down` — and an unhandled
 *   rejection ends Node. Catching inside the tick means a blink costs one
 *   pass, not the API. `running` is the same guard applied to time: a pass
 *   that is somehow still going when the next tick fires is skipped rather
 *   than overlapped.
 */
@Injectable()
export class Reaper implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticks = 0;

  onModuleInit() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), REAP_MS);
    // The interval is maintenance, not work anybody is waiting on: it must
    // never be the reason the process stays alive.
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { requeued, failed } = await reap();
      // Said out loud because these are the two events nobody witnessed: a
      // machine that went quiet mid-section, and a job that ran out of
      // attempts or of patience. Silence otherwise — a pass that moves nothing
      // is what almost every pass does.
      if (requeued.length) {
        console.log(`Reaper: ${requeued.length} job(s) back in the queue after a lost lease`);
      }
      if (failed.length) {
        console.log(`Reaper: ${failed.length} job(s) failed — out of attempts or past their wait`);
      }

      /*
       * Tell the run about it, or the reaping is invisible.
       *
       * `reap()` ends a job on evidence the worker never reports: a lease that
       * ran out because a laptop was shut, attempts spent, or a wait that
       * nobody came back for. Nothing else is going to arrive and say so — the
       * machine that had the job is by definition not talking — so a section
       * left at `writing` or `queued` would stay there with an empty queue
       * behind it, which is exactly the "Writing for five days" row this
       * design is built to prevent.
       *
       * Each is done on its own rather than in one pass: a run whose topic
       * cannot be updated must not stop the next job's section being marked.
       */
      for (const jid of failed) {
        try {
          const job = await getJob(jid);
          if (job?.kind === "write_section") {
            await sectionFailed(job, job.error || "No machine finished this.");
          }
        } catch (e) {
          console.error(
            `Reaper: job ${jid} ended but its section could not be marked:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      this.ticks += 1;
      if (this.ticks % SWEEP_EVERY === 0) {
        const swept = await sweepPayloads();
        if (swept) console.log(`Reaper: cleared the prompts on ${swept} finished job(s)`);
      }
    } catch (e) {
      // One pass, not the API. The next tick tries again in fifteen seconds,
      // and both statements are idempotent, so nothing is owed from the pass
      // that failed.
      console.error("Reaper pass failed:", e instanceof Error ? e.message : e);
    } finally {
      this.running = false;
    }
  }
}
