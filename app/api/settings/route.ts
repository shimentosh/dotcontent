import { requireUser } from "@/lib/server/auth";
import { getSettings, setSettings } from "@/lib/server/repos/settings";
import { caught, ok, ready } from "@/lib/server/http";

export async function GET() {
  try {
    await ready();
    await requireUser();
    return ok(await getSettings());
  } catch (e) {
    return caught(e);
  }
}

export async function PATCH(request: Request) {
  try {
    await ready();
    await requireUser();
    return ok(await setSettings(await request.json().catch(() => ({}))));
  } catch (e) {
    return caught(e);
  }
}
