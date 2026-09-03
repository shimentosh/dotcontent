import {
  DuplicateName,
  createSeries,
  listSeries,
} from "@/lib/server/repos/series";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    await ready();
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) return fail("workspaceId is required");
    return ok(await listSeries(workspaceId));
  } catch (e) {
    return caught(e);
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      name?: string;
      context?: string;
      pack?: string;
      numbered?: boolean;
      partLabel?: string;
    };
    if (!body.workspaceId) return fail("workspaceId is required");
    if (!body.name?.trim()) return fail("A series needs a name");
    return ok(
      await createSeries({
        workspaceId: body.workspaceId,
        name: body.name.trim(),
        context: body.context,
        pack: body.pack,
        numbered: body.numbered,
        partLabel: body.partLabel,
      }),
      201,
    );
  } catch (e) {
    // Not just a 409: the screen offers to open the shelf that has the name,
    // which it can only do if it is told which one that is.
    if (e instanceof DuplicateName) {
      return Response.json(
        { error: e.message, existing: e.existing },
        { status: 409 },
      );
    }
    return caught(e);
  }
}
