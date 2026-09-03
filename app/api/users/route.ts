import { listUsers, requireUser } from "@/lib/server/auth";
import { caught, ok, ready } from "@/lib/server/http";

/** Who has access to this console. */
export async function GET() {
  try {
    await ready();
    await requireUser();
    return ok(await listUsers());
  } catch (e) {
    return caught(e);
  }
}
