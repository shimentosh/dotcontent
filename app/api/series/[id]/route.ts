import { requireUser } from "@/lib/server/auth";
import {
  DuplicateName,
  addTopics,
  deleteSeries,
  getSeries,
  updateSeries,
} from "@/lib/server/repos/series";
import { caught, fail, ok, ready } from "@/lib/server/http";

export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const s = await getSeries(id);
    return s ? ok(s) : fail("No such series", 404);
  } catch (e) {
    return caught(e);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const s = await updateSeries(id, await request.json().catch(() => ({})));
    return s ? ok(s) : fail("No such series", 404);
  } catch (e) {
    if (e instanceof DuplicateName) {
      return Response.json(
        { error: e.message, existing: e.existing },
        { status: 409 },
      );
    }
    return caught(e);
  }
}

/**
 * Delete a series, with or without what is standing on it.
 *
 * `?keepTopics=1` moves its topics to the holding shelf first, so the shelf
 * can go without taking a dozen ideas with it. Without the flag the topics go
 * too — which is what a delete usually means, and why it is the one you have
 * to ask for.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const keepTopics =
      new URL(request.url).searchParams.get("keepTopics") === "1";
    return ok(await deleteSeries(id, { keepTopics }));
  } catch (e) {
    return caught(e);
  }
}

/**
 * Add topics to a series.
 *
 * One endpoint for one topic and for fifty, because the part numbering is the
 * same problem either way and splitting it would mean two places that assign
 * numbers.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ready();
    await requireUser();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      topics?: { name: string; context?: string; status?: string }[];
    };
    const topics = (body.topics ?? []).filter((t) => t?.name?.trim());
    if (!topics.length) return fail("Nothing to add");

    /*
     * `{ added, skipped }` rather than the rows alone: a request for five
     * topics that produces two is not an error, and it is not a success the
     * caller can report honestly without being told which three were already
     * covered and where.
     */
    const result = await addTopics(id, topics);
    return ok(result, result.added.length ? 201 : 200);
  } catch (e) {
    return caught(e);
  }
}
