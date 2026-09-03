import { requireUser } from "@/lib/server/auth";
import { ingestFile } from "@/lib/server/services/ingest";
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

    const workspaceId = form?.get("workspaceId");
    return ok(
      await ingestFile({
        filename: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        workspaceId: typeof workspaceId === "string" ? workspaceId : null,
      }),
      201,
    );
  } catch (e) {
    return caught(e);
  }
}
