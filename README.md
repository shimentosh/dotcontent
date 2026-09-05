# Content OS

A Next.js implementation of the `meshclip.dc.html` design canvas — a content
production dashboard where **topics** feed **packs**, packs run to produce
**sections**, and every section leaves an **artifact** behind.

```bash
npm run db:up         # Postgres in Docker, on 5437
./start.sh            # the NestJS API on :4000 and the Next dev server on :3333
./start.sh prod       # production builds of both, then serve both
PORT=3400 ./start.sh  # any other web port (API_PORT for the API's)
```

`./start.sh` brings the database up itself and says so if it cannot — every
screen reads through Postgres, and without it the app serves a blank shell.
`npm run db:up` does the same on its own and waits for the container to report
healthy.

If Docker was not running when the app started, start it and reload: the app
notices and recovers without a restart, and until it does every screen says
which of the two is missing rather than failing silently. `npm run db:down` stops it; the data lives in a named volume and
survives that. `npm run db:shell` opens `psql` inside the container.

The first visit lands on **/signup**, which claims the console. After that
signup closes and everything is behind **/login**.

Or use the npm scripts directly (`npm run dev`, `npm run build`, `npm start`),
which default to port 3000.

## Stack

**Frontend:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript.
**Backend:** NestJS 12 in `api/`, its own process on port 4000, sharing
`lib/server` (the repos, the run driver, the ingest) with the root. The
browser calls it directly at `NEXT_PUBLIC_API_URL`; there is no `app/api`. No CSS framework:
the design is expressed in inline styles, matching the source canvas one
declaration at a time, with shared fragments in [lib/theme.ts](lib/theme.ts).
Fonts are self-hosted through `next/font` (Inter, Inter Tight, JetBrains Mono,
and Noto Sans Bengali for the Bangla script screens).

## Routes

| Path | Screen |
| --- | --- |
| `/` | Home — the current workspace, what is half-written, what needs you |
| `/workspaces` | Every brand, its voice, languages and goal |
| `/content` | Every topic and everything produced, grouped by pack |
| `/content/[topic]` | One document |
| `/packs` | Pack library — the shipped pack and anything written here |
| `/pack/[slug]` | One pack: its real sections, its rules, what it asks for |
| `/builder` | Writing a new template — saving moves it to its own URL |
| `/builder/[slug]` | Editing that template |
| `/runs/[id]` | A run as it happens, section by section |
| `/login`, `/signup` | Sign in; claim the console (open only while it has no owner) |
| `/integrations` | What this machine can actually reach, probed live |
| `/tools` | This workspace's bench, grouped by category |
| `/tools/manage` | Every tool: category, on/off, which workspaces it stands in |
| `/tools/[tool]` | One tool — Content Research, or the video researcher |
| `/settings` | Preferences, keys, team and the account |

Three overlays render above any route: the **Run Pack** sheet, the **Add
Section** sheet, and the **command palette** (`⌘K` / `Ctrl+K`, `Esc` to close).

## Layout

```
app/                 one page per route; pages are server components
components/
  AppShell.tsx       background layers, sidebar, header, overlays
  Sidebar.tsx        workspace switcher, nav, credits card
  ProjectSwitcher.tsx  the workspace menu at the top of the sidebar
  Header.tsx         search + create menu
  views/             one component per screen
  overlays/          run-setup, add-section, command palette
  ui/                Hov (hover/press styles), Popover, Icons
  tools/             the interactive pieces of a tool's screen (FramePicker)
lib/
  data.ts            what is left of the design's strings and numbers
  store.tsx          client state, hydrated from the API and written back
  use-*.ts           a screen's data logic as a hook (content list, run document)
  slug.ts            the one rule for turning a name into part of a URL
  packs-client.ts    the pack API, and the brief <-> runtime translation
  packs-transfer.ts  a template as a file: export, import, validation
  runs-client.ts     the run API
  tools-client.ts    the tool bench, uploads, and the researcher
  theme.ts           fonts, colors, repeated style fragments
  config.ts          advancedNav / runSpeed, the canvas's two props
  server/            everything that touches the database (see below)
tests/               vitest, pure functions only — `npm run check`
design/              the imported source canvas, for reference
```

## The backend

Postgres, in a container `docker-compose.yml` describes. Everything a person
creates is a row: workspaces, the series under them, the topics on those, the
packs written in the builder, and every run with its sections. Nothing that
matters lives in React state any more.

