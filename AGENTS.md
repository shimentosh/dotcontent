<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Read these first

Written so a session does not have to rediscover the same things by grepping
and clicking. Read the one that matches the job.

- **`docs/ARCHITECTURE.md`** — what lives where, the routes, the two data flows,
  and the vocabulary (the UI says "Template" where the code says `pack`, and
  "Machine" where it says `worker`).
- **`docs/WORKER.md`** — why writing a section and fetching a reel became jobs
  on a queue that teammates' laptops claim: the `workers` and `jobs` tables, the
  claim query, the leases, and what a machine's bearer token may reach. Read it
  before touching `worker/`, `api/src/workers/`, `lib/server/repos/jobs.ts` or
  `advance()` in `lib/server/services/runs.ts`.
- **`docs/DEVELOPING.md`** — how to start it (port 3333), what to run to check
  work, why `next build` must not touch the dev server, and what to do when
  another session is editing the same files.
- **`docs/BROWSER.md`** — `node scripts/browse.mjs shot content` to see a screen.
  It signs itself in. Do not write another browser driver.
- **`docs/DECISIONS.md`** — calls already made and the reasoning behind them, so
  they are neither re-argued nor quietly undone.
- **`docs/DEPLOYING.md`** — putting it on a server for a team: what changes when
  the model is an API key rather than the local CLI, how invites work, and how
  the workspace moves.

# Building screens in this app

Compose from the UI kit in `components/ui` — `Page`, `PageHeader`, `Toolbar`,
`Button`, `IconButton`, `Select`, `Segmented`, `SearchInput`, `Field`,
`Modal`, `Card`, `Chip`, and the `ListPanel` family. Import from the barrel:
`import { Button, Select } from "@/components/ui"`.

- **Never** write a native `<select>`, a hand-rolled button, status pill, tab
  row, modal backdrop or list table. They exist; use them.
- A new page is `Page` → `PageHeader` → `Toolbar` → `ListPanel` or `CardGrid`.
- Styling is inline objects with tokens from `lib/theme.ts` (`t()`, `w()`,
  `font`, `spring`, `panel()`); `Hov` supplies hover and press states.
- Needed twice? It belongs in `components/ui`, exported from `index.ts` and
  listed in `components/ui/README.md` — read that file before adding anything.
- Every icon-only control takes a `label`, which becomes its tooltip and its
  accessible name.

# Code that runs on somebody else's machine

`worker/` is a sidecar on a teammate's laptop. It claims jobs over HTTPS, spawns
the CLIs, and posts the results back. It has no database and must never look
like it wants one.

- From `lib/server` it may import `tools.ts`, `brain-defs.ts` and
  `brain-transports.ts`, and **nothing else**. Everything else there reaches a
  repo, and an import of a repo puts `pg` on somebody's desktop. That is how the
  worker ended up carrying a hand-copied brain table once already — and the copy
  drifted, on the half of the system that does the work.
- Use relative specifiers in anything the worker imports, not `@/`. It runs
  under Node's own type stripping through `worker/resolve-ts.mjs`, which knows
  nothing about tsconfig `paths`: an `@/` import typechecks, passes review, and
  is a module-not-found the first time somebody starts the sidecar.
- The server decides and the worker executes. A payload carries finished text
  and a command — never a pack, a rule, a dependency graph or the brand voice —
  and a worker that cannot honour what it was told fails the job rather than
  quietly answering some other way.
- `npm run worker` starts it; there is no build step. `docs/WORKER.md` lists the
  environment it takes and why two of the variables have no default.
