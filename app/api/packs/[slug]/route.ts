import { requireUser } from "@/lib/server/auth";
import {
  deletePack,
  getPack,
  restorePack,
  updatePack,
} from "@/lib/server/repos/packs";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(
  _r: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { slug } = await params;
    const pack = await getPack(slug);
    return pack ? ok(pack) : fail("No such pack", 404);
  } catch (e) {
    return caught(e);
  }
}

/**
 * Edit a pack — any pack.
 *
 * The shipped ones used to be refused here, on the reasoning that a tuned
 * prompt belongs with the code that reads it. That was true of a pack you
 * could only read; it is the wrong trade for a library you are meant to build
 * on. They are seeded into the table as ordinary rows now, and POST below puts
 * one back the way it shipped if an edit goes wrong.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { slug } = await params;
    const pack = await updatePack(slug, await request.json().catch(() => ({})));
    return pack ? ok(pack) : fail("No such pack", 404);
  } catch (e) {
    return caught(e);
  }
}

/** Restore the shipped version of a pack, section by section. */
export async function POST(
  _r: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { slug } = await params;
    const pack = await restorePack(slug);
    return pack
      ? ok(pack)
      : fail("No version of that pack ships with the app", 404);
  } catch (e) {
    return caught(e);
  }
}

export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { slug } = await params;
    return ok({ ok: await deletePack(slug) });
  } catch (e) {
    return caught(e);
  }
}
