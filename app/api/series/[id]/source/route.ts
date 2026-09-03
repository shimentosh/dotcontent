import { requireUser } from "@/lib/server/auth";
import { getSeries, updateSeries } from "@/lib/server/repos/series";
import { FetchError, fetchSource } from "@/lib/server/services/webfetch";
import { caught, fail, ok, ready } from "@/lib/server/http";

/** Reading a site is a network round trip, and some of them are slow. */
export const maxDuration = 60;

/**
 * Read a page or a feed, and hang it on this series.
 *
 * The fetch and the save are one request rather than two: a source that was
 * saved but never read, or read but never saved, is a state the UI would have
 * to explain, and there is nothing useful a person could do about either.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    if (!(await getSeries(id))) return fail("No such series", 404);

    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      kind?: string;
    };
    const source = await fetchSource(String(body.url ?? ""));

    /*
     * What the tab said, unless the site disagreed.
     *
     * Paste a feed into "From a link" and it is still a feed — refusing it
     * would be the app correcting you about something it can plainly see.
     */
    const briefFrom = source.kind === "feed" ? "feed" : "link";
    return ok(await updateSeries(id, { source, briefFrom }));
  } catch (e) {
    if (e instanceof FetchError) return fail(e.message, e.status);
    return caught(e);
  }
}

/** Detach the source and go back to whatever was typed. */
export async function DELETE(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const s = await updateSeries(id, { source: null, briefFrom: "typed" });
    return s ? ok(s) : fail("No such series", 404);
  } catch (e) {
    return caught(e);
  }
}
