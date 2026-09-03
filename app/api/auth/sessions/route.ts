import {
  currentSessionId,
  endOtherSessions,
  listSessions,
  requireUser,
} from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

/** Where this account is signed in. The one you are using is marked. */
export async function GET() {
  try {
    await ready();
    const user = await requireUser();
    return ok(await listSessions(user.id, await currentSessionId()));
  } catch (e) {
    return caught(e);
  }
}

/** Signs out everywhere except here. */
export async function DELETE() {
  try {
    await ready();
    const user = await requireUser();
    const ended = await endOtherSessions(user.id, await currentSessionId());
    return ok({ ended });
  } catch (e) {
    return caught(e);
  }
}
