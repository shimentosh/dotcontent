import { cookies } from "next/headers";

import {
  cookieOptions,
  requireUser,
  SESSION_COOKIE,
  startSession,
  updatePassword,
} from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    await ready();
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      current?: string;
      next?: string;
    };

    await updatePassword(user.id, body.current ?? "", body.next ?? "");

    // Every session was dropped, including this one. A fresh cookie so the
    // person who just changed their password is not logged out by doing it.
    const sid = await startSession(
      user.id,
      request.headers.get("user-agent") ?? "",
    );
    (await cookies()).set(SESSION_COOKIE, sid, cookieOptions());
    return ok({ ok: true });
  } catch (e) {
    return caught(e);
  }
}
