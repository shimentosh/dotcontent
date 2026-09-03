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
  deleteRun,
  getRun,
  listRuns,
  requeueFailed,
  setRunDecision,
} from "@/lib/server/repos/runs";
import {
  driveRun,
  editSection,
  isDriving,
  startRun,
  writeSection,
} from "@/lib/server/services/runs";

/**
 * Runs, and the sections written into them.
 *
 * The driver is `driveRun` in lib/server/services — a loop inside THIS
 * process, one section at a time, carrying on whether or not anybody is
 * watching. That is the reason the API is its own long-lived service and not
 * a serverless function: a run takes minutes and shells out to a local
 * model, and both need somewhere to stand.
 */
@Controller("runs")
export class RunsController {
  @Get()
  list(@Query("workspaceId") workspaceId?: string) {
    return listRuns(workspaceId || undefined);
  }

  /** Create a run with every section queued. It does not start writing. */
  @Post()
  create(
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

  @Delete(":id")
  async remove(@Param("id") id: string) {
    return { ok: await deleteRun(id) };
  }

  /**
   * Write everything that is left, on the server, and return at once.
   *
   * Pressing this on a run that failed is a retry: the failures go back in
   * the queue first, so the loop tries them again rather than skipping them.
   */
  @Post(":id/start")
  @HttpCode(200)
  async start(@Param("id") id: string) {
    if (!(await getRun(id))) throw new NotFoundException("No such run");
    const retried = await requeueFailed(id);
    return { ...driveRun(id), retried, running: true };
  }

  /** Is this run being written right now, by anyone? */
  @Get(":id/start")
  running(@Param("id") id: string) {
    return { running: isDriving(id) };
  }

  /** Write one section, now, and answer with the whole run. */
  @Post(":id/sections/:sectionId")
  @HttpCode(200)
  write(@Param("id") id: string, @Param("sectionId") sectionId: string) {
    return writeSection(id, sectionId);
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
