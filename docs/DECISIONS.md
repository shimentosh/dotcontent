# Decisions already made

Each of these was argued out once and cost real time to reach. They are written
down so the next session does not re-derive them, and does not quietly undo one
while doing something else.

## Editing a template is the builder, at its own URL

Edit in the library opens `/builder/<slug>` directly. There was a sheet in
between with a name field, a description, a status and a button that said "Edit
in builder": two ways into one thing, one of which could not touch a prompt,
which is the only reason a template exists.

The status control moved into builder step 1 beside the name and description, so
nothing the sheet offered was lost. It rides on `PackDraft` and goes out with the
rest of the brief on save.

A slug per template is what makes the builder linkable — a tab per template, a
refresh that keeps its place, and a history entry that says which one. The
builder reads the slug from the URL (`BuilderView({ slug })`) rather than only
from the click that opened it, and a slug with nothing behind it says so instead
of opening an empty builder that Save would turn into a second template.

## The Content page shows topics AND what they produced

There were two lists of the same thing: a Topics page and a Content page, with
the same rows grouped the same way from different sources. Topics won its
controls, Content won the page. `components/topics/TopicAdmin.tsx` holds the
topic controls — series strip, the two dialogs — and Content mounts them. There
is no `/topics` route.

Content groups by **template**, because a template decides which sections run
and therefore which outputs exist. Rows carry the five output glyphs, which is
what makes it a list of content rather than a second list of topic names.

## "Template" on screen, `pack` in code

The user-facing noun is Template everywhere — sidebar, headings, buttons, column
headers, filters. The code, the routes (`/packs`, `/pack/<slug>`), the API and
the database still say `pack`. Renaming those would break every link and every
stored row for no user-visible gain.

If you rename copy in bulk, only touch string literals that are sentences or
labels. Keys — a `FilterKey` union member, a state object key, an
`AddSectionTarget` value — are code that happens to be quoted. A regex that
cannot tell them apart will half-rename one and break the build.

## Everything that navigates is a real link

`Hov` takes an `href` and renders an `<a>`, handling the plain left click itself
(client-side push) and stepping aside for ⌘/Ctrl/Shift/Alt and middle clicks.
That is what makes "open in new tab" work at all — before it, every row and nav
item was a `<div onClick>`, which the browser cannot open anywhere.

`ListRow` and `Card` pass `href` through. Add it to anything new that navigates.

## One stacking order

`layer` in `lib/theme.ts`. Menus are above modals because a menu is always
opened by something already on screen. A popover with its own inline `zIndex`
is a bug waiting to happen — the Content sort menu had one, at 45, and rendered
underneath every dialog.

## One `json()` for every client fetch

`lib/api-json.ts`. Four clients each had a copy that turned a 401 into a red
banner reading "Sign in first" — accurate, and a dead end, because nothing on
that page can sign you in. It now sends the browser to `/login?next=…` with a
full page load, deliberately: the shell was rendered for a session that no
longer exists and the router cache still holds payloads fetched under it.

## Section text is markdown

Runs write markdown — headings, pipe tables, fenced blocks. Anything that
displays a section body has to render it; `components/overlays/ReadingText.tsx`
is the small renderer that does (headings, tables, lists, quotes, rules, code,
inline emphasis and links). One source line stays one line: nothing here
hard-wraps prose, so joining lines the way a normal markdown renderer does runs
"NAME:" and "URL:" together.

Bangla sections switch to `font.bangla` at 1.04× size and 1.95 line-height. Its
matras collide with the line above at Latin leading.

## Reading mode is a mode, not a page

`components/overlays/ReadingMode.tsx`, opened by **Read** on any document. Three
grounds — paper, sepia, night — none pure white or pure black, four text sizes,
choice kept in `localStorage`. It takes focus on open so Space and PageDown
scroll it: the scroll container is the overlay, not the window.

## One definition of a duplicate

