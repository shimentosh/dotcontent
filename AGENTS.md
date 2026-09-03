<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Read these first

Four short files, written so a session does not have to rediscover the same
things by grepping and clicking. Read the one that matches the job.

- **`docs/ARCHITECTURE.md`** — what lives where, the routes, the data flow, and
  the vocabulary (the UI says "Template" where the code says `pack`).
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
