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

The URLs still read `/packs` and `/pack/<slug>`; renaming them would break every
link and the API. Only the user-facing word is "Template".

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
| `/integrations`    | `IntegrationsView`                  | Models and local binaries, probed by running them.         |
| `/settings`, `/workspaces` | `SettingsView`, `ProjectsView` |                                                         |
| `/login`, `/signup` | `AuthView`                         | The only routes reachable signed out.                      |

## Where things live

```
app/                 routes; a page.tsx is a thin shell that renders a view
app/api/**/route.ts  the API — auth, packs, runs, series, settings, sources, …
components/views/    one file per screen
components/overlays/ full-window things: sheets, dialogs, command palette, reading mode
components/ui/       the kit — read components/ui/README.md before adding to it
components/topics/   TopicAdmin: the topic controls, mounted inside Content
components/tools/    pieces of a tool's screen with real interaction (FramePicker)
lib/*-client.ts      browser-side fetch wrappers for the API
lib/use-*.ts         a screen's data logic as a hook — what can be reasoned
                     about without rendering (use-content-list, use-run-document,
                     use-run-watch)
lib/store.tsx        client state, navigation (`go`), filters
lib/slug.ts          the one rule for turning a name into part of a URL
lib/theme.ts         tokens: t(), w(), font, spring, panel(), layer
lib/server/          server-only: auth, db, repos, services, prompt building
lib/server/db/       Postgres pool + the schema as an ordered migration list
lib/server/repos/    one module per table
lib/server/services/ the rules between a route and a repo: runs, ingest,
                     researcher, seed
lib/packs/           the shipped template(s), as code
tests/               vitest, pure functions only — `npm run check` runs them
.github/workflows/   the same checks, on every push
```

## How a change reaches the screen

1. A view calls a `lib/*-client.ts` function.
2. That fetches an `app/api/**/route.ts` handler.
3. The handler calls `requireUser()` and then a repo in `lib/server/repos/`.
4. The repo runs SQL through `lib/server/db/client.ts` against Postgres.

Every client fetch reads its response through `json()` in `lib/api-json.ts`,
which turns a 401 into a redirect to `/login?next=…` rather than an error
banner on a dead page.

## Data

Postgres, in the container `docker-compose.yml` describes, on port **5437**.
Tables: `workspaces`, `series`, `topics`, `runs`, `run_sections`, `packs`,
`pack_usage`, `users`, `sessions`, `settings`, `sources`. The schema lives in
`lib/server/db/schema.ts` as an ordered list of migrations that run once per
process.

`lib/server/db.ts` is an older whole-state-on-disk store. Nothing imports it.
Do not wire anything new into it.

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
`/api/runs/[id]/sections/[sectionId]`, against `POST` on the same route which
means "run it again". `run_sections.edited_at` records that a person did it,
the reader shows an EDITED mark, and regenerating clears both.

## Auth

`proxy.ts` — Next 16 renamed the `middleware` convention — gates everything
except `/login`, `/signup` and `/api/auth/*`. It only checks that a session
cookie is **present**, so validity is `requireUser()`'s job, and every route
handler outside `/api/auth/*` calls it. That was a claim rather than a fact
until it was checked: fifteen routes did not, and `contentos_session=anything`
read and wrote the whole workspace. Sessions are rows in Postgres; signup
is open only while `users` is empty (`signupOpen()`), so a second account can
only be made by an existing one.

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
