import { deleteTopic, updateTopic } from "@/lib/server/repos/series";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    const { id } = await params;
    const t = await updateTopic(id, await request.json().catch(() => ({})));
    return t ? ok(t) : fail("No such topic", 404);
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
    const { id } = await params;
    return ok({ ok: await deleteTopic(id) });
  } catch (e) {
    return caught(e);
  }
}