`lib/dedupe.ts` decides what "the same name" means — case, spacing,
punctuation, accents, a leading article, and `https://`/`www.`/trailing slash,
because half the topics here are websites. Everything that creates a series or
a topic uses it, on both sides:

- **The server is the rule.** `createSeries` and a rename refuse a name the
  workspace already has (409, carrying the shelf that has it), holding an
  advisory lock on the normalized name so two requests cannot both pass the
  check. `addTopics` skips names covered *anywhere in the workspace* and
  returns `{ added, skipped }` naming the shelf each one is already on.
- **The screen is the courtesy.** Both dialogs check as you type: a red note
  and a disabled button for an exact match, an amber note for a near one
  (`nearMatches`, token overlap ≥ 0.6) which never blocks — two names can be
  close and still be two things.
- **The generator is told.** `generateTopics` takes every other shelf's topics,
  so it cannot propose something the workspace has already written.

There is no unique index on the name, because the data violates one: three
shelves already share a name and a migration adding it would fail. Merge them
first, then it can be added.

## Merging is offered, never automatic

`mergeSeries` moves the topics and deletes the empty shelf. For a topic whose
name the target already has: dropped if nothing is written under it, moved
anyway if it has content — deleting work to tidy a list is worse than the mess.
Runs are untouched; `runs.topic_id` outlives the topic and a moved topic keeps
its id. The Series screen marks duplicate rows and offers the merge; which copy
is the real one is the user's call.

## The backend is a NestJS service, and the browser calls it directly

The API moved out of Next's route handlers into `api/`, a NestJS 12 service on
its own port. It was a deliberate choice against the smaller option — Next's
handlers were fine — made so the API is a thing of its own: reachable from
something other than this web app, deployable and scaled on its own, and with
the run driver in a process that exists to be long-lived.

What did NOT move is the point of the layout: `lib/server` — the repos, the
services, the prompt builder, the ingest — is shared. A controller is a thin
translation from HTTP to those functions, ten of them in one module, because
the "providers" already exist. Only one line of the old backend was tied to
Next (`cookies()` in auth.ts), and it is gone.

The browser goes cross-origin, on purpose, rather than through a Next
rewrite: `lib/api-base.ts` names the API (`NEXT_PUBLIC_API_URL`) and every
client call uses `apiFetch`, which sends credentials. CORS on the API allows
exactly `WEB_ORIGIN`. The session cookie is set by the API with
`COOKIE_DOMAIN` so the web origin's proxy can see it too. The cost is a
second hostname and a cookie domain to get right; the gain is that the API
is the API for anything, not a private back door of one Next app.

Auth is closed by default: `SessionGuard` is a global guard, and a route is
open only with `@Public()`. That is the shape the audit asked for — the hole
it found was fifteen handlers that each had to remember one line.

The two processes share one `.data` root (`CONTENTOS_DATA_DIR`), because the
API started from `api/` would otherwise keep its own `./.data` that the web
app has never heard of.

## An upload is streamed to disk and capped, never buffered

`await file.arrayBuffer()` held the whole upload in memory, then `Buffer.from`
made a second copy — a 400MB recording was 800MB of heap in one route, and the
Node process was what fell over, not the request. The upload route now hands
`file.stream()` to the ingest, which pipes it to the source's directory through
a counter that tears the pipeline down past `MAX_UPLOAD_BYTES` (512MB) and
removes the partial file. The declared size is checked first, as a courtesy;
the bytes are checked as they pass, because the header is a claim.

## A screen's data logic lives in a hook beside it, not in the screen

DocumentView and ContentGroupsView were each eighteen hundred lines: fetching,
derived state, and layout in one file, so the subtlest rule on the page — which
copy of a run to render, how facet counts are taken — sat between a tooltip and
a border radius. Two hooks now hold what can be reasoned about without a
screen:

- `lib/use-run-document.ts` — the run, template, topic, document and reel a
  document page is about, resolved from either address (`/runs/<id>` or
  `/content/<topic>`), with the polled copy winning over the store's list.
  `lib/use-run-watch.ts` underneath it is the poll.
