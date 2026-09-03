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
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import {
  addTopics,
  createSeries,
  deleteSeries,
  deleteTopic,
  getSeries,
  listSeries,
  mergeSeries,
  updateSeries,
  updateTopic,
} from "@/lib/server/repos/series";
import { FetchError, fetchSource } from "@/lib/server/services/webfetch";

type SeriesPatch = Parameters<typeof updateSeries>[1];
type TopicPatch = Parameters<typeof updateTopic>[1];

/** Shelves: the series under a workspace, and the topics that stand on them. */
@Controller("series")
export class SeriesController {
  @Get()
  list(@Query("workspaceId") workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException("workspaceId is required");
    return listSeries(workspaceId);
  }

  @Post()
  create(
    @Body()
    body: {
      workspaceId?: string;
      name?: string;
      context?: string;
      pack?: string;
      numbered?: boolean;
      partLabel?: string;
    },
  ) {
    if (!body.workspaceId) throw new BadRequestException("workspaceId is required");
    if (!body.name?.trim()) throw new BadRequestException("A series needs a name");
    // DuplicateName is answered by the errors filter as a 409 with `existing`.
    return createSeries({
      workspaceId: body.workspaceId,
      name: body.name.trim(),
      context: body.context,
      pack: body.pack,
      numbered: body.numbered,
      partLabel: body.partLabel,
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const s = await getSeries(id);
    if (!s) throw new NotFoundException("No such series");
    return s;
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: SeriesPatch) {
    const s = await updateSeries(id, body ?? {});
    if (!s) throw new NotFoundException("No such series");
    return s;
  }

  /** `?keepTopics=1` moves the topics to the Misc shelf instead of deleting them. */
  @Delete(":id")
  remove(@Param("id") id: string, @Query("keepTopics") keep?: string) {
    return deleteSeries(id, { keepTopics: keep === "1" });
  }

  /**
   * Add topics — one or fifty, same call.
   *
   * 201 when something was added, 200 when everything was already there: the
   * body says which, and the status is what the screen reads first.
   */
  @Post(":id")
  async add(
    @Param("id") id: string,
    @Body()
    body: { topics?: { name: string; context?: string; status?: string }[] },
    @Res({ passthrough: true }) res: Response,
  ) {
    const topics = (body.topics ?? []).filter((t) => t?.name?.trim());
    if (!topics.length) throw new BadRequestException("Nothing to add");
    const result = await addTopics(id, topics);
    res.status(result.added.length ? 201 : 200);
    return result;
  }

  @Post(":id/merge")
  @HttpCode(200)
  merge(@Param("id") id: string, @Body() body: { into?: string }) {
    if (!body.into) {
      throw new BadRequestException("Which series should it merge into?");
    }
    return mergeSeries(id, body.into);
  }

  /** Read a link or a feed into the shelf's brief. */
  @Post(":id/source")
  @HttpCode(200)
  async source(
    @Param("id") id: string,
    @Body() body: { url?: string; kind?: string },
  ) {
    if (!(await getSeries(id))) throw new NotFoundException("No such series");
    try {
      const source = await fetchSource(String(body.url ?? ""));
      const briefFrom = source.kind === "feed" ? "feed" : "link";
      return await updateSeries(id, { source, briefFrom });
    } catch (e) {
      if (e instanceof FetchError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  @Delete(":id/source")
  async clearSource(@Param("id") id: string) {
    const s = await updateSeries(id, { source: null, briefFrom: "typed" });
    if (!s) throw new NotFoundException("No such series");
    return s;
  }
}

/** One topic: rename it, move it, decide about it, or take it off the shelf. */
@Controller("topics")
export class TopicsController {
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: TopicPatch) {
    const t = await updateTopic(id, body ?? {});
    if (!t) throw new NotFoundException("No such topic");
    return t;
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    return { ok: await deleteTopic(id) };
  }
}
