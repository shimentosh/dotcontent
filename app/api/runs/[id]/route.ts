import { requireUser } from "@/lib/server/auth";
import { deleteRun, getRun, setRunDecision } from "@/lib/server/repos/runs";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const run = await getRun(id);
    return run ? ok(run) : fail("No such run", 404);
  } catch (e) {
    return caught(e);
  }
}

/**
 * Mark a run used, ready or ignored.
 *
 * Only the decision is patchable. A run's inputs and its sections are the
 * record of what happened, and letting a PATCH rewrite them would make that
 * record a guess.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      decision?: string;
    };
    if (
      body.decision !== "used" &&
      body.decision !== "ready" &&
      body.decision !== "ignored"
    ) {
      return fail("decision must be used, ready or ignored", 400);
    }
    return (await setRunDecision(id, body.decision))
      ? ok({ id, decision: body.decision })
      : fail("No such run", 404);
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
    await requireUser();
    const { id } = await params;
    return ok({ ok: await deleteRun(id) });
  } catch (e) {
    return caught(e);
  }
}