- `lib/use-content-list.ts` — every row on Content, the filters, the facet
  counts taken with their own dimension left open, the sort, the writing strip.

The views keep what only a view has: which menu is open, which row is being
edited, rails made of glyphs. `components/tools/FramePicker.tsx` is the same
cut on the researcher: the one part of that screen with real interaction, and
it holds no state of its own so a new video cannot leave a stale selection.

The line is "could a test exercise it without rendering". If yes, it belongs
in the hook, and `tests/` is where its rules go.

## Nothing writes against a workspace the server has not confirmed

`projects` opens on the design's sample workspaces, whose ids are empty, so
that every screen has a name to draw before the first request answers. A run
or an upload in that second went out with `workspaceId: ""` and came back as a
foreign-key error dressed as "something went wrong". `projectsLoaded` on the
store says whether the list is the server's yet; the run sheet, the researcher
and the tools manager refuse to write until it is, and say so.

## Every route that touches data calls `requireUser`

`proxy.ts` checks only that a session cookie is PRESENT — it cannot do more,
because it runs before the database is reachable. Validity is the route's job,
and for fifteen routes it was nobody's: `contentos_session=anything` listed
every run, every template, every workspace, and could start runs that spend
model credit. The comment in `proxy.ts` asserting the opposite is how it
survived a year of reading that file.

So: one `await requireUser()` under the `await ready()` in every handler except
`/api/auth/login|logout|me|signup`, which are what you reach before you have a
session. Adding a route means adding that line — the proxy will not save you,
and nothing in a type or a test will notice.

## One slug rule, in lib/slug.ts

The same three lines lived in five files. Copies of a rule are a tidiness
problem right up until two of them are load-bearing against each other, and two
of these were: `/content/<slug>` finds its topic by comparing `slug(name)` to
the address bar. A stray edit to one copy would not fail a build or a test — it
would 404 one topic, silently, forever.

## Tests cover what a screenshot cannot

`tests/*.test.ts`, run by vitest, and deliberately narrow: no components, no
database. They cover the pure functions the screens stand on — `statusOf` (the
logic that had a dead run reading "Writing" for five days), the template
import/export round trip, `interpolate`, `slug`, and the parse that has to
survive a model wrapping its JSON in prose. `npm run check` is typecheck, lint
and these together.

Do not grow this into component tests. The screens are checked by opening them
(`docs/BROWSER.md`); what these are for is the logic that fails silently, on one
row, days later.

## A template travels as a file, and arrives as a draft

Export writes the whole brief — rules, purpose, every section and its prompt,
the inputs a run asks for, the output groups — wrapped in `{ kind, version,
exportedAt, template }`. The wrapper earns its place at import: a bare pack
object is indistinguishable from any other JSON somebody drops on the screen,
and the kind is what lets the import say "that is not a template" rather than
creating one with no sections in it.

The slug does not travel. It is this console's id for the row, and carrying it
would either collide with a template already here or quietly overwrite one; the
importing side mints its own. Nor does the status: an imported template arrives
as a DRAFT whatever it was at home, because it has not run here yet.

`fromFile` reads every field defensively and drops a `dependsOn` naming a
section that did not travel — otherwise the engine waits forever for something
this template will never produce, and the run ends with the section still
queued and nothing on the page explaining why. The import lands you in the
builder on the new template: an import that finishes silently in a list is one
you then have to go looking for.

## Tools are rows, and a workspace has its own bench

`lib/tools.ts` still holds what each tool IS — a slug, a screen, a service —
because a tool is code and a row that could rename its slug would point at
nothing. Everything else about it is a row in `tools`: what it is called, what
it is filed under, whether it is on, and where it appears. The shipped ones are
seeded by slug, exactly as the packs are, so a tool switched off stays off and a
tool added in a release still arrives.

