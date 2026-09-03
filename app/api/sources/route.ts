import { requireUser } from "@/lib/server/auth";
import { listSources } from "@/lib/server/repos/sources";
import { ingest } from "@/lib/server/services/ingest";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** A download, frames and a transcript. Minutes, not seconds. */
export const maxDuration = 800;

export async function GET(request: Request) {
  try {
    await ready();
    await requireUser();
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    return ok(await listSources(workspaceId ?? undefined));
  } catch (e) {
    return caught(e);
  }
}

/**
 * Fetch a video.
 *
 * Synchronous on purpose. A background job would need a queue, a worker and a
 * way to ask how it is going; this is one person's machine pulling one reel,
 * and the browser can wait with a spinner on it.
 */
export async function POST(request: Request) {
  try {
    await ready();
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      workspaceId?: string | null;
      refresh?: boolean;
    };
    if (!body.url?.trim()) return fail("Paste a link first");
    return ok(
      await ingest({
        url: body.url,
        workspaceId: body.workspaceId ?? null,
        refresh: body.refresh,
      }),
      201,
    );
  } catch (e) {
    return caught(e);
  }
}
