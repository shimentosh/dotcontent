import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The queue, against a real Postgres.
 *
 * The only test here that touches a database, and the exception is argued
 * rather than assumed. Everything else in `tests/` is a pure function, because
 * that is what fails silently days later on one row — but the claim query is
 * not a pure function and it carries more risk than any of them. It decides,
 * across machines that cannot see each other, who writes which section; the
 * failure modes are two laptops writing the same thing and paying twice, or a
 * job no machine can see sitting queued forever. Neither is visible to
 * `tsc`, neither shows up in a screenshot, and both cost money the first time
 * they happen in front of the team.
 *
 * Three bugs found while writing it are the argument for keeping it:
 * `bool_and` over zero rows is NULL rather than true, so a job needing nothing
 * was invisible to every worker; the reaper failed jobs a machine was still
 * running; and the payload sweep rewrote every historical row on every tick.
 *
 * It builds and drops its OWN database. Nothing here can reach the workspace
 * the dev server is using, and it skips itself entirely when there is no
 * Postgres to talk to, so `npm run check` on a laptop with the container down
 * is still green.
 */

const BASE =
  process.env.DATABASE_URL ??
  "postgres://contentos:contentos@localhost:5437/contentos";
const TEST_DB = "contentos_queue_test";
const TEST_URL = BASE.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
const ADMIN_URL = BASE.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

