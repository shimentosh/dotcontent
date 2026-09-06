import { id, iso, one, q, tx } from "@/lib/server/db/client";

/**
 * The queue.
 *
 * This table is where the coordination that used to live in one process's
 * memory now lives, where every process can see it. Two things it replaces,
 * both the same bug wearing different clothes:
 *
 * - The `globalThis` Set in `services/runs.ts`. `isDriving(runId)` was the only
 *   thing stopping two drivers writing the same run, and it could only ever
 *   see what this Node process was doing. `jobs_one_per_section` says the same
 *   thing in the database, out loud.
 * - `resumeOrphans()` at boot, which assumed a `writing` row must be dead
 *   because the process that started it was. `lease_until` decides that per
 *   job, on evidence — a lease that ran out — instead.
 *
 * Every function here is written so that two API replicas running it at the
 * same millisecond is uninteresting. Nothing holds state between calls, no
 * read-then-write is split across a round trip where it matters, and anything
 * that could run twice is written to be harmless the second time.
 */

export type JobKind =
  "write_section" | "ingest_source" | "transcribe_audio" | "test_brain";

/**
 * queued -> claimed -> done | failed | cancelled, or straight to unroutable.
 *
 * `unroutable` is deliberately not `failed`: it means no machine on this
 * estate advertises a tool the job needs, which is an install command rather
 * than something Retry can fix, and the page has to be able to say so.
 */
export type JobState =
  "queued" | "claimed" | "done" | "failed" | "unroutable" | "cancelled";