`scope` is "all" or "chosen". All is the default, because a tool that appears
nowhere until somebody assigns it is a tool nobody finds; ticking a workspace
flips it to chosen and `tool_workspaces` holds the list. `/tools` is one
workspace's bench and filters server-side; `/tools/manage` is every tool and
where it goes.

## Reading frames is Claude on an API key, and nothing else

`write()` grew an `images` field, and only the Anthropic API path can carry it.
A CLI takes its prompt on stdin and has nowhere to put a picture, and the OpenAI
and Gemini paths here would accept the request and answer from the words alone.
That is the one outcome worse than an error: a website "identified" from a
transcript, presented as though the frames had been read. So a request with
images on any other transport is refused with a sentence naming what to change.

There is one way round it, and it is a switch rather than a fallback: the Claude
CLI cannot be handed bytes, but it can be told to open a file. "Let the Claude
CLI open frame files" in Settings, off by default, gives that one call the `Read`
tool along with the paths of the ticked frames. It stays off unless somebody
turns it on because it is file access on the machine, granted to a model that is
about to read text off a stranger's video — a different kind of permission from
the WebFetch and WebSearch the spawn has always had, and not one to hand over
quietly on the app's own initiative.

The researcher works from what the ingest already produced — yt-dlp's download,
ffmpeg's stills, whisper's transcript — and adds two things: an upload, for
footage that was never posted anywhere, and a frame cut at a second somebody
asked for. The eight evenly spaced stills are the right default and the wrong
answer whenever the address bar is between two of them.

## A run that failed says so, and can be retried

`statusOf` derives the row's status from the sections, and it used to ask one
question: are all of them written? Anything short of that read **Writing** — so
a run that died on section three, and a run created and never started, both sat
in the Writing tab looking like work in flight. Days later they were still
there.

There is a **Failed** status now, derived in this order: something writing is
Writing; otherwise a failed section makes it Failed; otherwise nothing written
at all is an Idea again — a run that never got going is not mid-write, and Idea
is the pile it can be started from. Failed joins the tab strip only when
something carries it, like Used and Ignored.

Retry is one press, on the row. It calls the same `startWriting` the document
page does, and `POST /api/runs/[id]/start` clears the run's failures —
`requeueFailed`, which was written for this and had never been called — before
`driveRun` picks the run up. Within one drive a failed section is still
skipped, otherwise the loop spends the model's time forever on the one thing
that does not work; but carrying that skip into the NEXT drive made Retry do
nothing at all on exactly the run you would press it for.

## Run is one press, wherever the topic is

A topic on a shelf carries everything a run is told — the shelf, its brief, the
part number, the topic's own note — so the run sheet, asked to start one, was a
form whose every field was already filled in from the row you clicked. The
answer is `runTopicNow` in the store: it creates the run, sets the server
writing, and reloads. `lib/start-run.ts` assembles what the pack is told, and
the sheet calls it too, so a run started from a row and a run started from the
sheet are told exactly the same things.

The sheet is still where a real question goes. `packForSeries` returns the
shelf's own template, or — when the shelf names none and the library holds
exactly one — that one, because "which template" is only a question when there
is more than one answer. With two and no choice made, `runTopicNow` opens the
sheet on the topic instead of guessing.

On the content list this is one button per row, and it is the same button
throughout the life of a topic: RUN for an idea, CARRY ON for a run that
stopped part-way, RETRY for one that failed, and a dead pulsing square while it
writes so the row's controls do not shuffle sideways as sections land. A
finished topic gets none — rewriting what is written is a decision about one
section, and it belongs beside that section.

The topic's own page runs it in place rather than sending you somewhere: press
Run on a topic with nothing written and the same URL becomes the document, its
sections filling in live. That last part needed `DocumentView` to poll for the
run it is showing rather than only for a run named in the URL — addressed by
name, the page had been reading a store list that reloads on navigation, so a
run started from it sat perfectly still until a refresh.

