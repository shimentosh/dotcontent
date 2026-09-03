import { cookies } from "next/headers";

import {
  authenticate,
  cookieOptions,
  SESSION_COOKIE,
  startSession,
  sweepSessions,
} from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    await ready();
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };

    const user = await authenticate(body.email ?? "", body.password ?? "");
    void sweepSessions();

    const sid = await startSession(
      user.id,
      request.headers.get("user-agent") ?? "",
    );
    (await cookies()).set(SESSION_COOKIE, sid, cookieOptions());
    return ok(user);
  } catch (e) {
    return caught(e);
  }
}
