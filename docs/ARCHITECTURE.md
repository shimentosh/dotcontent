# The map

What this app is made of and where each kind of thing lives. Read this before
grepping the tree — it is here so you do not have to.

## The words

The UI and the code use different words for the same thing in one place, on
purpose. Do not "fix" either side without renaming both.

| On screen  | In code                        | What it is                                                                 |
| ---------- | ------------------------------ | -------------------------------------------------------------------------- |
| Template   | `pack`, `Pack`, `PackDraft`, `/packs` | A production brief: an ordered set of sections that turns a topic into content. |
| Series     | `series`                       | A shelf topics sit on, with a brief that frames them.                       |
| Topic      | `topic`                        | A name. Everything under it — template, content — comes later.              |
| Content    | `ContentDoc`, `run`            | What a template produced for a topic, as one document.                      |
| Section    | `DocSection`, `run_sections`   | One step of a template, and the text it wrote.                              |
| Output     | `OutputKey` (`en`/`bn`/`social`/`seo`/`tags`) | The deliverable several sections roll up into.        |
| Machine    | `worker`, `Worker`, `workers`  | A teammate's computer, enrolled with a token, that claims jobs and runs the CLIs. |

The URLs still read `/packs` and `/pack/<slug>`; renaming them would break every
link and the API. Only the user-facing word is "Template".

"Machine" is the same split for a newer reason: the console's own routes are
`/api/machines` and read as a person managing computers, while `/api/workers`
is the protocol those computers speak. Two paths, two controllers, two
credentials — see Auth.

## Screens

| Route              | View                                | Notes                                                     |
| ------------------ | ----------------------------------- | --------------------------------------------------------- |
| `/`                | `HomeView`                          |                                                            |
| `/content`         | `ContentGroupsView` + `TopicAdmin`  | Topics AND produced content, grouped by template.          |
| `/content/series`  | `ManageSeriesView`                  | The shelves themselves: rename, brief, template, order, delete. Tabbed with `/content` via `TabNav`. A static segment, so it beats `[topic]` — "series" is a reserved topic slug. |
| `/content/[topic]` | `DocumentView`                      | One topic's newest run.                                    |
| `/runs/[id]`       | `DocumentView`                      | One exact run. Same screen as above, on purpose.           |
| `/packs`           | `PacksView`                         | "Templates".                                               |
| `/pack/[slug]`     | `PackDetailView`                    | Its sections.                                              |
| `/builder`         | `BuilderView`                       | Writing a template that does not exist yet. Saving replaces the URL with the one below. |
| `/builder/[slug]`  | `BuilderView`                       | Editing that template. Linkable, bookmarkable, and what Edit opens. |
| `/tools`           | `ToolsView`                         | This workspace's bench, grouped by category.               |
| `/tools/manage`    | `ToolsManageView`                   | Every tool: category, on/off, and which workspaces it stands in. A static segment, so it beats `[tool]`. |
| `/tools/[tool]`    | `ContentResearchView`, `ContentResearcherView` | One tool's screen. The registry knows slugs; `VIEWS` maps each to its screen. |
| `/integrations`    | `IntegrationsView`                  | What can run where. Scoped by two pickers: which machine, and the workspace the console is switched to. Tool rows are **read** off `workers.tools` rather than probed — the API has no CLI on it to probe. A workspace's brain is chosen here. |
| `/settings`        | `SettingsView`                      | Sectioned. **Machines** (`components/settings/MachinesPanel`) is where a machine is enrolled: it mints the worker token, shows it once, and owns the switches a machine is not allowed to set for itself. |
| `/workspaces`      | `ProjectsView`                      |                                                            |
| `/login`, `/signup` | `AuthView`                         | The only routes reachable signed out.                      |

## Where things live

