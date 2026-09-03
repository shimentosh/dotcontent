import { requireUser, revokeInvite } from "@/lib/server/auth";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** Take a link back. Only an unused one can go — a spent invite is history. */
export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { token } = await params;
    const gone = await revokeInvite(token);
    return gone ? ok({ ok: true }) : fail("That invite is already used", 409);
  } catch (e) {
    return caught(e);
  }
}
