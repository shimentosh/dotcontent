import { defineConfig } from "vitest/config";

/**
 * Unit tests, for the logic a screenshot cannot check.
 *
 * Deliberately narrow. No component tests and no database: what these cover is
 * the pure functions everything else stands on — the status a row shows, the
 * slug a URL resolves by, what an imported template turns into, what the
 * researcher makes of a model's answer. Those are the things that fail
 * silently, days later, on one row.
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