```
app/                 routes; a page.tsx is a thin shell that renders a view
api/                 the backend: a NestJS service on its own port (4000),
                     one controller per feature under api/src, sharing
                     lib/server with the root. There is no app/api any more.
api/src/workers/     the machine protocol — bearer token, never a cookie — plus
                     the reaper, a 15s interval that takes expired leases back
api/src/machines/    the console's half of the same subject: a person, on
                     Settings → Machines, minting tokens and setting switches.
                     Deliberately a different controller from the one above,
                     because they are different principals.
worker/              the sidecar that runs on a teammate's laptop: claims jobs
                     over HTTPS, spawns the CLIs, posts results. Plain `node`,
                     no build step (`npm run worker`); Node strips the types and
                     worker/resolve-ts.mjs closes the resolver's gap.
components/views/    one file per screen
components/overlays/ full-window things: sheets, dialogs, command palette, reading mode
components/ui/       the kit — read components/ui/README.md before adding to it
components/settings/ the panels inside /settings: Machines, Team
components/topics/   TopicAdmin: the topic controls, mounted inside Content
components/tools/    pieces of a tool's screen with real interaction (FramePicker)
components/builder/  the template builder's step palette, picker and summary
lib/api-base.ts      where the API is (NEXT_PUBLIC_API_URL) and apiFetch()
lib/*-client.ts      browser-side fetch wrappers for the API, all via apiFetch
lib/use-*.ts         a screen's data logic as a hook — what can be reasoned
                     about without rendering (use-content-list, use-run-document,
                     use-run-watch)
lib/store.tsx        client state, navigation (`go`), filters
lib/slug.ts          the one rule for turning a name into part of a URL
lib/theme.ts         tokens: t(), w(), font, spring, panel(), layer
lib/server/          shared with api/: auth, db, repos, services, prompt building
lib/server/brain-defs.ts       the table of models and how each is reached.
                     Imports NOTHING, and must not: the worker needs it and a
                     worker with an import of a repo has Postgres on it.
lib/server/brain-transports.ts the four CLI transports, and the only copy of
                     them. Imports only tools.ts, for the same reason.
lib/server/brains.ts everything that needs the database or a paid endpoint:
                     brainStatuses(), write(), and the three API transports,
                     which stay here with the keys and never reach a worker.
lib/server/db/       Postgres pool + the schema as an ordered migration list
lib/server/repos/    one module per table — jobs and workers included
lib/server/services/ the rules between a route and a repo: runs, ingest,
                     researcher, webfetch, seed
lib/packs/           the shipped template(s), as code
tests/               vitest. Pure functions, except queue.test.ts, which builds
                     and drops a Postgres of its own and skips when there is
                     none. `npm run check` runs them.
```

## How a change reaches the screen

There are two paths, and the first thing to know about a feature is which one
it is on. Everything that is only a database write takes the short one.
Anything that has to spawn a binary — writing a section, fetching a reel,
transcribing it, testing a brain — cannot, because the binaries are not on the
server.

**The short path.** Templates, series, topics, settings, the tool bench,
editing a section by hand.

1. A view calls a `lib/*-client.ts` function.
2. That calls `apiFetch()`, which goes cross-origin to the NestJS service at
   `NEXT_PUBLIC_API_URL` with `credentials: "include"`, so the session
   cookie travels.
3. A controller in `api/src/<feature>/` receives it. A global `SessionGuard`
   has already refused anything without a live session; `@Public()` marks
   the handful of sign-in routes that are open.
4. The controller calls a service or repo in `lib/server/`, which runs SQL
   through `lib/server/db/client.ts` against Postgres.

**The long path.** Steps 1–4 happen exactly as above and end by writing a row
in `jobs` rather than doing the work.

5. `advance(runId)` in `lib/server/services/runs.ts` — or `ingest()` in
   `services/ingest.ts` — resolves the pack, gathers the finished upstream
   text, reads the evidence, builds the prompt, picks the model and the
   transport, and `enqueue`s all of that as the job's payload. Then it
   returns. No process holds a run: `advance` is called when Run is pressed
   and again every time a result lands, and it reads the database rather than
   remembering anything.
6. A `worker/` process on somebody's laptop long-polls
   `POST /api/workers/claim` with its bearer token, gets the job, runs it in a
   child process of its own, and posts to `POST /api/workers/jobs/:id/result`
   or `/fail`.
7. `api/src/workers/workers.controller.ts` checks the job still belongs to that
   machine and hands the result to the service that owns the row it writes —
   `sectionResult`, `sectionFailed`, `sourceResult`, `transcriptResult`,
   `sourceFailed`. Those write it and call `advance` again for whatever it
   unblocked. Nothing in that controller writes `run_sections` or `sources`
   itself.
8. Nothing is pushed to the browser. The page polls: `lib/use-run-watch.ts` for
   a run's sections *and* its jobs, `followSource` in `lib/sources-client.ts`
   for a fetch. Both change cadence with what is actually moving, because
   "queued behind a laptop that is shut" is a state measured in hours.

