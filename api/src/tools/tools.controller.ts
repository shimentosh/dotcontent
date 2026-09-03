import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
} from "@nestjs/common";

import {
  getTool,
  listTools,
  toolsFor,
  updateTool,
  type ToolPatch,
} from "@/lib/server/repos/tools";

/**
 * The tool bench.
 *
 * `?workspace=<id>` is one workspace's bench — what it is allowed to see.
 * Without it you get every tool and its assignment, which is what the screen
 * that manages them needs and nothing else should be reading.
 */
@Controller("tools")
export class ToolsController {
  @Get()
  list(@Query("workspace") workspace?: string) {
    return workspace ? toolsFor(workspace) : listTools();
  }

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    const tool = await getTool(slug);
    if (!tool) throw new NotFoundException("No such tool");
    return tool;
  }

  /** Rename it, recategorise it, switch it off, or say where it appears. */
  @Patch(":slug")
  async update(@Param("slug") slug: string, @Body() body: ToolPatch) {
    const tool = await updateTool(slug, body ?? {});
    if (!tool) throw new NotFoundException("No such tool");
    return tool;
  }
}
