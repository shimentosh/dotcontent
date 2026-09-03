# Running and checking this app

## Start it

```bash
./start.sh          # Postgres, the NestJS API on :4000, then Next on :3333
./start.sh prod     # production builds of both, then serve both
npm run api:dev     # just the API (from the root; or `cd api && npm run dev`)
npm run db:up       # just the database (docker compose, port 5437)
npm run db:shell    # psql, inside the container
```

The backend is a separate process: `api/` is a NestJS service, and the browser
calls it directly at `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).
Both have to be running for any screen to have data. The API shares
`lib/server` with the root — a repo or service edited there is picked up by
the API's ts-node on the next request, no restart needed.

`npm run dev` is plain `next dev` on port 3000 — the app is normally on **3333**
because `start.sh` puts it there. Assume 3333 unless told otherwise.

## Check it

```bash
npm run check           # typecheck, eslint, the tests, then the API's typecheck
npm run test            # vitest, on its own
npm run test:watch      # while you are in one of them
npm run build:check     # a production build that does NOT touch the dev server
```

Run `npm run check` after any edit. It is seconds, and it catches the class of
mistake a screenshot never will — a renamed identifier, a filter key that no
longer matches its type, a status that stops being derived the way the list
expects.

The tests are `tests/*.test.ts` and deliberately narrow: no components, no
database. They cover the pure functions everything stands on — what status a
row shows, what slug a URL resolves by, what an imported template turns into,
what the researcher makes of a model's answer. Those are the ones that fail
silently on one row, days later. Add to them when you touch that kind of
logic; do not try to test the screens here.

## Never `next build` while the dev server is up

`next build` and `next dev` both write `.next`, so building rewrites the chunks
the running server is handing out: every open tab silently stops hot-reloading
and only recovers on a manual refresh. `npm run build:check` exists for this —
it builds into `.next-check` via `NEXT_DIST_DIR`, which `next.config.ts` reads.

## A new migration needs applying

Migrations run once per process, on the first request. The dev server has
usually been running since before you wrote one, so a new migration silently
does not exist — the table is missing and the route 500s. `npm run db:migrate`
applies what is pending without restarting anything.

`npm run db:dump <file>` and `npm run db:restore <file>` move the whole
workspace between machines; both work whether Postgres is in the container or
somewhere online.

## Whisper

`./start.sh` installs it when it is missing — it is the one tool that is a
Python package rather than a binary, and the one thing between a source video
and a transcript. `SKIP_WHISPER=1 ./start.sh` leaves it alone; the first
install is around a gigabyte because of torch.

Two Windows traps are handled rather than documented-around: `pip` puts the
`whisper` script somewhere not on PATH, so the probe also tries
`python -m whisper` and records whichever answered; and its `--help` contains a
Japanese character that a cp1252 console cannot print, so the probe and the
transcript run both set `PYTHONIOENCODING=utf-8`. Without those two, an
installed whisper reported itself as missing.

## Hot reload

Fast Refresh works; if a page looks stale, one of these is why:

- The tab was open across a dev-server restart, or across a `next build` into
  `.next`. It is disconnected until reloaded. The tell: no `[Fast Refresh]`
  lines in the browser console when you save.
- A module-level crash left the error overlay up. It does not recover on its own.
- You changed **seeded state**. Fast Refresh deliberately preserves component
  state, so anything read once into `useState` does not change until a reload.
  This is React behaving correctly, not a bug to chase.

## Other sessions may be editing the same files

More than one agent works in this repo at a time. If `tsc` reports an error in a
file you did not touch — a property that vanished from a type, a half-finished
rename — check whether it is someone's in-flight refactor before "fixing" it.
Re-running `tsc` a few seconds later often shows it resolved itself. Do not
revert another session's work to make your own check pass; finish yours, and say
which errors were not yours.

If a file changes under you mid-edit, take what is on disk as current.

## The shell

Windows. The Bash tool is Git Bash (POSIX), the PowerShell tool is PowerShell —
each needs its own syntax, and Git Bash rewrites arguments that look like
absolute paths (a bare `/content` becomes `C:/Program Files/Git/content`).

For file edits, prefer the Edit/Write tools. For scripted multi-file edits, a
short Python heredoc is reliable; be careful with regex-driven renames, which
can reach identifiers as easily as copy — always typecheck afterwards.
