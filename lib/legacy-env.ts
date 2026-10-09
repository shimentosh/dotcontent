/**
 * The environment variables this app read before it was called dotcontent.
 *
 * Every variable is `DOTCONTENT_*` now, and the code reads only those names.
 * Deployments and teammates' laptops set up before the rename still carry
 * `CONTENTOS_*` in a `.env`, a Dokploy panel or a desktop shortcut, and a
 * rename that ignored them would turn every one of those into a console that
 * cannot decrypt its keys and a worker that cannot find its console.
 *
 * So each `CONTENTOS_X` is copied to `DOTCONTENT_X` when the new name is unset
 * or blank, once, before anything else reads the environment. The new name
 * always wins: somebody who set both meant the one they set last.
 *
 * No imports, on purpose. The worker loads this from `worker/register.mjs`,
 * ahead of the type-stripping resolver it would otherwise need, and the API
 * loads it as its first import; either way it runs before a module that reads
 * a variable at load time.
 */
const LEGACY = "CONTENTOS_";
const CURRENT = "DOTCONTENT_";

export function adoptLegacyEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY) || value === undefined) continue;
    const next = CURRENT + key.slice(LEGACY.length);
    if ((env[next] ?? "").trim() === "") env[next] = value;
  }
}

adoptLegacyEnv();