## Deleting a shelf asks which kind of delete

A series and the ideas standing on it are two different things to lose, so the
confirm offers both: **Keep the topics** moves them to `Misc` (the holding
shelf, found or created by `deleteSeries(id, { keepTopics: true })`) and takes
only the shelf; **Delete topics too** lets the foreign key cascade. An empty
shelf has nothing to decide and gets the plain yes/no.

`Misc` is deliberately unnumbered — it is a holding area, not a series, and
a part number there would claim a position in a sequence that does not exist.
Topics moving in keep the part they already had rather than being renumbered,
so nothing is lost passing through.

`ConfirmRequest.alternative` is the general form of this: a destructive dialog
with a gentler version of itself, sitting between Cancel and the damage.

## A run is driven by the server, not by the tab

`driveRun` in `lib/server/services/runs.ts` writes every remaining section in
dependency order, one at a time, and `POST /api/runs/[id]/start` kicks it off
and answers immediately. The set of runs in flight lives on `globalThis`, so a
dev-server reload cannot start a second loop over the same run — the model is
one local process.

Before this, the loop lived in the browser: Run created twelve queued rows and
stopped, "Write the rest" started a loop in the tab, and a navigation, a hot
reload or a closed window stopped the run mid-way with nothing on the page
saying so. Run now means run. The page polls (`GET` on the same route, plus the
run itself) and only watches — 1.5s while something is moving, 6s when nothing
is.

A failed section is skipped rather than retried: it has had its turn, and
anything depending on it never becomes eligible, so the run ends with those
still queued — which is the truth, and visible.

## The spawned Claude CLI is granted exactly two tools

`viaClaudeCli` passes `--allowedTools WebFetch,WebSearch`. In `-p` mode the CLI
cannot ask for permission, so an ungranted tool is refused and the model writes
the refusal into the section as prose — "COULD NOT READ THE SITE … you haven't
granted it yet" — which reads like the site was down when it was our own spawn
saying no. Reading the web is the entire job of the research sections. Nothing
else is granted: no Bash, no file editing, no writing anywhere on the machine.

`Read` is added for the one call that carries frames, and only then — see
below.

## Frames are read by the CLIs, not by an API key

This console is run off signed-in CLIs, so "buy an API key to look at a still"
was not a trade-off, it was the researcher not working. Every CLI can be shown
a picture; none of them takes bytes, and each takes a file its own way:

- **Claude** — the paths go in the prompt and `Read` is granted for that call,
  with an instruction to open those files and nothing beside them. The one
  route that grants a TOOL, so it is the one behind a switch
  (`cliCanReadFrames`, on by default; off means Claude cannot see frames).
- **ChatGPT** — `codex exec -i <file>` per frame. The picture is attached to
  the first message; nothing is granted and nothing else is reachable. The flag
  is repeated rather than given a list, which would swallow the `-` that says
  the prompt is on stdin.
- **Gemini** — `@<path>` references in the `-p` prompt, which the CLI resolves
  itself, plus `--include-directories` so a path outside the server's own
  directory is still allowed.

Over an API only the Anthropic path sends image blocks; the OpenAI and Gemini
fetches here send text. Ollama is handed a prompt and nothing else. Both are
refused rather than answered from the transcript alone — an answer invented
from the words and presented as though the frames had been read is worse than
an error.

One thing had to change with them: the JSON contract moved into the END of the
user turn, schema and all (`SHAPE` in `researcher.ts`, used in both places). A
CLI is an agent with a persona of its own, and a system prompt appended under a
much longer one lost — asked to read eight stills it wrote a report with
headings, which parsed to nothing and drew "Not identified" over several
minutes of perfectly good reading. Pointing at the schema rather than repeating
it was not enough either: "the JSON described above" got back a JSON rendering
of the CONTEXT. The panel now prints the raw answer when the parse comes back
empty, because the parse is a convenience on top of the answer, not the answer.

## The researcher keeps what it read

