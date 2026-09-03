import { removeUser, requireUser } from "@/lib/server/auth";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** Remove someone. Their sessions go with them; their work stays. */
export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const me = await requireUser();
    const { id } = await params;
    const gone = await removeUser(id, me.id);
    return gone ? ok({ ok: true }) : fail("No such account", 404);
  } catch (e) {
    return caught(e);
  }
}
