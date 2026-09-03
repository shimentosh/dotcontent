import { requireUser } from "@/lib/server/auth";
import { createPack, listPacks } from "@/lib/server/repos/packs";
import { caught, fail, ok, ready } from "@/lib/server/http";

/**
 * The pack library.
 *
 * Instructions come back with it — the builder edits them, so it needs them.
 * The list is small and read once per screen, which is a different trade from
 * the run endpoints and the reason the earlier version stripped them out.
 */
export async function GET() {
  try {
    await ready();
    await requireUser();
    return ok(await listPacks());
  } catch (e) {
    return caught(e);
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    await requireUser();
    const body = await request.json().catch(() => ({}));
    if (!body?.name?.trim()) return fail("A pack needs a name");
    return ok(await createPack(body), 201);
  } catch (e) {
    return caught(e);
  }
}