```
docker-compose.yml            Postgres 17 on 5437, one named volume
proxy.ts                      the front door: pages need a session cookie
api/src/main.ts               the NestJS service: CORS, cookies, migrate + seed
api/src/common/               SessionGuard (global, closed by default), errors
api/src/<feature>/            one controller per feature, over lib/server
lib/server/db/schema.ts       the schema, as an ordered list of migrations
lib/server/db/client.ts       the pool, `q` / `one` / `tx`, and `ready()`
lib/server/auth.ts            scrypt passwords, session rows, `requireUser`
lib/server/tools.ts           what is installed, by running it
lib/server/brains.ts          the four models, each over a CLI or an API
lib/server/repos/             rows in, objects out — workspaces, series, packs,
                              runs, sources, settings
lib/server/services/          the rules that are not the database's job:
                              runs, the yt-dlp / ffmpeg / whisper ingest, the
                              researcher that reads frames
lib/packs/enbn-website.ts     the shipped pack: rules, 12 sections, instructions
lib/server/prompt.ts          system = voice + rules, user = source + inputs + deps
```

### Signing in

One owner, made by the first signup, after which the console closes to new
accounts. This is one operator's own tool: every workspace, pack and run in the
database belongs to whoever is at the keyboard, so a second account would
either see all of it (which is not a second account) or none of it (which is
not this app).

Passwords are scrypt, salted per user, compared in constant time. A session is
a row plus an httpOnly cookie rather than a JWT — the whole point of a session
you can end is that deleting the row logs someone out, and a token that
verifies itself cannot be taken away. Changing your password drops every other
session. Middleware checks only that the cookie is *present*, because it runs
before the database is reachable; every route calls `requireUser` itself.

### The model

```
Workspace ──< Series ──< Topic
    │                      │
    └──────< Run >─────────┘   (a run may have no topic; a topic may have many runs)
              │
              ├──< RunSection    queued → writing → done | failed
              │
              └──> Source        a reel: metadata, stills, transcript
```

A series owns its part numbering, and can switch it off. Some shelves are a run
where "part 7" is half the title; others are a pile of ideas with no order, and
numbering one of those promises a part 6 nobody wrote. The switch is on the New
series dialog and on the Brief.

`next_part` is a column claimed under a row lock, so two people adding topics at
once cannot both take part 7 — and **it only ever goes forward**, enforced by a
trigger rather than trusted to the code that writes it. Delete part 6 and the
next thing you write is part 7: the gap is honest, it says something was there.
Switching numbering off leaves the counter where it is, so turning it back on
carries on rather than reissuing a number that has already been used.

Deleting a topic does not delete what it produced — `runs.topic_id` nulls rather
than cascades, because the content outlives the idea that started it.

### What this machine can do

Nothing on the Integrations page is a setting someone left on — every row is
the result of running the thing.

- **Models.** Claude, ChatGPT and Gemini each reach their own headless CLI
  (`claude -p`, `codex exec`, `gemini -p`), already signed in under this
  machine's login, or their HTTP API when a key is stored. Ollama is a request
  to `localhost:11434`. Whichever is chosen writes every section.

  A CLI is told which model to use only when there is a reason to: codex
  rejects a model string its build does not know, and those names move between
  releases, so it is left to pick what the signed-in account can reach. The
  Integrations row shows which model will actually be asked for.
- **Local tools.** `yt-dlp`, `ffmpeg`, `ffprobe`, `whisper` — probed with
  `--version`, reported with the version they gave, and shown with the one
  command that installs them when they are missing.
- **Test.** A version number proves a command exists and nothing more: a CLI
  can be installed, on PATH, even logged in, and still fail because it is a
  release behind or has no auth method configured. Test sends a one-line prompt
  and reports what came back, including the tool's own error and the command
  that fixes it.

Probes are cached for a minute; **Check again** skips the cache.

### Source video

A pack's first two sections are written for someone who has watched the reel —
they ask for on-screen text, a browser address bar, a domain spoken aloud.
Paste a link into the run sheet and yt-dlp fetches it, ffmpeg cuts eight evenly
spaced stills, and Whisper transcribes the audio. All three go into the run's
prompt above the inputs.

Each step degrades rather than fails: no Whisper means no transcript, and a
platform that refuses the media still yields the title, uploader, duration and
caption. The download is tried three ways — one progressive file, then separate
streams, then again with the cookies from a signed-in browser — and what is
stored on failure is yt-dlp's own reason, not "could not download".

### Settings and keys

Preferences are rows, written as you change them, and each one does what it
says: **quality** sets what a new run starts on, **reduce motion** stamps the
document so the aurora stops drifting, **approve automatically** decides
whether a run carries on by itself or waits with a *Write next* button, and the
**tool switches** are checked before yt-dlp, ffmpeg or Whisper is allowed to
run. Anything that could not be made to mean something was removed rather than
left as a control that remembers your answer and ignores it.

Languages are per workspace, not global: two brands in this database publish in
different ones.

Service and model API keys are encrypted with AES-256-GCM before they are
stored and only ever come back masked; set `CONTENTOS_SECRET` in `.env` to
control the encryption key. They used to live in a `Map` in the browser, which
meant the server — the only thing that could ever spend one — never saw a key.

### Packs

Every pack is a row. The shipped one — ENBN Website Content, ported verbatim
from the working system: twelve sections, their dependency arrows and their
original instructions — is **seeded into the table on first run**, so from then
on it is an ordinary pack: rename it, rewrite a section, delete it. Packs
written in the builder are the same kind of thing and run through the same
engine. Every save bumps the version.