export type Job = {
  id: string;
  kind: JobKind;
  state: JobState;
  workspaceId: string | null;
  runId: string | null;
  sectionId: string | null;
  sourceId: string | null;
  /** Tool ids a worker must both advertise and have switched on. */
  needs: string[];
  /** Pinned machine, or null for whoever qualifies first. */
  wantsWorker: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string;
  attempts: number;
  maxAttempts: number;
  priority: number;
  workerId: string | null;
  leaseUntil: string | null;
  waitUntil: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A job with the machine attached, for the one question the run page asks. */
export type JobWithWorker = Job & {
  /** The machine that holds it, or the one it is pinned to. "" for neither. */
  workerName: string;
  /** Whether that machine has been seen recently. False when there is none. */
  workerLive: boolean;
};

type Row = Record<string, unknown>;

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

const nul = (v: unknown) => (v == null ? null : iso(v));

const mapJob = (r: Row): Job => ({
  id: String(r.id),
  kind: String(r.kind) as JobKind,
  state: String(r.state ?? "queued") as JobState,
  workspaceId: r.workspace_id == null ? null : String(r.workspace_id),
  runId: r.run_id == null ? null : String(r.run_id),
  sectionId: r.section_id == null ? null : String(r.section_id),
  sourceId: r.source_id == null ? null : String(r.source_id),
  needs: Array.isArray(r.needs) ? r.needs.map(String) : [],
  wantsWorker: r.wants_worker == null ? null : String(r.wants_worker),
  payload: asObject(r.payload),
  result: asObject(r.result),
  error: String(r.error ?? ""),
  attempts: Number(r.attempts ?? 0),
  maxAttempts: Number(r.max_attempts ?? 2),
  priority: Number(r.priority ?? 0),
  workerId: r.worker_id == null ? null : String(r.worker_id),
  leaseUntil: nul(r.lease_until),
  waitUntil: nul(r.wait_until),
  claimedAt: nul(r.claimed_at),
  finishedAt: nul(r.finished_at),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/**
 * How long a claim is good for, and how long a machine may be silent.
 *
 * Ninety seconds is six missed fifteen-second heartbeats: long enough that a
 * Windows machine paging in a large ffmpeg does not lose the job it is part
 * way through, short enough that a closed laptop is noticed before anybody has
 * reloaded the page twice.
 */
export const LEASE_SECONDS = 90;

/**
 * Put a job in the queue, or find the one that is already there.
 *
 * `jobs_one_per_section` is a unique index over (run_id, section_id) for jobs
 * that are queued or claimed, and this insert names it as the arbiter with
 * DO NOTHING. So a double Run, two open tabs and a stale poll all converge on
 * the SAME job rather than on two, which matters in money: two jobs for one
 * section is two machines writing it, two subscriptions spent, and the second
 * result overwriting the first.
 *
 * DO NOTHING rather than DO UPDATE because the existing job may already be
 * claimed and four minutes into running, and quietly rewriting its payload
 * underneath the machine executing it would be worse than either outcome.
 *
 * `created` is returned rather than hidden so the caller cannot mistake the
 * two cases. It is the difference between "enqueued a section" and "that
 * section was already being written", which is a different sentence on the
 * page and a different decision in `advance()`.
 */
export async function enqueue(patch: {
  kind: JobKind;
  workspaceId?: string | null;
  runId?: string | null;
  sectionId?: string | null;
  sourceId?: string | null;
  needs?: string[];
  wantsWorker?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  /**
   * Deadline for a job queued behind a machine that is not live. Past it the
   * reaper fails the job naming what it was waiting for, so a run cannot sit
   * on "Writing" forever because somebody's laptop stayed shut.
   */
  waitUntil?: Date | string | null;
  /**
   * 'unroutable' at birth, for the case where no machine anywhere advertises
   * a tool this job needs. Queueing it instead would be a run that reads
   * "Writing" forever, which is exactly the bug DECISIONS.md records, rebuilt
   * at a larger scale. `error` carries the sentence naming the tool.
   *
   * Note this state is outside the unique index's predicate on purpose: two
   * Runs against an estate with no `whisper` do produce two unroutable rows.
   * That is the honest record — the person pressed the button twice and was
   * told no twice — and neither row can ever be claimed.
   */
  state?: "queued" | "unroutable";
  error?: string;
}): Promise<{ job: Job; created: boolean }> {
  const state = patch.state ?? "queued";
  const inserted = await one<Row>(
    `INSERT INTO jobs
       (id, kind, state, workspace_id, run_id, section_id, source_id, needs,
        wants_worker, payload, priority, max_attempts, wait_until, error,
        finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12,
             $13, $14, CASE WHEN $3 = 'unroutable' THEN now() ELSE NULL END)
     ON CONFLICT (run_id, section_id) WHERE state IN ('queued', 'claimed')
       DO NOTHING
     RETURNING *`,
    [
      id("job"),
      patch.kind,
      state,
      patch.workspaceId ?? null,
      patch.runId ?? null,
      patch.sectionId ?? null,
      patch.sourceId ?? null,
      JSON.stringify(patch.needs ?? []),
      patch.wantsWorker ?? null,
      JSON.stringify(patch.payload ?? {}),
      patch.priority ?? 0,
      patch.maxAttempts ?? 2,
      patch.waitUntil ?? null,
      patch.error ?? "",
    ],
  );
  if (inserted) return { job: mapJob(inserted), created: true };

  // DO NOTHING returns nothing, so the live job has to be read back. It is
  // guaranteed to exist: the only way to get here is the arbiter index having
  // matched a row that is queued or claimed.
  const existing = await one<Row>(
    `SELECT * FROM jobs
      WHERE run_id = $1 AND section_id = $2
        AND state IN ('queued', 'claimed')
      LIMIT 1`,
    [patch.runId ?? null, patch.sectionId ?? null],
  );
  return { job: mapJob(existing!), created: false };
}

/**
 * Hand a worker up to `max` jobs it is able to run, and lease them to it.
 *
 * The single most important query in the system, and `FOR UPDATE SKIP LOCKED`
 * is the reason it works. It lets four laptops run this at the same
 * millisecond and get four disjoint sets of rows, because a row another
 * transaction has locked is SKIPPED rather than waited for. Without it the
 * two obvious alternatives both fail: plain `SELECT ... FOR UPDATE` serialises
 * every worker behind the slowest one, and a bare `SELECT` then `UPDATE` lets
 * two workers read the same row and both write the section.
 *
 * The capability test is the other half. `enabledTools` is the worker's own
 * switched-on tool ids; a job is only visible if EVERY id in its `needs` is in
 * that list, so a machine without `whisper` never sees a transcription and the
 * queue does its own routing. The COALESCE matters more than it looks:
 * `bool_and` over zero rows is NULL, not true, so a job with `needs: []` — a
 * `test_brain`, or an ingest that asks for nothing — would be invisible to
 * every worker forever without it.
 *
 * `attempts` increments here rather than on failure, because the failure this
 * count exists to survive is the one where nothing ever comes back: a laptop
 * that is closed mid-section never gets to tell anyone it failed.
 *
 * Concurrency is the caller's to enforce — pass `max` as the worker's
 * `max_concurrency` minus what it already holds. The queue deliberately does
 * not count the worker's live jobs itself, because that read would have to
 * happen inside this transaction to mean anything, and the caller already knows
 * the answer from the claim request.
 *
 * `workers.workspace_ids` is not consulted. It is empty on every row today and
 * empty means all; the day it is not, this is where the `AND` goes.
 */
export async function claim(
  workerId: string,
  enabledTools: string[],
  max = 1,
  leaseSeconds = LEASE_SECONDS,
): Promise<Job[]> {
  if (max <= 0) return [];
  const rows = await q<Row>(
    `WITH claimable AS (
       SELECT id FROM jobs
        WHERE state = 'queued'
          AND (wants_worker IS NULL OR wants_worker = $1)
          AND COALESCE(
                (SELECT bool_and(need IN (SELECT jsonb_array_elements_text($2::jsonb)))
                   FROM jsonb_array_elements_text(needs) AS need),
                true)
        ORDER BY priority DESC, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $3
     )
     UPDATE jobs j
        SET state       = 'claimed',
            worker_id   = $1,
            attempts    = j.attempts + 1,
            claimed_at  = now(),
            lease_until = now() + ($4 || ' seconds')::interval,
            updated_at  = now()
       FROM claimable c
      WHERE j.id = c.id
      RETURNING j.*`,
    [workerId, JSON.stringify(enabledTools), max, String(leaseSeconds)],
  );
  return rows.map(mapJob);
}

/**
 * Extend the lease on the jobs a worker still holds, and say which it does not.
 *
 * `drop` is how a worker finds out a job was cancelled, reaped from under it,
 * or handed to somebody else while its machine was asleep — the answer is to
 * kill the child process rather than spend another four minutes producing
 * something nobody will accept. Everything not in `keep` is in `drop`,
 * including ids this server has never heard of, because "I do not know that
 * job" and "that job is not yours" call for the same action.
 *
 * The extension is scoped to `worker_id = $1` and to jobs still `claimed`, so
 * a heartbeat can never take a job back from the machine that now owns it.
 */
export async function heartbeat(
  workerId: string,
  jobIds: string[],
  leaseSeconds = LEASE_SECONDS,
): Promise<{ keep: string[]; drop: string[] }> {
  if (!jobIds.length) return { keep: [], drop: [] };
  const rows = await q<{ id: string }>(
    `UPDATE jobs
        SET lease_until = now() + ($3 || ' seconds')::interval,
            updated_at  = now()
      WHERE id = ANY($2::text[])
        AND worker_id = $1
        AND state = 'claimed'
      RETURNING id`,
    [workerId, jobIds, String(leaseSeconds)],
  );
  const keep = rows.map((r) => r.id);
  const kept = new Set(keep);
  return { keep, drop: jobIds.filter((jid) => !kept.has(jid)) };
}

/**
 * Accept a result, but only from the machine that currently holds the job.
 *
 * The `worker_id` and `lease_until` conditions are the whole point, and they
 * are why this returns null rather than throwing: a laptop that wakes from
 * sleep and posts a section that was reassigned twenty minutes ago is not an
 * exception, it is an expected event with a correct outcome — the write is
 * refused, the result already in `run_sections` stands, and the worker is told
 * 409 so it stops. Throwing would make normal operation look like a fault in
 * the logs, and the difference matters when somebody is deciding whether the
 * queue is broken.
 *
 * Null therefore means exactly one thing to the caller: this result is not
 * wanted, do not write it anywhere.
 */
export async function succeed(
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
): Promise<Job | null> {
  const row = await one<Row>(
    `UPDATE jobs
        SET state       = 'done',
            result      = $3::jsonb,
            error       = '',
            lease_until = NULL,
            finished_at = now(),
            updated_at  = now()
      WHERE id = $1 AND worker_id = $2 AND state = 'claimed'
        AND lease_until > now()
      RETURNING *`,
    [jobId, workerId, JSON.stringify(result)],
  );
  return row ? mapJob(row) : null;
}

/**
 * Record a failure from the machine that holds the job, and decide what next.
 *
 * Same ownership and lease test as `succeed`, and null means the same thing:
 * this report is stale, ignore it. A worker that lost its lease and then
 * failed must not be able to burn an attempt on work somebody else is now
 * doing.
 *
 * `retryable: false` skips straight to `failed` without spending another
 * attempt. That covers the refusals, the bad payloads and the missing tools —
 * a worker that cannot honour the transport it was handed must FAIL rather
 * than quietly answer some other way, and retrying that on the same machine
 * would only produce the same refusal more slowly.
 *
 * A retryable failure with attempts left goes back to `queued` with the worker
 * cleared, so another machine can take it. The error is kept on the row even
 * then: when the retry also fails, the person needs both sentences.
 */
export async function fail(
  jobId: string,
  workerId: string,
  error: string,
  retryable = true,
): Promise<Job | null> {
  const row = await one<Row>(
    `UPDATE jobs
        SET state = CASE
              WHEN $4 AND attempts < max_attempts THEN 'queued'
              ELSE 'failed' END,
            error       = $3,
            worker_id   = CASE
              WHEN $4 AND attempts < max_attempts THEN NULL
              ELSE worker_id END,
            lease_until = NULL,
            finished_at = CASE
              WHEN $4 AND attempts < max_attempts THEN NULL
              ELSE now() END,
            updated_at  = now()
      WHERE id = $1 AND worker_id = $2 AND state = 'claimed'
        AND lease_until > now()
      RETURNING *`,
    [jobId, workerId, error, retryable],
  );
  return row ? mapJob(row) : null;
}

/**
 * What the reaper's interval calls. The only thing that moves a job out of
 * `claimed` without the worker's consent, and it does it on evidence.
 *
 * Three passes, in this order, and the order is load-bearing:
 *
 * 1. Expired leases go back to `queued`. A machine that has missed six
 *    heartbeats is shut, asleep or gone, and the job is nobody's.
 * 2. Queued jobs that have used up their attempts fail. Scoped to `queued` on
 *    purpose: applied to `claimed` rows it would kill a machine that is at
 *    that moment three minutes into its final attempt, which is precisely the
 *    kind of stolen work this whole design exists to stop.
 * 3. Queued jobs past `wait_until` fail, because the machine they were queued
 *    behind never opened. The error is left to the caller to have written at
 *    enqueue, since only the enqueuer knows which machine was meant.
 *
 * Every statement is a single UPDATE with its condition in the WHERE clause,
 * so running this in two API replicas at the same moment is harmless: the
 * second one matches no rows. It is idempotent for the same reason — a second
 * pass over a job it has already moved finds it in a state the WHERE excludes.
 */
export async function reap(): Promise<{
  requeued: string[];
  failed: string[];
}> {
  return tx(async (c) => {
    const expired = await c.query<{ id: string }>(
      `UPDATE jobs
          SET state = 'queued', worker_id = NULL, lease_until = NULL,
              updated_at = now()
        WHERE state = 'claimed' AND lease_until < now()
        RETURNING id`,
    );

    const spent = await c.query<{ id: string }>(
      `UPDATE jobs
          SET state = 'failed',
              error = CASE WHEN error = '' THEN
                'Gave up after ' || attempts || ' attempts with nothing back from any machine.'
                ELSE error END,
              lease_until = NULL, finished_at = now(), updated_at = now()
        WHERE state = 'queued' AND attempts >= max_attempts
        RETURNING id`,
    );

    const waited = await c.query<{ id: string }>(
      `UPDATE jobs
          SET state = 'failed',
              error = CASE WHEN error = '' THEN
                'No machine picked this up in time.' ELSE error END,
              lease_until = NULL, finished_at = now(), updated_at = now()
        WHERE state = 'queued' AND wait_until IS NOT NULL AND wait_until < now()
        RETURNING id`,
    );

    return {
      requeued: expired.rows.map((r) => r.id),
      failed: [...spent.rows, ...waited.rows].map((r) => r.id),
    };
  });
}

/**
 * Throw away the prompts, keep the record.
 *
 * A `write_section` payload is six to eight thousand characters of system
 * prompt that `systemPrompt()` rebuilds identically on demand, and its
 * `result.text` is already in `run_sections`, which is the copy anything
 * actually reads. Keeping both would make `jobs` several times the size of the
 * content it describes, to answer no question something else cannot.
 *
 * What only this table can say survives: which kind of work it was, which
 * machine ran it, how many attempts it took, how long it took, and which model
 * answered. That is the operational record this console has never had, and it
 * is small.
 *
 * A day, not an hour, because that is long enough for somebody to come back to
 * a failure the next morning with the payload still there to look at.
 *
 * `swept_at` makes it idempotent and cheap: an already-swept job is excluded
 * by the WHERE and by the partial index behind it, so this can run in the
 * reaper's fifteen-second pass forever without ever rewriting the same row
 * twice.
 */
export async function sweepPayloads(afterHours = 24): Promise<number> {
  const rows = await q<{ id: string }>(
    `UPDATE jobs
        SET payload  = '{}'::jsonb,
            result   = jsonb_strip_nulls(jsonb_build_object(
                         'ms',    result -> 'ms',
                         'using', result -> 'using')),
            swept_at = now(),
            updated_at = now()
      WHERE finished_at IS NOT NULL
        AND swept_at IS NULL
        AND finished_at < now() - ($1 || ' hours')::interval
      RETURNING id`,
    [String(afterHours)],
  );
  return rows.length;
}

/**
 * Stop everything outstanding for a run.
 *
 * Queued jobs simply stop existing as work. A claimed one keeps running for up
 * to fifteen seconds, until its next heartbeat puts it in `drop` and the
 * worker kills the child process — there is no way to reach into somebody's
 * laptop, and no need for one.
 *
 * This is what `deleteRun` has to call first. Without it, deleting a run whose
 * sections are queued leaves jobs pointing at a row that is gone, and a job
 * waiting on a machine that never opens has no way to stop before `wait_until`.
 *
 * Returns the ids so the caller can say how much it stopped.
 */
export async function cancel(runId: string): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `UPDATE jobs
        SET state = 'cancelled', lease_until = NULL, finished_at = now(),
            updated_at = now()
      WHERE run_id = $1 AND state IN ('queued', 'claimed')
      RETURNING id`,
    [runId],
  );
  return rows.map((r) => r.id);
}

/** One job, for the result and fail endpoints to look at before they act. */
export async function getJob(jid: string): Promise<Job | null> {
  const row = await one<Row>("SELECT * FROM jobs WHERE id = $1", [jid]);
  return row ? mapJob(row) : null;
}

/*
 * The machine attached to a job, and whether it is awake.
 *
 * `LIVE_WINDOW_MS` from repos/workers.ts as a Postgres interval. Duplicated as
 * a literal here rather than interpolated, because it is inside SQL that is
 * also read by whoever is tuning the queue; if one moves the other has to, and
 * a comment saying so is more reliable than an import that hides it.
 */
const WITH_WORKER = `
  SELECT j.*,
         COALESCE(w.name, p.name, '') AS worker_name,
         COALESCE(
           COALESCE(w.last_seen_at, p.last_seen_at) > now() - interval '2 minutes',
           false) AS worker_live
    FROM jobs j
    LEFT JOIN workers w ON w.id = j.worker_id
    LEFT JOIN workers p ON p.id = j.wants_worker`;

const mapWithWorker = (r: Row): JobWithWorker => ({
  ...mapJob(r),
  workerName: String(r.worker_name ?? ""),
  workerLive: r.worker_live === true,
});

/**
 * Every job a run has ever had, newest last, with its machine.
 *
 * This is what answers the two sentences the run page has to be able to say
 * and cannot today: *writing on Shakhawat's desktop*, and *waiting for
 * Shakhawat's desktop, which has not been seen since Tuesday*. The join covers
 * both — `worker_id` for a job in flight, `wants_worker` for one queued behind
 * a specific machine — because from the reader's point of view they are the
 * same question.
 */
export async function jobsForRun(runId: string): Promise<JobWithWorker[]> {
  const rows = await q<Row>(
    `${WITH_WORKER} WHERE j.run_id = $1 ORDER BY j.created_at`,
    [runId],
  );
  return rows.map(mapWithWorker);
}

/**
 * The live jobs across every run, for the queue view and for deciding whether
 * a run is actually moving.
 *
 * Queued and claimed only. A finished job is history and belongs to
 * `jobsForRun`; this answers "what is the estate doing right now", which is
 * the question a person asks when a page has said Writing for a while.
 */
export async function activeJobs(): Promise<JobWithWorker[]> {
  const rows = await q<Row>(
    `${WITH_WORKER}
      WHERE j.state IN ('queued', 'claimed')
      ORDER BY j.priority DESC, j.created_at`,
  );
  return rows.map(mapWithWorker);
}

/**
 * How many jobs a machine is holding.
 *
 * The number `claim`'s `max` is derived from, and the reason `claim` does not
 * work it out itself: the worker's own request already says how many it wants,
 * and a count taken outside the claim transaction is a hint rather than a
 * limit. It is a hint that is good enough — the cost of being wrong by one is
 * a laptop running two sections instead of one.
 */
export async function heldBy(workerId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT count(*) AS n FROM jobs
      WHERE worker_id = $1 AND state = 'claimed' AND lease_until > now()`,
    [workerId],
  );
  return Number(row?.n ?? 0);
}
