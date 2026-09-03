import { driveRun, isDriving } from "@/lib/server/services/runs";
import { getRun, requeueFailed } from "@/lib/server/repos/runs";
import { caught, fail, ok, ready } from "@/lib/server/http";

/**
 * Write the whole run, without being asked again.
 *
 * Answers as soon as the loop is started rather than when it finishes: a run
 * is twelve model calls and several minutes, which no request should be held
 * open for. The page follows along by reading the run.
 *
 * Failed sections go back in the queue first, which is what makes this Retry
 * as well as Run. The drive deliberately skips a section that failed — looping
 * on the one thing that does not work would spend the model's whole afternoon
 * on it — so without this a second press finished instantly having written
 * nothing, and the Retry button on a failed row did nothing at all.
 */
export async function POST(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    const run = await getRun(id);
    if (!run) return fail("No such run", 404);
    const retried = await requeueFailed(id);
    return ok({ ...driveRun(id), retried, running: true });
  } catch (e) {
    return caught(e);
  }
}

/** Whether it is being written right now — for a page that just loaded. */
export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    return ok({ running: isDriving(id) });
  } catch (e) {
    return caught(e);
  }
}