A section's row on screen therefore reads two sources, not one. `run_sections`
says done/writing/failed; the job beside it says which machine holds it,
whether it is waiting on one that is shut, and whether nothing on the estate
can ever run it. `Placement` in `lib/use-run-document.ts` is where the two are
resolved into the one thing a person can act on — an install command, "open
your laptop", or a button.

The rule that decides everything else about the long path: **the server decides
and the worker executes.** A payload carries finished text and a command, never
a pack, a rule, a dependency graph or the brand voice — business logic shipped
to fifteen desktops would need fifteen updates to change a prompt.
`docs/WORKER.md` is the argument for the queue and for its shape: the tables,
the claim query, the leases, and the three different answers to "nothing can
run this". Read it before changing any of them.

Three things stay on the server on purpose. `ingestFile` cuts frames and a WAV
where the bytes already are and enqueues only the transcription. The researcher
(`services/researcher.ts`) calls `write()` on the API's own machine and keys.
And `advance` will write a section itself, through `writeOnServer`, when no
machine can take it **and** `workspaces.api_fallback` is on — off by default,
which is the feature rather than caution.

Every client fetch reads its response through `json()` in `lib/api-json.ts`,
which turns a 401 into a redirect to `/login?next=…` rather than an error
banner on a dead page.

## Data

Postgres, in the container `docker-compose.yml` describes, on port **5437**.
The schema lives in `lib/server/db/schema.ts` as an ordered list of migrations
that run once per process, ending at `0016`.

Tables: `workspaces`, `series`, `topics`, `runs`, `run_sections`, `packs`,
`pack_usage`, `users`, `sessions`, `invites`, `settings`, `sources`, `tools`,
`tool_workspaces`, and — from the worker split — `workers` and `jobs`.

`workers` is one row per enrolled machine: the sha256 of its token and never
the token, what it probed (`tools`), what its owner switched on (`enabled`,
`can_read_frames`, `max_concurrency`, `workspace_ids` where empty means all),
and `last_seen_at`, which is what "live" is derived from. `jobs` is the queue.
`docs/WORKER.md` has both column by column, with the reasoning.

Four columns are easy to miss because no screen is named after them:

- `runs.created_by` — who pressed Run (`0014`).
- `run_sections.wrote_with` — the machine that wrote it, or the literal
  `server:api` when the fallback did. The only answer anywhere to "which
  sections cost money rather than somebody's subscription".
- `workspaces.brain` — which model writes this workspace's content.
- `workspaces.api_fallback` — whether the server may spend its key when no
  machine can take the work.

**`settings` is no longer where the model lives.** It is one row per key for
the whole console, with no scope column, which was right for one person on one
laptop. `0016` moved the three that could never be global — `brain` to
`workspaces.brain` (beside `brand_voice`: which model writes is an editorial
choice about the content), `enabled` to `workers.enabled` and
`cliCanReadFrames` to `workers.can_read_frames` (both facts about one machine
and one filesystem) — and deleted the rows rather than leaving them to rot.
Note `cliCanReadFrames` defaulted **on** and `workers.can_read_frames` defaults
**off**, deliberately, so enrolling a machine cannot inherit a permission
somebody granted on a different one. What is left in `settings` is `quality`,
`autoApprove`, `reduceMotion` and the encrypted API keys.

## What a prompt can say

A template's rules and each section's prompt may contain `{{series}}`,
`{{part_number}}`, `{{website_url}}` and `{{extra_instruction}}`. They are
declared once in `lib/run-inputs.ts`, filled by the run sheet, and substituted
by `interpolate` in `lib/server/prompt.ts`. The builder offers them as
clickable chips (`PlaceholderChips`) rather than documenting them, so nobody
has to retype one.

A key the run supplied as empty resolves to nothing; a key it has never heard
of is left on the page as `{{like_this}}`, because that is a typo and a prompt
silently missing a line reads exactly like a prompt written without it.

`{{part}}`, `{{part_number}}` and `{{part_label}}` come from the topic's
number and the word its series counts in — Part, Episode, Day, or nothing at
all for a bare count. `partName()` in `lib/topics.ts` is the only place that
joins the two; no screen builds "Part 07" out of a literal and a `padStart`.
A template that declares the number required refuses to run against a topic
without one, and says which switch to turn on.

## Where a brief comes from

A series' brief is typed, or read off the web. `briefFrom` on the series says
which tab is in use — `typed` / `link` / `feed` — and `source` (JSONB) holds
what the last fetch returned. The typed text is never overwritten by a fetch,
so switching back gives you your own words.

