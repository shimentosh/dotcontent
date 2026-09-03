import { createInvite, listInvites, requireUser } from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

/**
 * The links that let anyone else in.
 *
 * Any signed-in person can make one. There is no admin tier in this console —
 * everyone who is here can already read and change everything, so pretending
 * invites are privileged would be a lock on a door with no walls. What stops
 * a stranger is that they need a link at all.
 */
export async function GET() {
  try {
    await ready();
    await requireUser();
    return ok(await listInvites());
  } catch (e) {
    return caught(e);
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      note?: string;
      days?: number;
    };
    return ok(
      await createInvite({
        createdBy: user.id,
        email: body.email,
        note: body.note,
        days: body.days,
      }),
      201,
    );
  } catch (e) {
    return caught(e);
  }
}
