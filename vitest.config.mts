import { defineConfig } from "vitest/config";

/**
 * Unit tests, for the logic a screenshot cannot check.
 *
 * Deliberately narrow. No component tests: what these cover is the pure
 * functions everything else stands on — the status a row shows, the slug a URL
 * resolves by, what an imported template turns into, what the researcher makes
 * of a model's answer. Those are the things that fail silently, days later, on
 * one row.
 *
 * `tests/queue.test.ts` is the one exception, and it argues itself in its own
 * header. The claim query decides, across machines that cannot see each other,
 * who writes which section; it is not a pure function and no screenshot shows
 * it working. It builds and drops its own database and skips itself when there
 * is no Postgres, so `npm run check` with the container down is still green.
 *
 * `.mts` because the package is CommonJS and this file is ESM; `tsconfigPaths`
 * is what makes `@/lib/...` resolve the way it does in the app, so a test
 * imports the real module rather than a copy of it.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
