import { cookies } from "next/headers";

import {
  currentSessionId,
  endSession,
  SESSION_COOKIE,
} from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

export async function POST() {
  try {
    await ready();
    // The row goes as well as the cookie: clearing only the cookie leaves a
    // working session id behind for anything that kept a copy.
    await endSession(await currentSessionId());
    (await cookies()).delete(SESSION_COOKIE);
    return ok({ ok: true });
  } catch (e) {
    return caught(e);
  }
}
