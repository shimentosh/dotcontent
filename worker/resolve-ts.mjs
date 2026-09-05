/**
 * Let the worker import the app's TypeScript by its plain path.
 *
 * Node 22.18+ strips types out of a .ts file on its own, so this sidecar needs
 * no bundler and no ts-node — but its ESM resolver still refuses an
 * extensionless specifier, so `import "../lib/server/tools"` fails at run time
 * even though every editor and `tsc` resolve it happily. Writing the extension
 * instead (`"../lib/server/tools.ts"`) runs, and then `tsc --noEmit` on the
 * repo fails with TS5097, because `allowImportingTsExtensions` is off in the
 * root tsconfig and this worker has no business turning it on for the whole
 * app.
 *
 * So the resolution gap is closed here, in eleven lines, rather than by
 * changing a compiler option that every other file in the repo lives under.
 * Only relative specifiers are touched, and only when they carry no extension:
 * a bare package name still resolves exactly as node_modules says it should.
 */
export async function resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Not a .ts after all — fall through and let the default resolver give
      // its own error, which names the specifier the author actually wrote.
    }
  }
  return nextResolve(specifier, context);
}
