import { requireUser } from "@/lib/server/auth";
import { getSource } from "@/lib/server/repos/sources";
import { removeSource } from "@/lib/server/services/ingest";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const source = await getSource(id);
    return source ? ok(source) : fail("No such source", 404);
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
    return ok({ ok: await removeSource(id) });
  } catch (e) {
    return caught(e);
  }
}
