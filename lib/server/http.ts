import { seedIfEmpty } from "@/lib/server/services/seed";

/**
 * What every route does before it touches data.
 *
 * Memoised on globalThis rather than re-run per request: the seed writes rows,
 * and two requests arriving together on a cold start would otherwise both see
 * an empty table and both write the samples. Once per process, and the promise
 * is shared so the second caller waits for the first rather than racing it.
 */
const store = globalThis as unknown as { __contentosSeed?: Promise<void> };

export function ready(): Promise<void> {
  if (!store.__contentosSeed) {
    store.__contentosSeed = seedIfEmpty().catch((e) => {
      // A failed seed must not be cached as done — the next request retries.
      store.__contentosSeed = undefined;
      throw e;
    });
  }
  return store.__contentosSeed;
}

export const ok = (body: unknown, status = 200) =>
  Response.json(body as never, { status });

export const fail = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

/**
 * Postgres is not answering.
 *
 * The single most likely thing to be wrong on a fresh start, and the one the
 * app is worst at explaining: without the container every route 500s, the
 * screens render empty, and the only clue is `ECONNREFUSED` in a server log
 * nobody has open. `pg` reports it as a connection error rather than a query
 * error, so it can be told apart from anything the SQL got wrong.
 */
const OFFLINE = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|Connection terminated|connect ECONN/i;

const isOffline = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  const message = e instanceof Error ? e.message : String(e);
  return OFFLINE.test(code) || OFFLINE.test(message);
};

/** Turns a thrown service error into the response it asked for. */
export function caught(e: unknown) {
  if (isOffline(e)) {
    // 503, not 500: the app is fine, the thing behind it is not running, and
    // the difference is the whole of what you need to know.
    return fail(
      "The database is not running. Start Docker Desktop, then run: npm run db:up",
      503,
    );
  }

  const status =
    typeof e === "object" && e && "status" in e ? Number((e as { status: number }).status) : 500;
  const message = e instanceof Error ? e.message : "Something went wrong";
  return fail(message, Number.isFinite(status) ? status : 500);
}
