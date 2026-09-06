# Running and checking this app

## Start it

```bash
./start.sh          # Postgres, the NestJS API on :4000, then Next on :3333
./start.sh prod     # production builds of both, then serve both
npm run api:dev     # just the API (from the root; or `cd api && npm run dev`)
npm run api:smoke   # up, locked to both principals, answering, CORS
npm run worker      # a worker on THIS machine — see below; nothing runs without one
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

## A run needs a worker, and `start.sh` starts one

The API no longer writes sections: `advance()` queues a job and returns, and a
**worker** claims it. With no worker running, pressing Run leaves every section
sitting there — correctly, and the page says which machine it is waiting for —
and nothing is broken except that nobody is listening.

So `start.sh` starts one, and it needs the one thing it cannot work out for
itself: a token. Tokens are minted in **Settings → Machines**, and only their
sha256 is kept, so nothing can look one up afterwards. Put it in `.env`:

```bash
CONTENTOS_WORKER_TOKEN=wrk_…
```

Without it `start.sh` says so in one line and carries on — the console still
comes up, because signing in is where you go to fix it. `WORKER=0 ./start.sh`
skips the worker on purpose, for working on a screen that has no runs in it.

The worker needs no build step — Node runs the TypeScript directly — and it
picks up an edit under `worker/` on restart, not on the next job. To run it
by hand instead, in its own terminal:

```bash
CONTENTOS_API_URL=http://localhost:4000 CONTENTOS_WORKER_TOKEN=<token> npm run worker
```

The **desktop app is not a service and `start.sh` does not start it**. It is
what a teammate installs, and it carries its own worker inside it — running it
here would put two workers on one machine, both claiming. `npm run desktop`
when you want to look at it.

`docs/WORKER.md` is the whole design, including what each job kind carries and
why the worker may not import anything that touches the database.

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

## Whisper, and the other binaries

They belong to the **worker's** machine now, not to the server, and there are
two whispers. `npm run worker:setup` fetches pinned yt-dlp, ffmpeg and
**whisper.cpp** plus a model into `.data/tools`, checks a sha256 on each, and
touches nothing outside that folder — no PATH, no registry, no admin. It is
the only route a teammate who is not a developer has, which is the whole
reason it exists. `docs/WORKER.md` has the sizes and the undo.

whisper.cpp is preferred over `openai-whisper` when both are installed. It is
one executable and a `.bin` rather than Python plus PyTorch and a CUDA story,
it has the GPU path, and it takes 16 kHz mono WAV — which is exactly what the
ingest already uploads, because transcription is its own job over the audio
rather than the video.

Probes resolve `.data/tools/bin` before PATH, so an installed tool is found
whether or not anything was added to the system. Three traps are handled
rather than documented-around, each of which made an installed tool report
itself missing: `pip` puts the `whisper` script somewhere off PATH, so the
probe also tries `python -m whisper`; openai-whisper's `--help` contains a
Japanese character a cp1252 console cannot print, so both the probe and the
run set `PYTHONIOENCODING=utf-8`; and whisper.cpp's CLI was called `main`
before v1.7.4 — the most ordinary name an executable has ever had — so that
attempt only counts if the output also looks like whisper's usage.

A machine with whisper.cpp and no model is **not** a machine that can
transcribe, and says so with the command that fixes it. Reporting it present
would route every transcription job to it and fail all of them.

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
