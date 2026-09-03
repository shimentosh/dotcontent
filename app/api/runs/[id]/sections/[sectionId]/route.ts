import { editSection, writeSection } from "@/lib/server/services/runs";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** Research reads pages and a script thinks; the default would cut both off. */
export const maxDuration = 800;

export async function POST(
  _r: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  try {
    await ready();
    const { id, sectionId } = await params;
    return ok(await writeSection(id, sectionId));
  } catch (e) {
    return caught(e);
  }
}

/**
 * Save what a person typed into this section.
 *
 * PATCH rather than POST, which on this route means "run it": one asks the
 * model for new words and costs money, the other keeps the words already on
 * screen. They must not be the same verb.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  try {
    await ready();
    const { id, sectionId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      content?: unknown;
    };
    if (typeof body.content !== "string") {
      return fail("content must be text", 400);
    }
    return ok(await editSection(id, sectionId, body.content));
  } catch (e) {
    return caught(e);
  }
}
