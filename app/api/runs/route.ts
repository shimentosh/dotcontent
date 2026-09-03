import { listRuns } from "@/lib/server/repos/runs";
import { startRun } from "@/lib/server/services/runs";
import { caught, ok, ready } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    await ready();
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    return ok(await listRuns(workspaceId ?? undefined));
  } catch (e) {
    return caught(e);
  }
}

/**
 * Start a run.
 *
 * Creates it with every section queued and returns immediately — it does not
 * generate. The client drives the sections one call at a time, so progress is
 * visible while it happens rather than arriving as one long silence.
 */
export async function POST(request: Request) {
  try {
    await ready();
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      topicId?: string | null;
      sourceId?: string | null;
      packSlug?: string;
      inputs?: Record<string, string>;
      title?: string;
    };
    return ok(
      await startRun({
        workspaceId: body.workspaceId ?? "",
        topicId: body.topicId ?? null,
        sourceId: body.sourceId ?? null,
        packSlug: body.packSlug ?? "enbn-website-package",
        inputs: body.inputs ?? {},
        title: body.title,
      }),
      201,
    );
  } catch (e) {
    return caught(e);
  }
}
