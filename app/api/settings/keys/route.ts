import { requireUser } from "@/lib/server/auth";
import {
  clearSecret,
  listSecrets,
  setSecret,
} from "@/lib/server/repos/settings";
import { caught, fail, ok, ready } from "@/lib/server/http";

/**
 * Service keys.
 *
 * Masked on the way out, always. The server is the only thing that ever needs
 * the real value, and a key that can be read back out of an API is a key that
 * leaks through any XSS this app ever has.
 */
export async function GET() {
  try {
    await ready();
    await requireUser();
    return ok(await listSecrets());
  } catch (e) {
    return caught(e);
  }
}

export async function POST(request: Request) {
  try {
    await ready();
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      value?: string;
    };
    if (!body.id) return fail("Which key?");
    await setSecret(body.id, body.value ?? "");
    return ok(await listSecrets());
  } catch (e) {
    return caught(e);
  }
}

export async function DELETE(request: Request) {
  try {
    await ready();
    await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return fail("Which key?");
    await clearSecret(id);
    return ok(await listSecrets());
  } catch (e) {
    return caught(e);
  }
}
