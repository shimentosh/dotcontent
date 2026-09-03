import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import { listSeries } from "@/lib/server/repos/series";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "@/lib/server/repos/workspaces";

type Patch = Parameters<typeof updateWorkspace>[1];
type Create = Parameters<typeof createWorkspace>[0];

/** Workspaces, each answered with its shelves — the shape the store hydrates from. */
@Controller("workspaces")
export class WorkspacesController {
  @Get()
  async list() {
    const list = await listWorkspaces();
    return Promise.all(
      list.map(async (w) => ({ ...w, series: await listSeries(w.id) })),
    );
  }

  @Post()
  async create(@Body() body: Create) {
    return { ...(await createWorkspace(body)), series: [] };
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const ws = await getWorkspace(id);
    if (!ws) throw new NotFoundException("No such workspace");
    return { ...ws, series: await listSeries(id) };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: Patch) {
    const ws = await updateWorkspace(id, body ?? {});
    if (!ws) throw new NotFoundException("No such workspace");
    return { ...ws, series: await listSeries(id) };
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    if ((await listWorkspaces()).length <= 1) {
      throw new ConflictException(
        "This is the only workspace — there would be nothing left",
      );
    }
    return { ok: await deleteWorkspace(id) };
  }
}