What a seeded pack has extra is **Restore**, which puts it back exactly as it
ships — brief included. That is what makes editing a tuned twelve-section
prompt a reasonable offer rather than a trap.

Every section's system prompt is three layers, in this order:

```
the workspace's brand voice   who is watching, and how they are spoken to
the pack's purpose            what this pack is trying to achieve
the pack's rules              how it writes
```

A pack has no audience of its own. Who is watching is the same for every pack a
workspace runs, and the workspace already carries it — two places to write down
one fact is one place to write it down wrong, and the pack's copy is the stale
one the moment a second brand runs the same pack.

The purpose sits above the rules because it is the reason they exist: a rule
read without knowing what it is for gets followed literally. Keep it short — it
rides on every section, so anything repeating the rules is paid for once per
section and settles nothing.

The builder is **three steps**: the pack, its sections, and that optional brief.
It was eight, four of which were one textarea each and two of which were a
preview and a Save button.

Which slugs have been introduced is recorded, not inferred from the table being
empty: a pack you delete stays deleted, and a pack added in a future release
still arrives. A run resolves the **row**, so editing a pack changes what it
writes next; the code definition is only the fallback for a slug whose row is
gone, so an old run can still be rewritten.

### Running one

**No API key needed.** The brain shells out to the `claude` CLI already signed
in on a machine, billed to that subscription rather than per token. Which model
writes is a property of the **workspace**, not of the console.

Pressing Run does not write anything itself. `advance()` looks at the template's
dependency waves, and for every section whose inputs are written it queues a
**job**; a worker — a process on somebody's own computer, with the CLIs and the
GPU on it — claims the job, writes the section, and posts it back, at which
point `advance()` runs again. So a run survives the tab closing, the API
restarting, and the machine that started it going to sleep: another one picks
it up. `docs/WORKER.md` is the whole design.

A failure still costs one section rather than the run, and rewriting one is
still a single request. The server checks the dependencies rather than trusting
the caller — asking for the Bangla script first would otherwise hand the model
an empty "already generated" block, and it would invent the English script it
was meant to be translating.

`ANTHROPIC_API_KEY` still works and is **off by default**. A workspace can turn
on API fallback, which lets the server write a section when no machine is
awake; it is opt-in because a fallback that fired by itself would spend money
at the moment nobody was watching.

### First run

The first request to an empty database seeds the sample workspaces, and imports
anything under `.data/runs/*.json` — real generated content from before the
move to a database. The check is "are there any workspaces", not a flag, so
deleting your last one does not bring the samples back on the next reload.

### Reading what was written

One page reads content, whichever way you arrive at it.
`/content/[topic]` names a topic and shows its newest run; `/runs/[id]` names
one run exactly. Both render the same reader: sections grouped into the
deliverables the template declares, a rail of topics beside them and a rail of
sections after, a rewrite and a copy on each one, Download for the lot.

While a run still has sections to write, the header offers **Write next** and
**Write the rest** (or **Pause** while it is going), and the rows fill in as
they land — the preference on Settings decides whether it starts by itself.
Once it is finished the header is **Redo all** again.

These were two screens: this one, and a flat list of twelve rows for the same
twelve sections. Watching a run happen and reading it afterwards turned out to
be one page at two moments, and keeping them apart meant the better layout was
the one you could not watch.

A topic **nobody has written for yet** gets the same shell rather than an
apology: the rail, the sections its template will write, and the button that
writes them — which opens the run sheet already pointed at that topic. It used
to be a centred box saying "nothing written" with a link back to the list,
which is a dead end at the exact moment you had arrived wanting to do
something.

### Nothing is invented

There is no sample data left in the app. What was removed:

- **`/artifact`, `/voice`, `/run`, `/section/[n]`** — four screens that only
  linked to each other, none of which touched the database. `/run` animated a
  fixed list on a timer and called it a pack run.
- **The twenty-four sample documents** — fifteen invented sections each, under
  a template that does not exist. They filled the Content list so completely
  that you could not see what had actually been written.
- **`SEED_PACKS`** — a library of nine templates built from constants, most of
  them with blank prompts.
- **The activity feed** — four fixed lines about work nobody did, behind a bell
  with a live blue dot on it. It reports finished sections now.
- **The command palette's template actions** — run a template that does not
  exist, regenerate a section on a deleted page, generate a voice from nothing.
- **`lib/server/db.ts`** — the pre-Postgres JSON store, orphaned since the
  migration.

What is left in [lib/data.ts](lib/data.ts) is seed data for an empty database
(the sample workspaces and shelves, written once on first run and yours to
delete) and genuine constants: status palettes, language names, section-type
groups. [lib/content-docs.ts](lib/content-docs.ts) is now the document *shape*
and its helpers, with no documents in it — a run becomes one through
[lib/run-doc.ts](lib/run-doc.ts).
