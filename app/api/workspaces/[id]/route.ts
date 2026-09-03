import {
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "@/lib/server/repos/workspaces";
import { listSeries } from "@/lib/server/repos/series";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    const ws = await getWorkspace(id);
    return ws
      ? ok({ ...ws, series: await listSeries(id) })
      : fail("No such workspace", 404);
  } catch (e) {
    return caught(e);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    const ws = await updateWorkspace(id, await request.json().catch(() => ({})));
    return ws
      ? ok({ ...ws, series: await listSeries(id) })
      : fail("No such workspace", 404);
  } catch (e) {
    return caught(e);
  }
}

export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    // The last one cannot go: every screen reads the current workspace's packs,
    // series and voice, and an empty list is a shell with nothing to render.
    if ((await listWorkspaces()).length <= 1) {
      return fail("This is the only workspace — there would be nothing left", 409);
    }
    return ok({ ok: await deleteWorkspace(id) });
  } catch (e) {
    return caught(e);
  }
}
