import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Where the build output goes.
   *
   * `next build` and `next dev` share `.next` by default, so building while the
   * dev server is up rewrites the chunks that server is still handing out: open
   * tabs lose hot reloading and only come back with a manual refresh. Checking a
   * build now writes somewhere else — see `npm run build:check`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * A server that can run on its own.
   *
   * `standalone` writes `.next/standalone/server.js` with only the modules it
   * actually reaches — the difference between shipping a 900MB node_modules to
   * the VPS and shipping the app. Nothing changes for `next dev`.
   */
  output: "standalone",
};

export default nextConfig;