/** Whether there is a Postgres to talk to at all, decided once, quickly. */
async function reachable() {
  const c = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const up = await reachable();

async function admin(sql: string) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

// Bound before the repos are imported: `lib/server/db/client.ts` reads
// DATABASE_URL once, at module load, so the import has to come after this.
process.env.DATABASE_URL = TEST_URL;

const dbMod = () => import("@/lib/server/db/client");
const jobsMod = () => import("@/lib/server/repos/jobs");
const workersMod = () => import("@/lib/server/repos/workers");

let uid = "";
let n = 0;
/** A token nothing else in this file will collide with. */
const token = () => `tok-${uid}-${(n += 1)}`;

describe.skipIf(!up)("the queue", () => {
  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin(`CREATE DATABASE ${TEST_DB}`);

    const { ready, q, id } = await dbMod();
    // The real migration list, in order, against an empty database — which is
    // also the only place the 0015 SQL is ever executed by a test.
    await ready();

    uid = id("usr");
    await q(
      "INSERT INTO users (id, email, name, password_hash, owner) VALUES ($1, $2, 'Test', 'x:y', true)",
      [uid, `${uid}@test.invalid`],
    );
  }, 60_000);

  afterAll(async () => {
    if (!up) return;
    const { pool } = await dbMod();
    await pool().end();
    await admin(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  }, 30_000);

  it("applies every migration, and the worker split's columns land", async () => {
    const { q } = await dbMod();
    const { MIGRATIONS } = await import("@/lib/server/db/schema");
    const names = await q<{ name: string }>("SELECT name FROM migrations ORDER BY name");
    // Compared against the list itself rather than a name written here: a
    // hardcoded "the last one is 0015" fails the day somebody appends 0016,
    // which is a passing test breaking on correct work.
    expect(names.map((r) => r.name)).toEqual(MIGRATIONS.map((m) => m.name).sort());

    const cols = await q<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    const have = new Set(cols.map((r) => `${r.t}.${r.c}`));
    for (const want of [
      "workers.token_hash",
      "workers.workspace_ids",
      "workers.can_read_frames",
      "jobs.needs",
      "jobs.lease_until",
      "jobs.wait_until",
      "jobs.swept_at",
      "run_sections.wrote_with",
      "workspaces.api_fallback",
      "runs.created_by",
      "workspaces.brain",
    ]) {
      expect(have.has(want), `migration did not create ${want}`).toBe(true);
    }
  });

  it("hands out a job that needs nothing", async () => {
    // `bool_and` over zero rows is NULL, not true. Without the COALESCE in the
    // claim query this job is invisible to every worker for ever, and a brain
    // test simply never answers.
    const { enqueue, claim } = await jobsMod();
    const { registerWorker } = await workersMod();
    const w = await registerWorker({ userId: uid, name: "any", token: token(), enabled: [] });
    const { job } = await enqueue({ kind: "test_brain", needs: [] });
    const got = await claim(w.id, [], 5);
    expect(got.map((j) => j.id)).toContain(job.id);
  });

  it("shows a job only to a machine that has the tool switched on", async () => {
    const { enqueue, claim } = await jobsMod();
    const { registerWorker } = await workersMod();
    const without = await registerWorker({
      userId: uid, name: "no whisper", token: token(), enabled: ["claude"],
    });
    const { job } = await enqueue({ kind: "transcribe_audio", needs: ["whisper"] });
    expect((await claim(without.id, ["claude"], 5)).map((j) => j.id)).not.toContain(job.id);

    const withIt = await registerWorker({
      userId: uid, name: "has whisper", token: token(), enabled: ["whisper"],
    });
    expect((await claim(withIt.id, ["whisper"], 5)).map((j) => j.id)).toContain(job.id);
  });

  it("never hands the same job to two machines at once", async () => {
    // The whole reason the claim is `FOR UPDATE SKIP LOCKED`. Two workers
    // asking in the same millisecond must come away with disjoint sets, or a
    // section is written twice and two subscriptions are spent on it.
    const { enqueue, claim } = await jobsMod();
    const { registerWorker } = await workersMod();
    const a = await registerWorker({ userId: uid, name: "A", token: token(), enabled: ["claude"] });
    const b = await registerWorker({ userId: uid, name: "B", token: token(), enabled: ["claude"] });
    for (let i = 0; i < 8; i += 1) {
      await enqueue({ kind: "write_section", needs: ["claude"] });
    }
    const [ga, gb] = await Promise.all([
      claim(a.id, ["claude"], 8),
      claim(b.id, ["claude"], 8),
    ]);
    const ids = [...ga, ...gb].map((j) => j.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an owner's switch off when a machine reports itself again", async () => {
    /*
     * A worker re-registers every few minutes. The switch in Settings →
     * Machines has to survive that, or it is a lie: turn ffmpeg off and the
     * machine turns it back on by itself within the tick. A tool installed
     * AFTER enrolment still has to arrive switched on, or it is reported,
     * listed, and never used.
     */
    const { registerWorker, updateWorker, getWorker } = await workersMod();
    const tool = (tid: string) => ({
      id: tid, command: tid, env: {}, lead: [], present: true,
      version: "1", error: "", install: "",
    });
    const tok = token();

    // A probed-but-absent tool is reported (the page has to be able to say
    // "not installed on that computer") and must NOT be switched on: `enabled`
    // answers "may be used", and the claim query matches `needs` against it
    // alone.
    const missing = (tid: string) => ({ ...tool(tid), present: false });

    const first = await registerWorker({
      userId: uid, name: "re-reg", token: tok,
      tools: [tool("claude"), tool("ffmpeg"), missing("codex")] as never,
    });
    expect([...first.enabled].sort()).toEqual(["claude", "ffmpeg"]);

    // The owner switches ffmpeg off.
    await updateWorker(first.id, { enabled: ["claude"] });

    // The machine reports again, unchanged, and must not undo that.
    await registerWorker({
      userId: uid, name: "re-reg", token: tok,
      tools: [tool("claude"), tool("ffmpeg")] as never,
    });
    expect((await getWorker(first.id))!.enabled).toEqual(["claude"]);

    // The machine may not rename itself either. The name is what a person
    // reads in the picker when choosing where a run happens, and it is typed
    // in Settings -> Machines; a check-in that carried a hostname replaced it.
    await registerWorker({
      userId: uid, name: "shifa-hostname", token: tok,
      tools: [tool("claude"), tool("ffmpeg")] as never,
    });
    expect((await getWorker(first.id))!.name).toBe("re-reg");

    // Now whisper is installed on that machine. It is new, so it arrives on —
    // and ffmpeg is still off, because that was a decision.
    await registerWorker({
      userId: uid, name: "re-reg", token: tok,
      tools: [tool("claude"), tool("ffmpeg"), tool("whisper")] as never,
    });
    const after = (await getWorker(first.id))!.enabled;
    expect([...after].sort()).toEqual(["claude", "whisper"]);
  });

  it("refuses a result from a machine that no longer holds the job", async () => {
    // The laptop that wakes from sleep and posts a section reassigned twenty
    // minutes ago. It must not overwrite the one that actually landed.
    const { enqueue, claim, succeed, fail } = await jobsMod();
    const { registerWorker } = await workersMod();
    const mine = await registerWorker({ userId: uid, name: "mine", token: token(), enabled: ["claude"] });
    const other = await registerWorker({ userId: uid, name: "other", token: token(), enabled: ["claude"] });
    const { job } = await enqueue({ kind: "write_section", needs: ["claude"] });
    expect((await claim(mine.id, ["claude"], 1))[0].id).toBe(job.id);

    expect(await succeed(job.id, other.id, { text: "stolen" })).toBeNull();
    expect(await fail(job.id, other.id, "not mine")).toBeNull();
    expect(await succeed(job.id, mine.id, { text: "ok" })).not.toBeNull();
  });

  it("does not fail a job a machine is still running on its last attempt", async () => {
    // The reaper's passes are order-dependent: expired leases go back first,
    // and only then are spent jobs failed. Done in one pass it would end a
    // section three minutes into the attempt that was going to finish it.
    const { q } = await dbMod();
    const { enqueue, claim, reap, getJob } = await jobsMod();
    const { registerWorker } = await workersMod();
    const w = await registerWorker({ userId: uid, name: "slow", token: token(), enabled: ["claude"] });
    const { job } = await enqueue({ kind: "write_section", needs: ["claude"], maxAttempts: 1 });
    const [held] = await claim(w.id, ["claude"], 1);
    expect(held.attempts).toBe(1); // already at max_attempts, and still running

    await reap();
    expect((await getJob(job.id))!.state).toBe("claimed");

    await q("UPDATE jobs SET lease_until = now() - interval '1 minute' WHERE id = $1", [job.id]);
    await reap();
    expect((await getJob(job.id))!.state).toBe("failed");
  });

  it("clears a finished job's prompt once, not on every pass", async () => {
    const { q } = await dbMod();
    const { enqueue, sweepPayloads } = await jobsMod();
    const { job } = await enqueue({
      kind: "write_section",
      needs: ["claude"],
      payload: { system: "x".repeat(4000), user: "y" },
    });
    await q(
      `UPDATE jobs SET state = 'done', finished_at = now() - interval '2 days',
              result = '{"text":"written","ms":1200}'::jsonb
        WHERE id = $1`,
      [job.id],
    );

    expect(await sweepPayloads()).toBeGreaterThan(0);
    // The second pass must match nothing: without `swept_at` this UPDATE
    // rewrote every historical row every fifteen seconds, for ever.
    expect(await sweepPayloads()).toBe(0);

    const [row] = await q<{ payload: Record<string, unknown>; result: Record<string, unknown> }>(
      "SELECT payload, result FROM jobs WHERE id = $1",
      [job.id],
    );
    expect(row.payload).toEqual({});
    // The operational record survives — it is the only thing that says where
    // the work ran and what it cost.
    expect(row.result.ms).toBe(1200);
  });
});
