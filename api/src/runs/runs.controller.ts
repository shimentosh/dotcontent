import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import {
  getRun,
  listRuns,
  requeueFailed,
  setRunDecision,
} from "@/lib/server/repos/runs";
import { jobsForRun, type JobWithWorker } from "@/lib/server/repos/jobs";
import {
  advance,
  editSection,
  isRunning,
  queueSection,
  removeRun,
  startRun,
  stopRun,
} from "@/lib/server/services/runs";
import type { User } from "@/lib/server/auth";
import { CurrentUser } from "../common/user.decorator";

/**
 * What a job looks like from the browser: an allowlist, not a row.
 *
 * A `Pick` of the repo's own type rather than a fresh interface, for the same
 * reason lib/runs-client.ts imports `Run` instead of redeclaring it — two ends
 * of a JSON boundary that describe a field separately are two things that can
 * disagree, and the disagreement shows up as a blank chip rather than an
 * error. The client picks the same keys off the same type, so renaming one in
 * repos/jobs.ts breaks both compiles instead of quietly emptying the page.
 *
 * What is deliberately NOT here:
 *
 * - `payload`. A `write_section` job carries six to eight thousand characters
 *   of system prompt. The browser has no use for a single one of them, and a
 *   twelve-section run polled every second and a half would ship more prompt
 *   per minute than the run has content in it.
 * - `result`. Its `text` IS the section, and `run_sections` already holds the
 *   copy every screen reads; sending it again doubles the page for nothing.
 * - the ids of machines and workspaces. The page names a machine, it never
 *   addresses one.
 *
 * An allowlist rather than an omit-these because a column added to `jobs` next
 * month must not start reaching browsers because nobody remembered this route.
 */
export type RunJob = Pick<
  JobWithWorker,
  | "id"
  | "kind"
  | "state"
  | "sectionId"
  | "workerName"
  | "workerLive"
  | "error"
  | "attempts"
  | "maxAttempts"
  | "waitUntil"
  | "createdAt"
>;

/**
 * Runs, and the sections written into them.
 *
 * Every route here returns as soon as the database says so. The driver used to
 * be `driveRun` — a loop inside THIS process holding one run for its whole
 * length, one section at a time, because the model was a child process of the
 * loop. It is `advance` now: it puts jobs on the queue for whatever is ready
 * and stops, and the machines that hold the CLIs pick them up. So a run is not
 * something a request or a process owns, and restarting the API mid-run loses
 * nothing.
 *
 * These are the person-facing routes, authenticated by session. What a worker
 * calls lives under /api/workers with its own credential — see docs/WORKER.md
 * for why the two are deliberately different principals.
 */
@Controller("runs")
export class RunsController {
  @Get()
  list(@Query("workspaceId") workspaceId?: string) {
    return listRuns(workspaceId || undefined);
  }

