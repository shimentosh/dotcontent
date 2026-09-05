// Resolves the `@/...` imports at runtime, for ts-node in development and for
// the compiled output in production.
//
// tsconfig-paths normally reads this out of tsconfig.json, but it reads it out
// of `baseUrl` — an option TypeScript 7 removes, so tsconfig no longer has one
// and its `paths` are written relative to the config file instead. The mapping
// therefore lives here.
//
// `@/` is the repo root: the sources when running TypeScript, and `dist/` when
// running the build, since `rootDir: ".."` makes dist a mirror of the root
// (dist/api/src, dist/lib). CONTENTOS_MODULE_ROOT, resolved against api/, is
// how the start scripts and the Dockerfile say which of the two it is.
const path = require("node:path");
const { register } = require("tsconfig-paths");

const root = path.resolve(__dirname, process.env.CONTENTOS_MODULE_ROOT || "..");

register({ baseUrl: root, paths: { "@/*": ["./*"] } });
