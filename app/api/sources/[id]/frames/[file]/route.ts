import { requireUser } from "@/lib/server/auth";
import { frameFile } from "@/lib/server/services/ingest";
import { caught, fail, ready } from "@/lib/server/http";

/**
 * One still out of a downloaded video.
 *
 * Served through a route rather than from /public: these are somebody's
 * research material, not site assets, and putting them under /public would
 * make every frame of every source readable by anyone who can guess a path.
 */
export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id, file } = await params;
    const bytes = await frameFile(id, file);
    if (!bytes) return fail("No such frame", 404);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/jpeg",
        // The file for a given id never changes; a rewrite makes a new source.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return caught(e);
  }
}
