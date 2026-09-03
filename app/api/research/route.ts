import { requireUser } from "@/lib/server/auth";
import { research } from "@/lib/server/services/researcher";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** Reading eight stills with a model is minutes, not seconds. */
export const maxDuration = 800;

export async function POST(request: Request) {
  try {
    await ready();
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      sourceId?: string;
      frames?: string[];
      note?: string;
    };
    if (!body.sourceId) return fail("Fetch a video first");
    return ok(
      await research({
        sourceId: body.sourceId,
        frames: body.frames,
        note: body.note,
      }),
    );
  } catch (e) {
    return caught(e);
  }
}
