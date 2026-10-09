import { assertSecret } from "@/lib/server/repos/settings";
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
const store = globalThis as unknown as { __dotcontentSeed?: Promise<void> };

export function ready(): Promise<void> {
  if (!store.__dotcontentSeed) {
    store.__dotcontentSeed = (async () => {
      // Before anything writes: a production server without DOTCONTENT_SECRET
      // encrypts API keys under a value derived from DATABASE_URL, and loses
      // every one of them the day that password is rotated. Checked here so a
      // misconfigured deploy dies at boot with a sentence saying what to set,
      // rather than looking healthy and dropping keys weeks later.
      //
      // Inside the async body rather than above it so a bad config comes back
      // as a rejected promise like every other boot failure — and, like them,
      // is not cached: fix the env var, restart, and the next call retries.
      assertSecret();
      await seedIfEmpty();
    })().catch((e) => {
      // A failed seed must not be cached as done — the next request retries.
      store.__dotcontentSeed = undefined;
      throw e;
    });
  }
  return store.__dotcontentSeed;
}
