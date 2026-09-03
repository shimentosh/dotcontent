import { requireUser } from "@/lib/server/auth";
import { brainStatuses } from "@/lib/server/brains";
import { toolStatuses } from "@/lib/server/tools";
import { getSettings, listSecrets, setSettings } from "@/lib/server/repos/settings";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** A section of a run reaches for tools; probing five processes can be slow. */
export const maxDuration = 60;

/**
 * What this machine can actually do.
 *
 * Every field is the result of running something or reading a row — the page
 * that renders this used to hold a set of ids in memory and call it a
 * connection, so it would cheerfully report yt-dlp as connected on a machine
 * that had never had it.
 */
export async function GET(request: Request) {
  try {
    await ready();
    await requireUser();
    // ?recheck=1 skips the one-minute probe cache, for the button that says
    // "I have just installed it".
    const recheck = new URL(request.url).searchParams.get("recheck") === "1";

    const [brains, tools, settings, keys] = await Promise.all([
      recheck ? toolStatuses(true).then(brainStatuses) : brainStatuses(),
      toolStatuses(recheck),
      getSettings(),
      listSecrets(),
    ]);

    /*
     * The model CLIs are probed with the rest, but they belong to the Models
     * section — listing `claude` under Local tools as well would offer a
     * switch that turns off the thing writing every section.
     */
    const MEDIA = ["yt-dlp", "ffmpeg", "ffprobe", "whisper"];
    return ok({
      brains,
      tools: tools.filter((t) => MEDIA.includes(t.id)),
      settings,
      keys: Object.keys(keys),
    });
  } catch (e) {
    return caught(e);
  }
}

export async function PATCH(request: Request) {
  try {
    await ready();
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      brain?: string;
      enabled?: string[];
    };

    if (body.brain) {
      // Refused rather than accepted-and-broken: a brain that cannot be
      // reached fails at the next section, several minutes and one confusing
      // error message later.
      const status = (await brainStatuses()).find((b) => b.id === body.brain);
      if (!status) return fail(`No model called "${body.brain}"`);
      if (!status.available) return fail(status.reason, 409);
    }

    return ok(await setSettings(body));
  } catch (e) {
    return caught(e);
  }
}
