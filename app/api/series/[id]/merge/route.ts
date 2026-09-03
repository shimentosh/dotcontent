import { mergeSeries } from "@/lib/server/repos/series";
import { caught, fail, ok, ready } from "@/lib/server/http";

/**
 * Fold this series into another one.
 *
 * A POST rather than a PATCH on the target: it deletes one row, moves every
 * topic on it and renumbers them, which is a job being asked for rather than
 * a field being set.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { into?: string };
    if (!body.into) return fail("Which series should it merge into?");
    return ok(await mergeSeries(id, body.into));
  } catch (e) {
    return caught(e);
  }
}
