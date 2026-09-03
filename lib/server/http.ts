import { seedIfEmpty } from "@/lib/server/services/seed";

/**
 * What the API does before it listens: migrate, then seed.
 *
 * Called once, from api/src/main.ts, before the port opens — so no request
 * ever runs against a database missing a column. Memoised on globalThis all
 * the same: the seed writes rows, and anything that reaches it twice on a
 * cold start must wait for the first run rather than write the samples again.
 *
 * `ok`, `fail` and `caught` used to live here for the Next route handlers.
 * Those handlers are gone; the API's ErrorsFilter is where a thrown thing
 * becomes a response now.
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
