import { cookies } from "next/headers";

import {
  cookieOptions,
  createUser,
  SESSION_COOKIE,
  signupOpen,
  startSession,
} from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

/** Whether the console still has room for an owner. The form asks before it renders. */
export async function GET() {
  try {
    await ready();
    return ok({ open: await signupOpen() });
  } catch (e) {
    return caught(e);
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      name?: string;
      invite?: string;
    };

    const user = await createUser({
      email: body.email ?? "",
      password: body.password ?? "",
      name: body.name,
      invite: body.invite,
    });

    // Signed in immediately. Making someone type the password they just chose
    // into a second form proves nothing and loses people.
    const sid = await startSession(
      user.id,
      request.headers.get("user-agent") ?? "",
    );
    (await cookies()).set(SESSION_COOKIE, sid, cookieOptions());
    return ok(user, 201);
  } catch (e) {
    return caught(e);
  }
}
