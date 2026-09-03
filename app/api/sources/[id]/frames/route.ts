import { requireUser } from "@/lib/server/auth";
import { addFrameAt } from "@/lib/server/services/ingest";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** ffmpeg seeking into a downloaded file — seconds, but not instant. */
export const maxDuration = 120;

/** One more still, at a moment somebody asked for. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { at?: number };
    const at = Number(body.at);
    if (!Number.isFinite(at) || at < 0) return fail("Give a time in seconds");
    return ok(await addFrameAt(id, at), 201);
  } catch (e) {
    return caught(e);
  }
}
