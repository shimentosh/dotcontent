import { requireUser } from "@/lib/server/auth";
import { getTool, updateTool } from "@/lib/server/repos/tools";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(
  _r: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { slug } = await params;
    const tool = await getTool(slug);
    return tool ? ok(tool) : fail("No such tool", 404);
  } catch (e) {
    return caught(e);
  }
}

/** Rename it, recategorise it, switch it off, or say where it appears. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { slug } = await params;
    const tool = await updateTool(slug, await request.json().catch(() => ({})));
    return tool ? ok(tool) : fail("No such tool", 404);
  } catch (e) {
    return caught(e);
  }
}