The download had always been kept — yt-dlp, ffmpeg and whisper cost real
seconds, so the source row exists so a second look does not pay for them twice.
The *reading* was not: the answer went to the browser and nowhere else, and a
reload threw away several minutes of watching and every idea it produced, with
nothing on screen to say they had ever existed.

`sources.research` (migration `0013_source_research`) holds the last answer for
each video, with its own `researched_at` — separate from `updated_at`, which
moves whenever a frame is cut. One answer per video: researching it again
replaces it, which is what "again" means.

So the tool has a HISTORY panel, which is just that list: every video put
through it, what it found, how many ideas came out, and when. Clicking one
reopens it with its answer and with the frames that answer was read from
already ticked, so "read it again" repeats the same reading rather than
silently widening it. The video you had open is remembered per browser
(`localStorage`, one id) so coming back to the tool puts you back where you
were instead of on an empty form — a cursor, not a fact about the workspace,
which is why it is not in the database.

## The builder is a bench, not a wizard card

`/builder` takes the window: a step rail on the left, the flow in the middle,
and a third column that is the **Steps palette** while you are assembling
(`components/builder/StepPalette.tsx`) and the **template as it stands**
everywhere else (`TemplateSummary.tsx`). The frame does not change between
steps, so nothing jumps as you move through them.

Steps are added by dragging from the palette onto the flow — the connector
between two steps is the drop target, it grows and lights when you drag over
it, and `moveDraftSectionTo` also accepts an existing step dragged by its
handle, so reordering is the same gesture. Clicking a palette entry adds at the
end. The `+` on each connector still opens an inline picker for anyone who
would rather click than drag.

What this replaced: a centred modal. The flow you were building disappeared
behind a dimmed backdrop at the moment you were deciding what should come next
in it, and whatever you picked landed at the end regardless of where you had
been looking.

Each kind of step has one tile — glyph and colour — defined once in
`StepPalette` and worn in the palette, on the canvas, in the summary and on the
template page, so a step looks the same where you pick it up as where you put
it down. A shipped template's sections carry a TIER where a built one carries
a kind, so `PackDetailView` reads the kind off the section name before asking
for the tile; the tier is what its badge shows instead, on a cool-to-warm scale
(CHEAP · STANDARD · HIGH) that says what a run will cost, not what it is worth.

## Writing is a strip, not a filter

The Content page's status switcher offers Idea and Ready (plus any end state a
topic has actually reached). **Writing is not one of them**: a run in flight is
not a shelf you browse, and behind a filter the only way to see what the
machine was doing was to remember to go and look.

It gets a strip at the top of the page instead — pulsing dot, the topic, its
`written/total` — computed off every doc rather than the filtered list, so it
does not empty when you switch to Ready. The segment reappears only while it is
the one selected, so a filter can never be on with no control for it.

## The console is invite-only

Signup is open only while `users` is empty — the first account becomes the
owner. Everyone after that needs an invite: a random token in a link, checked
and spent inside the same call that writes the user, so a link cannot be
redeemed twice by two people racing it. An email on the invite locks it to that
address.

Deliberately not "the owner creates an account with a password": the person who
will use an account should be the only one who ever types its password. And
deliberately not emailed — there is no mail sender in this app, and adding one
to deliver a URL would be a service to run for no gain.

Access is managed in Settings → Team: who is in, and the open links. Removing
someone deletes their sessions with the row; their work stays, because runs and
topics belong to the workspace.

## Migrations are applied, not assumed

`ready()` runs them once per process — enough in production, where a deploy is a
new process, and not enough in development, where the dev server predates the
migration you just wrote. `npm run db:migrate` applies what is pending against
whatever `DATABASE_URL` points at, one transaction each, and the production
compose runs it before the server takes traffic.

## Builds get their own directory

`npm run build:check` → `.next-check`, never the dev server's `.next`. See
`docs/DEVELOPING.md`; this one has bitten a session already.
