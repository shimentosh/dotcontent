import { createWorkspace, listWorkspaces } from "@/lib/server/repos/workspaces";
import { listSeries } from "@/lib/server/repos/series";
import { caught, ok, ready } from "@/lib/server/http";

/** Every workspace, each with its series and their topics. */
export async function GET() {
  try {
    await ready();
    const list = await listWorkspaces();
    // Concurrently rather than in sequence: the queries are independent, and
    // four workspaces should cost one round trip of latency, not four.
    return ok(
      await Promise.all(
        list.map(async (w) => ({ ...w, series: await listSeries(w.id) })),
      ),
    );
  } catch (e) {
    return caught(e);
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    const body = await request.json().catch(() => ({}));
    return ok({ ...(await createWorkspace(body)), series: [] }, 201);
  } catch (e) {
    return caught(e);
  }
}
