import { listTools, toolsFor } from "@/lib/server/repos/tools";
import { caught, ok, ready } from "@/lib/server/http";

/**
 * The tool bench.
 *
 * `?workspace=<id>` asks for one workspace's bench — what it is allowed to
 * see. Without it you get every tool and its assignment, which is what the
 * screen that manages them needs and nothing else should be reading.
 */
export async function GET(request: Request) {
  try {
    await ready();
    const workspace = new URL(request.url).searchParams.get("workspace");
    return ok(workspace ? await toolsFor(workspace) : await listTools());
  } catch (e) {
    return caught(e);
  }
}
