/**
 * A production build that leaves the dev server alone.
 *
 * `next build` and `next dev` both write `.next`, so building while the dev
 * server is running rewrites the chunks it is serving: open tabs stop hot
 * reloading and only recover on a manual refresh. This builds into
 * `.next-check` instead, which `next.config.ts` reads from NEXT_DIST_DIR.
 *
 * Written as a script rather than an inline env assignment because npm runs
 * scripts through cmd.exe on Windows, where `VAR=value command` is not a thing.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("next", ["build", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: ".next-check" },
});

process.exit(result.status ?? 1);
