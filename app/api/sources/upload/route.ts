import { requireUser } from "@/lib/server/auth";
import { MAX_UPLOAD_BYTES, ingestFile } from "@/lib/server/services/ingest";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** Frames and a transcript off an uploaded file. Minutes. */
export const maxDuration = 800;

/**
 * A video from the person's own machine.
 *
 * Multipart rather than base64 JSON: a 200MB reel encodes to 270MB of string,
 * and the body has to be held in memory twice to parse it.
 */
export async function POST(request: Request) {
  try {
    await ready();
    await requireUser();

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail("Choose a video file");
    if (!file.size) return fail("That file is empty");
    // The declared size, before a byte is read. The stream re-checks the truth.
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail(
        `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1048576)}MB — trim it or export it smaller.`,
        413,
      );
    }

    const workspaceId = form?.get("workspaceId");
    return ok(
      await ingestFile({
        filename: file.name,
        stream: file.stream(),
        workspaceId: typeof workspaceId === "string" ? workspaceId : null,
      }),
      201,
    );
  } catch (e) {
    return caught(e);
  }
}