  /**
   * Create a run with every section queued. It does not start writing.
   *
   * The author comes off the session, never out of the body: the guard has
   * already established who this is, and a `createdBy` a caller could type
   * would let anyone charge a run to a colleague. Same rule as `brandVoice`,
   * which the service reads from the workspace for the same reason.
   */
  @Post()
  create(
    @CurrentUser() user: User,
    @Body()
    body: {
      workspaceId?: string;
      topicId?: string | null;
      sourceId?: string | null;
      packSlug?: string;
      inputs?: Record<string, string>;
      title?: string;
    },
  ) {
    return startRun({
      workspaceId: body.workspaceId ?? "",
      topicId: body.topicId ?? null,
      sourceId: body.sourceId ?? null,
      packSlug: body.packSlug ?? "enbn-website-package",
      inputs: body.inputs ?? {},
      title: body.title,
      userId: user.id,
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const run = await getRun(id);
    if (!run) throw new NotFoundException("No such run");
    return run;
  }

  @Patch(":id")
  async decide(@Param("id") id: string, @Body() body: { decision?: string }) {
    const d = body.decision;
    if (d !== "used" && d !== "ready" && d !== "ignored") {
      throw new BadRequestException("decision must be used, ready or ignored");
    }
    if (!(await setRunDecision(id, d))) throw new NotFoundException("No such run");
    return { id, decision: d };
  }

  /**
   * Delete a run, having first stopped whatever is writing it.
   *
   * `removeRun` cancels the jobs before the row goes. Deleting first would
   * leave a machine minutes into a section for a run that no longer exists.
   */
  @Delete(":id")
  async remove(@Param("id") id: string) {
    return { ok: await removeRun(id) };
  }

  /**
   * Queue everything that is ready, and return at once.
   *
   * Pressing this on a run that failed is a retry: the failures go back to
   * queued first, so `advance` finds them eligible again rather than skipping
   * them. Pressing it twice is harmless — the queue's one-live-job-per-section
   * index makes both presses converge on the same job instead of paying two
   * subscriptions to write one section.
   */
  @Post(":id/start")
  @HttpCode(200)
  async start(@Param("id") id: string) {
    if (!(await getRun(id))) throw new NotFoundException("No such run");
    const retried = await requeueFailed(id);
    const queued = await advance(id);
    return {
      started: queued.enqueued.length > 0,
      retried,
      running: await isRunning(id),
      ...queued,
    };
  }

  /**
   * The queue's own record of this run, one entry per job, with the machine.
   *
   * Three things the page had to fake because none of this was reachable:
   *
   * - "no machine here has the tool" was a regex against the section's error
   *   text, matching a sentence `advance()` writes. Rewording that sentence
   *   silently downgraded a NO MACHINE chip to a plain FAILED one and nothing
   *   failed anywhere. `state` says `unroutable` here, as a state.
   * - the name of a machine that is asleep survived only in the answer to
   *   `POST :id/start`, so it appeared only in the tab that pressed the
   *   button, never for a colleague and never for a single-section write.
   * - "being written on Shakhawat's desktop" could not be said at all:
   *   `run_sections.wrote_with` is set on success, so while a section is in
   *   flight there is no name anywhere the browser can see. `worker_id` is
   *   joined to a name here from the moment the job is claimed.
   *
   * Session-authenticated, like every other route on this controller — the
   * global `SessionGuard` covers it. It is NOT a worker route: a worker talks
   * to /api/workers with its own credential, and deliberately cannot read the
   * content library. Nothing here could reconstruct that credential either;
   * the token is a sha256 in `workers` and never leaves the database at all.
   *
   * This is also what `GET :id/start` above answers, in full rather than
   * reduced to a boolean: `isRunning` IS `jobsForRun(...).some(live)`. The
   * page's poll therefore swaps one call for the other rather than adding a
   * second timer to the tick.
   */
  @Get(":id/jobs")
  async jobs(@Param("id") id: string): Promise<RunJob[]> {
    if (!(await getRun(id))) throw new NotFoundException("No such run");
    return (await jobsForRun(id)).map((j) => ({
      id: j.id,
      kind: j.kind,
      state: j.state,
      sectionId: j.sectionId,
      workerName: j.workerName,
      workerLive: j.workerLive,
      error: j.error,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      waitUntil: j.waitUntil,
      createdAt: j.createdAt,
    }));
  }

  /**
   * Stop a run that is writing.
   *
   * The jobs are cancelled here; a machine already running one finds out at its
   * next heartbeat, within fifteen seconds, and kills the child process.
   */
  @Post(":id/stop")
  @HttpCode(200)
  async stop(@Param("id") id: string) {
    if (!(await getRun(id))) throw new NotFoundException("No such run");
    return { ok: true, ...(await stopRun(id)) };
  }

  /**
   * Queue one section, and answer with the whole run.
   *
   * It no longer writes it here and waits: the request would be holding open
   * for however long a laptop takes. The row comes back saying `writing`, and
   * the page reads the result from the run like every other section.
   */
  @Post(":id/sections/:sectionId")
  @HttpCode(200)
  write(@Param("id") id: string, @Param("sectionId") sectionId: string) {
    return queueSection(id, sectionId);
  }

  /** Replace a section's text by hand. It counts as finished from then on. */
  @Patch(":id/sections/:sectionId")
  edit(
    @Param("id") id: string,
    @Param("sectionId") sectionId: string,
    @Body() body: { content?: unknown },
  ) {
    if (typeof body.content !== "string") {
      throw new BadRequestException("content must be text");
    }
    return editSection(id, sectionId, body.content);
  }
}