`lib/server/services/webfetch.ts` does the reading: it detects RSS/Atom vs
HTML, and reduces either to headlines plus readable text. No parser library,
and public hosts only — the server makes the request, so localhost and private
IPs are refused rather than proxied.

`themesOf()` reads whichever is in use, so generating ideas and
`{{series_context}}` work on fetched material without knowing it was fetched.
Note it splits a typed brief on commas and a fetched one on newlines only: a
headline containing "$1,000,000" is one theme, not three.

## Editing what was written

A finished section can be edited by hand — `PATCH` on
`/api/runs/:id/sections/:sectionId`, against `POST` on the same route, which
means "write it again" and now enqueues rather than writing. `editSection` is
its own function precisely because nothing is generated and nothing is charged,
so the dependency checks that guard a real write would be meaningless.
`run_sections.edited_at` records that a person did it, the reader shows an
EDITED mark, and regenerating clears both.

## Auth

`proxy.ts` — Next 16 renamed the `middleware` convention — gates every page
except `/login` and `/signup`. It only checks that a session cookie is
**present**. Validity is the API's job: `api/src/common/session.guard.ts` is
registered as a global guard, so every controller route is closed unless it
carries `@Public()`. The Next handlers used to have to remember a
`requireUser()` line each, and fifteen did not; a default that fails closed
cannot be forgotten.

The cookie is set by the API on its own origin. For the proxy on the web
origin to see it, both hosts share `COOKIE_DOMAIN` — see api/src/common/cookie.ts. Sessions are rows in Postgres; signup
is open only while `users` is empty (`signupOpen()`), so every account after
the first is made with an invite an existing user issued.

### The second principal: a machine

A `worker/` process is not a person and does not carry the cookie. It sends
`Authorization: Bearer <token>` and is let in by `WorkerGuard`
(`api/src/common/worker.guard.ts`), which hashes the token, finds the row, puts
the machine on the request and touches `last_seen_at`. `@WorkerRoute()` is the
third decorator beside `@Public()`: it hangs `WorkerGuard` on the handler *and*
marks the route public so the global `SessionGuard` stands aside. It is written
as one decorator rather than the pair because `@Public()` applied without the
guard is an open route.

Only `api/src/workers/` carries it — register, claim, heartbeat, result, fail,
and the frame and audio transfers, and nothing else. There is deliberately no
handler on that controller that reads a run, a pack or a template, so a stolen
worker token buys the queue and not the content library. The download route for
frames is a *second* door beside the browser's one in `sources.controller.ts`
rather than the same route widened, for exactly that reason.

Two credentials rather than one, on purpose, and it is worth knowing why before
anybody tries to merge them: a cookie is a browser mechanism the worker would
have to scrape out of a webview; sessions are deleted by Settings → Team, which
is the wrong lever for a machine (`workers.user_id ON DELETE CASCADE` is the
right one); a session can read the whole console while a machine needs a
handful of endpoints; and a headless process cannot be sent to `/login?next=…`,
which is what `lib/api-json.ts` does with every 401. The full argument is in
`docs/WORKER.md`, "The desktop app holds two credentials, on purpose". The
token is minted in Settings → Machines, shown exactly once, and stored only as
a sha256; revoking it is deleting the row.

## Stacking

`layer` in `lib/theme.ts` is the single stacking order: chrome 30, sheet 60,
modal 70, confirm 80, reading 90, menu 120. Menus sit above everything because
a menu is always opened by something else. Never write a bare `zIndex` on an
overlay or a popover — take it from `layer`.

## Conventions that are already settled

- Compose screens from `components/ui`; never hand-roll a select, pill, tab row
  or list table. `components/ui/README.md` is the index.
- Styling is inline objects using `lib/theme.ts` tokens. `Hov` supplies hover
  and press states, and takes an `href` to render a real link.
- Every icon-only control takes a `label`, which becomes tooltip and a11y name.
- Anything that navigates should pass `href` as well as `onClick`, so
  ⌘/Ctrl-click and middle-click open a new tab.
- `worker/` runs on somebody else's laptop. From `lib/server` it may import
  `tools.ts`, `brain-defs.ts` and `brain-transports.ts`, and nothing else: an
  import that reaches a repo puts `pg` on a teammate's desktop and brings back
  the hand-copied brain table that split those files apart in the first place.
  Use relative paths there, not `@/` — the sidecar resolves through
  `worker/resolve-ts.mjs`, which knows nothing about tsconfig `paths`.
