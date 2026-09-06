# The worker

Built. This was written as a design to be argued with before anybody wrote it,
and it is kept as one — the reasoning is the point, and every section still
says why a thing is the shape it is rather than only what shape it has.

Three things in it did not survive contact with the code, and are corrected in
place: `bool_and` over zero rows is NULL rather than true, so the claim query
needed a `COALESCE` or a job needing no tools would have been invisible to
every machine; the reaper's passes had to be ordered, because failing
everything at `attempts >= max_attempts` in one pass ends a job a machine is
still running; and the payload sweep needed `swept_at`, or it rewrote every
historical row on every tick. `tests/queue.test.ts` covers all three.

Where the tree and this file disagree, the tree is right and this is a bug.

## What moves, and why

Today one process does everything. The NestJS API holds `driveRun`, and
`driveRun` calls `write()`, and `write()` spawns `claude` on the same machine
through `run()` in `lib/server/tools.ts` — as does the ingest, with `yt-dlp`,
`ffmpeg` and `whisper`. So the machine that answers HTTP must also have every
binary installed and a signed-in CLI on it. On a laptop that is exactly right.
On the VPS `docs/DEPLOYING.md` describes, it is why the model has to become an
API key, at real money per run, on a box with no GPU.

The split: the **server** keeps the UI, the API, Postgres, and the frames and
transcripts — and keeps every decision. The **desktop app** (Tauri, one per
teammate's Windows machine) is a webview onto the hosted UI plus a Node
sidecar, the **worker**, which claims jobs over HTTPS and runs the local tools
under that person's own login and their own GPU. The worker opens outbound
connections only: no inbound port, no static IP, no hole in anyone's router.

**The server builds the prompt and decides the order; the worker only
executes.** A job carries finished text and a command to run, never a pack, a
template, a rule or a dependency graph. That line is the whole point: business
logic that shipped to fifteen desktops would need fifteen updates to change a
prompt, and the prompt changes weekly. It also keeps `lib/server/prompt.ts`,
`lib/packs/` and the brand voice off machines that only need to run a binary.

## What this does to the run driver

`driveRun` is a loop that holds a process for the length of a run: pick the
next eligible section, `await writeSection`, repeat. `writeSection` blocks on
the model. That shape only works when the model is a child process of the
thing looping.

It inverts. `driveRun` becomes **`advance(runId)`** — a short function that
looks at the run, finds every section whose dependencies are written, enqueues
a job for each that has none, and returns. It is called when Run is pressed and
again every time a job result lands. No process holds a run any more, so
nothing is lost when one restarts.

Two consequences worth naming now:

- `plan()` in `lib/server/prompt.ts` computes the dependency waves and has
  never been called by anything. It becomes the real scheduler: everything in a
  wave can be enqueued at once. Today's one-at-a-time was a property of the
  model being one local process, not of the templates.
- Parallelism comes from **more workers**, not from a worker doing more. One
  worker is one machine with one CLI login, so `workers.max_concurrency`
  defaults to 1 (2 for a machine whose owner says so). Twelve sections across
  four laptops is the win; twelve `claude` processes on one laptop is not.

## The tables

Style follows `lib/server/db/schema.ts` — an appended migration, text ids from
`id()`, `TIMESTAMPTZ ... DEFAULT now()`, jsonb where a join table would be
three files of plumbing for something nothing queries by.

```sql
  {
    name: "0015_workers",
    sql: `
CREATE TABLE workers (
  id           TEXT PRIMARY KEY,
  -- Whose machine. Removing a person removes their sessions today; their
  -- workers go the same way, because the CLI on that box is signed in as
  -- them and the jobs it claims spend their subscription.
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the person calls it. "Shakhawat's desktop", not a hostname —
  -- the machine picker is read by a human choosing where a run happens.
  name         TEXT NOT NULL,
  -- sha256 of the enrolment token. The token itself is shown once, in the
  -- desktop app, and is never in this table: a database dump must not be
  -- a list of live credentials, the same reason API keys are encrypted.
  token_hash   TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL DEFAULT '',
  version      TEXT NOT NULL DEFAULT '',
  -- What it can run: the ToolStatus array lib/server/tools.ts already
  -- produces, whole. Probing is now the worker's job and this is the
  -- report — the server has no machine to probe.
  tools        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The subset of those the owner has switched on. settings.enabled is a
  -- global singleton today and cannot be: "ffmpeg is off" is a fact about
  -- one machine.
  enabled      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Which workspaces this machine may serve. EMPTY MEANS ALL, and today
  -- it is empty on every row: there are no roles in this console, and
  -- inventing one here would be one team's answer imposed through a
  -- schema. The column exists anyway because the day a client's
  -- unreleased footage must not reach a contractor's laptop, the answer
  -- has to be one UPDATE and one AND in the claim query — not a
  -- migration, a backfill and a rewrite of the most important query in
  -- the system, under time pressure.
  workspace_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Whether this machine's Claude CLI may be granted Read for frames.
  -- The switch belongs to whoever owns the machine, not to the console.
  -- Note the global it replaces defaults ON and this defaults OFF:
  -- enrolling a machine must not silently carry over file access somebody
  -- granted on a different one.
  can_read_frames BOOLEAN NOT NULL DEFAULT false,
  -- One machine is one CLI login, so one job at a time. Parallelism is
  -- meant to come from more laptops; twelve claude processes on one
  -- laptop is not the win, twelve sections across four laptops is.
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workers_user ON workers(user_id);
CREATE INDEX workers_live ON workers(last_seen_at);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  -- write_section | ingest_source | transcribe_audio | test_brain.
  -- transcribe_audio is its own kind because whisper is the one step that
  -- wants a GPU and the one dependency the server should not carry: an
  -- upload's frames are cut where the bytes already are, and only the
  -- 16 kHz WAV — a megabyte a minute, not four hundred — goes out.
  kind         TEXT NOT NULL,
  -- queued -> claimed -> done | failed | unroutable | cancelled
  state        TEXT NOT NULL DEFAULT 'queued',
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  -- What this job is FOR, so a result can be written back without the
  -- payload having to be re-read.
  run_id       TEXT REFERENCES runs(id) ON DELETE CASCADE,
  section_id   TEXT,
  source_id    TEXT REFERENCES sources(id) ON DELETE CASCADE,
  -- Tool ids, all of which a worker must advertise AND have enabled.
  -- ["claude"] for a section; ["yt-dlp"] for an ingest, which degrades
  -- rather than failing when ffmpeg or whisper are missing.
  needs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Pin to one machine when the person chose one. Null means any worker
  -- that qualifies.
  wants_worker TEXT REFERENCES workers(id) ON DELETE SET NULL,
  -- Everything the worker is told. Built by the server, opaque to the
  -- worker beyond its own kind's shape. Emptied by the payload sweep a
  -- day after the job finishes; see sweepPayloads in repos/jobs.ts.
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- What came back, kept for the same reason sources.research is kept: a
  -- result that only ever reached a browser did not survive a reload.
  result       JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT NOT NULL DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 0,
  -- One retry, because one retry covers the closed laptop and the dropped
  -- connection — the failures that recur — and a prompt the model refuses
  -- will refuse it again, so a third attempt is money spent to learn
  -- nothing.
  max_attempts INTEGER NOT NULL DEFAULT 2,
  priority     INTEGER NOT NULL DEFAULT 0,
  worker_id    TEXT REFERENCES workers(id) ON DELETE SET NULL,
  -- The lease. A claimed job is this worker's until this passes, and the
  -- reaper takes it back the moment it does. This column is what replaces
  -- requeueOrphans.
  lease_until  TIMESTAMPTZ,
  -- Past this, with nobody having picked it up, the job fails with a
  -- sentence naming the machine it was waiting for. Set at enqueue when a
  -- capable worker exists but is not live; see "Capability matching".
  wait_until   TIMESTAMPTZ,
  claimed_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  -- Stamped by the payload sweep, so a job it has already emptied is
  -- cheap to skip and is distinguishable from one whose payload really
  -- was {}.
  swept_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The claim query's index: state and priority, ordered by age.
CREATE INDEX jobs_claimable ON jobs(state, priority DESC, created_at)
  WHERE state = 'queued';
CREATE INDEX jobs_lease ON jobs(lease_until) WHERE state = 'claimed';
CREATE INDEX jobs_run ON jobs(run_id);
-- The payload sweep runs inside the reaper's 15s interval, so it must not
-- be a sequential scan of every job this console has ever run.
CREATE INDEX jobs_sweep ON jobs(finished_at)
  WHERE finished_at IS NOT NULL AND swept_at IS NULL;
-- One live job per section. A double Run, two tabs, or a stale poll must
-- not enqueue the same section twice and pay two subscriptions for it.
-- Postgres treats NULLs as distinct, so ingests and brain tests — which
-- have no section — are untouched by this.
CREATE UNIQUE INDEX jobs_one_per_section ON jobs(run_id, section_id)
  WHERE state IN ('queued', 'claimed');

-- Which machine wrote each section, or 'server:api' when the workspace's
-- API-key fallback did it. created_by from 0014 only says who pressed the
-- button; without this, "which sections did we actually pay money for"
-- has no answer anywhere in the database.
ALTER TABLE run_sections ADD COLUMN wrote_with TEXT NOT NULL DEFAULT '';

-- The API-key fallback, off. viaAnthropic and friends stay on the server
-- and the server never reaches for them on its own: this whole split
-- exists so a run costs a subscription somebody already pays for, and a
-- fallback that fired when nobody's laptop was open would spend real
-- money precisely when nobody was watching. Turning it on is a deliberate
-- act, per workspace, by somebody who knows what it costs.
ALTER TABLE workspaces ADD COLUMN api_fallback BOOLEAN NOT NULL DEFAULT false;

/*
 * A ONE-TIME sweep, and the last one there will ever be.
 *
 * Every run_sections row that says 'writing' at this moment belongs to a
 * driver that died with a process on this machine, because until this
 * migration there was only ever one process and it held the run in its
 * own memory. So these really are orphans of the old world, and putting
 * them back in the queue is simply the truth about them.
 *
 * Nothing at boot may ever do this again. resumeOrphans() in
 * api/src/main.ts made exactly this UPDATE on every start, reasoning that
 * a 'writing' row must be dead because its driver was. Once the work runs
 * on somebody else's laptop that reasoning is false: a deploy or a crash
 * would requeue a section a machine is four minutes into writing, the
 * section gets written twice, the second result overwrites the first, and
 * both spent a subscription. With two API replicas it is worse — every
 * boot steals the other replica's in-flight work.
 *
 * From here jobs.lease_until decides, per job, on evidence — a lease that
 * ran out — instead of on the assumption that a boot means nothing is
 * running.
 */
UPDATE run_sections SET state = 'queued', updated_at = now()
 WHERE state = 'writing';
    `,
  },
```

### The claim

```sql
WITH claimed AS (
  SELECT id FROM jobs
   WHERE state = 'queued'
     AND (wants_worker IS NULL OR wants_worker = $1)
     -- Everything this job needs, the worker has. $2 is the worker's enabled
     -- tool ids as a jsonb array; ?& asks "are all of these keys present".
     -- COALESCE because bool_and over zero rows is NULL, not true: without
     -- it a job with an empty `needs` — a test_brain, an ingest that asks for
     -- nothing — is invisible to every worker forever.
     AND COALESCE(
           (SELECT bool_and(need IN (SELECT jsonb_array_elements_text($2::jsonb)))
              FROM jsonb_array_elements_text(needs) AS need),
           true)
   ORDER BY priority DESC, created_at
   FOR UPDATE SKIP LOCKED
   LIMIT $3
)
UPDATE jobs j
   SET state       = 'claimed',
       worker_id   = $1,
       attempts    = attempts + 1,
       claimed_at  = now(),
       lease_until = now() + ($4 || ' seconds')::interval,
       updated_at  = now()
  FROM claimed c
 WHERE j.id = c.id
RETURNING j.*;
```

`FOR UPDATE SKIP LOCKED` is doing one specific thing: it lets four laptops run
this query at the same millisecond and hand each of them different rows,
because a row another transaction has locked is skipped rather than waited for.
Without it, two workers select the same job and both write it.

**What it replaces.** Two things in the current code, both of which are the
same bug — coordination held in one process's memory:

- The `globalThis` Set in `lib/server/services/runs.ts`. `isDriving(runId)` is
  the only thing stopping two drivers writing the same run, and it can only see
  what this Node process is doing. It was correct when the model was one local
  child process; with two API replicas, or an API and a worker, it is a lock
  that does not lock. The unique partial index above and the lease are the
  database saying the same thing where every process can hear it.
- `resumeOrphans()` in `api/src/main.ts`, which calls `requeueOrphans()` with
  **no run id** — a global `UPDATE run_sections SET state = 'queued' WHERE
  state = 'writing'`. Its comment reasons "every writing row belongs to a
  driver that died with the last process", and today that is true, because
  there is only ever one process. The moment work lives on somebody else's
  machine it is false: restart the API — a deploy, a crash, `docker compose
  up` — and it requeues a section a laptop is at that moment four minutes into
  writing. The section gets written twice, the second result overwrites the
  first, and both spent a subscription. With more than one API replica it is
  worse: every boot steals every other replica's in-flight work. Boot must stop
  touching `writing` rows at all. Expiry does it instead, per job, on evidence
  (a lease that ran out) rather than on an assumption about processes.

`requeueFailed` stays as it is. It answers a different question — "the person
pressed Retry" — and is still the right thing.

## Job types

Every payload is built by the server. A worker never sees a pack, a rule, a
brand voice or a dependency; it sees text and a command.

### `write_section`

The server has already done all of it: resolved the pack, checked the
dependencies, gathered the finished upstream sections, fetched the website or
the source brief through `evidenceFor()`, and run `systemPrompt()` and
`userPrompt()`. What travels is their output.

```jsonc
// payload
{
  "brain": "claude-cli",       // which BrainDef, chosen by the server
  "transport": "cli",          // decided by the server, not re-derived
  "system": "…6–8k characters…",  // systemPrompt(pack, inputs, brandVoice)
  "user": "…evidence, inputs, ALREADY GENERATED blocks, the task…",
  "tier": "high",              // cheap | standard | high — drives effort
  "timeoutMs": 600000,
  "frames": [                  // absent unless the section reads stills
    { "url": "/api/sources/src_x/frames/frame-01.jpg", "at": 3.4 }
  ],
  "allowFrameRead": true       // may Claude be granted Read for this call
}
```

```jsonc
// result
{ "text": "## Section title\n…", "ms": 42311, "using": "claude-opus-5" }
```

The worker downloads any frames, calls exactly the `viaClaudeCli` /
`viaCodexCli` / `viaGeminiCli` / `viaOllama` function that exists today —
moved, not rewritten — and returns the text. The server writes it with
`setSection`, then calls `advance(runId)`.

Three things about that `transport` field, all of them load-bearing:

- **The server decides, the worker obeys or refuses.** `write()` currently
  re-derives the transport by calling `brainStatuses()`, which calls
  `toolStatuses()`, which probes *this machine*. On the server that probe is
  now meaningless. The worker reports its tools at registration; the server
  picks from what it was told and says so in the payload.
- **A worker that cannot honour the payload fails the job.** It must never
  quietly answer some other way. `docs/DECISIONS.md` already names this outcome
  the one worse than an error: a website "identified" from a transcript,
  presented as though the frames had been read. A silent CLI-to-API downgrade
  on a worker is the same failure wearing a different hat.
- **`allowFrameRead` is policy, enforced at execution.** The server sends it
  from `workers.can_read_frames`; the worker checks its own switch again before
  granting Claude `Read`. Two checks because the grant happens on the worker's
  filesystem and the person who owns that filesystem gets the last word.

`ms` comes back from the worker. Today `writeSection` measures wall clock
around the model call; measured on the server it would now include queue wait,
so a section would report six minutes because a laptop was shut.

### `ingest_source`

```jsonc
// payload
{ "sourceId": "src_x", "url": "https://…", "refresh": false,
  "frameCount": 8, "maxHeight": 720,
  "audioRate": 16000, "audioFile": "audio.wav", "timeoutMs": 900000,
  "uploadFrames": "/api/workers/sources/src_x/frames",
  "uploadAudio":  "/api/workers/sources/src_x/audio" }
```

```jsonc
// result
{ "title": "…", "uploader": "…", "description": "…", "duration": 41,
  "thumbnail": "…", "meta": { /* yt-dlp's whole --dump-single-json */ },
  "transcript": "…", "frames": [{ "at": 2.6, "file": "frame-01.jpg" }],
  "error": "Metadata only — …" }
```

`needs` is `["yt-dlp","ffmpeg","ffprobe","whisper"]` minus whatever the ingest
is willing to do without. The current ingest degrades rather than failing when
a tool is missing, and that should survive: `needs: ["yt-dlp"]` with the rest
as a soft preference, so a machine without whisper can still fetch a caption.
The frame JPEGs and the video go up before the result is posted (see
**Frames**); the result names files the server already has.

An upload — `ingestFile` — is the one ingest that does **not** become a job in
Phase 1. The bytes are already arriving at the server from the browser, and
sending them back out to a laptop to cut frames doubles the transfer. It keeps
needing `ffmpeg` on the server, or it becomes a job in Phase 2 by having the
desktop app upload straight to a local worker. Say which; do not leave it
implied.

### `test_brain`

The smallest job, and the one that makes the whole thing legible: it is how a
person finds out whether *that machine* can write.

```jsonc
// payload
{ "brain": "codex-cli", "transport": "cli",
  "system": "You are a terse assistant. Answer in one short line, no preamble.",
  "user": "Reply with exactly: BRAIN OK", "tier": "cheap", "timeoutMs": 150000 }
```

```jsonc
// result
{ "ok": true, "ms": 2140, "reply": "BRAIN OK", "error": "", "transport": "cli" }
```

`fixFor()` in the integrations controller stays on the server — it is a lookup
from an error string to a sentence — but every sentence it returns now needs a
machine in it. "Run `codex login` in a terminal" is still the right advice and
is now advice about a terminal on a machine the reader may not be sitting at.

## Capability matching

A worker advertises `tools` (probed) and `enabled` (its owner's switches). A
job declares `needs`. The claim query intersects them, so a job simply is not
visible to a worker that cannot run it. That much is easy. The hard part is the
job nobody can run, and it has three distinct cases which must not be one:

1. **No worker has ever advertised this tool.** Fail the job at enqueue —
   `state = 'unroutable'`, `error` naming the tool and what installs it (the
   `install` string is already on `ToolStatus`). The section goes to `failed`
   with that message, so it shows on the row as Failed and Retry is offered.
   Not queued: a queue entry that can never be claimed is a run that reads
   "Writing" forever, which is precisely the six-minutes-on-Writing-01 bug
   `docs/DECISIONS.md` records, rebuilt at a larger scale.
2. **A capable worker exists but is not live.** Queue it, set `wait_until =
   now() + 15 minutes`, and say so on the page: *waiting for Shakhawat's
   desktop*. Somebody opening their laptop is the normal resolution and it
   should just start. Past `wait_until` the reaper fails it, naming the machine
   it was waiting for.
3. **A capable worker is live and busy.** Ordinary queueing. Nothing to say
   beyond position.

The rule underneath all three: **a job that cannot run must reach a terminal
state, visibly, and must never look successful.** `statusOf` derives a run's
status from its sections, so anything that leaves a section in `queued` forever
is invisible by construction.

## The worker HTTP protocol

All under `/api/workers`, all outbound from the worker, all authenticated with
`Authorization: Bearer <worker token>` and a `WorkerGuard` beside the existing
`SessionGuard` in `api/src/common/session.guard.ts`. The guard hashes the
bearer token, looks up the row, puts the worker on the request, and touches
`last_seen_at`. `@Public()` does not apply; a third decorator, `@WorkerRoute()`,
marks these and makes `SessionGuard` stand aside.

**Why not the session cookie.** Four reasons, each on its own sufficient:

- A cookie is a browser mechanism. The worker is a Node process; it would have
  to scrape one out of the webview and forge a `Origin`/`SameSite` story that
  the CORS config deliberately narrows to `WEB_ORIGIN`.
- Sessions expire and are deleted. Settings → Team removes someone by deleting
  their sessions — correct for a browser, wrong as the only lever for a machine
  (and `workers.user_id ... ON DELETE CASCADE` is the machine's version of the
  same act).
- A session is a credential over the *entire console*: every run, every
  template, every workspace, and the ability to spend model budget. A worker
  needs nine, all of them about the queue. A stolen worker token should not read the
  content library.
- A worker is long-lived and headless. It cannot be sent to `/login?next=…`,
  which is what `lib/api-json.ts` does with every 401.

The token is minted once, shown once, stored as a sha256 hash, and kept by the
machine it was minted for. Revoking it is deleting the row. Settings → Machines
is one way to mint it; the desktop app minting its own through
`POST /api/machines` after somebody signs in is the other, and is now the
ordinary one — see **Three credentials, and still two principals** below.

### Three credentials, and still two principals

There is a third thing in the `Authorization` header now, and it is worth
being exact about what it is, because the whole argument above is that a
worker's token and a person's session must not be merged.

`SessionGuard` reads `Authorization: Session <session id>` in addition to the
cookie. **It is the same session row.** Same `sessions` table, same
`expires_at`, same `sessionUser` lookup, same revocation: Settings → Team
deleting a person's sessions, "sign out everywhere", a password change
deleting all of them, the expiry sweep. There is no branch anywhere that asks
which transport a session arrived on, which is the point — a second code path
that decided *authorisation* differently would be the one that drifts.

**Why it had to exist.** The desktop app's webview is on a local origin
(`tauri://localhost`) and the API is on the team's server, so the session
cookie is a third-party cookie — exactly what webviews and browsers are
progressively refusing — and CORS is deliberately narrowed to `WEB_ORIGIN`, so
a `fetch` from that origin is refused before it is sent. The app therefore
does its two requests from Rust and carries the session itself. It matters
more than it sounds: the deployment this is heading for is **the API alone,
with no hosted console**, so "mint a token in Settings → Machines and paste
it" became an instruction with nowhere to follow it.

**Why the scheme is `Session` and not `Bearer`.** `WorkerGuard` owns `Bearer`.
Two credentials spelled the same way is how one ends up pasted where the other
belongs, and the direction that would matter is a machine's token being handed
a person's whole console. Under the wrong word each simply fails: a worker
token in a `Session` header matches no `sessions` row, a session id in a
`Bearer` header hashes to nothing in `workers`. `tests/session-credentials.test.ts`
pins the refusal, because a loosened regex is invisible to `tsc`.

**What it genuinely widens, said plainly.** A session id now lives somewhere
other than a cookie jar. A cookie is `httpOnly` and script cannot read it; a
header value is held by whatever sends it. So the desktop app keeps it in the
OS credential store — not in `settings.json` beside the addresses, and never
in the webview's DOM. `POST /auth/login` returns the id **only** when the
request carries `X-Session-Return`, so the web app's login response never
starts carrying a credential it does not need and might log.

So: still two principals. A person, who may now arrive by cookie or by header,
and a machine, which arrives by bearer token and by nothing else.

| | | |
|---|---|---|
| **Register** | `POST /api/workers/register` | `{ name, platform, version, tools: ToolStatus[], enabled: string[], canReadFrames, maxConcurrency }` → `{ workerId, heartbeatMs, claimMs }`. Idempotent on the token: the same machine re-registering after an update replaces its tool report rather than creating a second row. Re-registration is also how a newly installed `whisper` becomes visible — this is what replaces `toolStatuses(force)`. |
| **Claim** | `POST /api/workers/claim` | `{ max: 1 }` → `{ jobs: [ { id, kind, payload, leaseUntil } ] }`. Long-polls: holds up to 25s if the queue is empty, then answers `{ jobs: [] }`. Long-poll rather than a socket because it is one code path, survives every proxy, and keeps latency to about a second without anything stateful in between. `202` with an empty list is not an error and must not be logged as one. |
| **Heartbeat** | `POST /api/workers/heartbeat` | `{ jobIds: ["job_x"], progress?: "…" }` → `{ keep: ["job_x"], drop: ["job_y"] }`. Extends the lease on each job it still holds. `drop` is how a worker learns a job was cancelled or reaped: it kills the child process rather than finishing work nobody wants. Every 15s. |
| **Result** | `POST /api/workers/jobs/:id/result` | `{ result }` → `{ ok: true }`. Refused with `409` if the job's `worker_id` is not this worker or its lease has expired — a laptop that wakes from sleep and posts a section that was reassigned twenty minutes ago must not overwrite the one that actually landed. |
| **Fail** | `POST /api/workers/jobs/:id/fail` | `{ error, retryable }` → `{ ok: true }`. `retryable: false` for a refusal, a bad payload, a missing tool; the server does not spend another attempt on those. |
| **Frames** | `POST /api/workers/sources/:id/frames` | `multipart`, one file per part, `file` field matching `FRAME_FILE`. Streamed to disk with the cap and the counter `writeCapped` already uses. |
| **Audio** | `POST /api/workers/sources/:id/audio` | The 16 kHz WAV, same streaming and cap. `GET` on the same path streams it back — that is how `transcribe_audio` gets its input without the video. The filename is the server's, not the sender's: a source has one audio track. |
| **Download** | `GET /api/workers/sources/:id/frames/:file` | How a `write_section` job fetches the stills it was handed. A SECOND door rather than a widened one: the browser's `GET /api/sources/:id/frames/:file` keeps its session and is untouched. Making that one accept either credential would have let a stolen worker token walk the content library through the same handler, which is the opposite of why the token exists. |

## Liveness and recovery

- **Lease.** A claim sets `lease_until = now() + 90s`. A heartbeat every 15s
  extends it. Ninety seconds is six missed heartbeats: long enough that a
  Windows machine paging in a large ffmpeg does not lose its job, short enough
  that a closed laptop is noticed before anyone reloads the page twice.
- **Reaper.** A `setInterval` in the API, every 15s:
  `UPDATE jobs SET state = 'queued', worker_id = NULL, lease_until = NULL
   WHERE state = 'claimed' AND lease_until < now()` — and the same pass fails
  anything at `attempts >= max_attempts` or past `wait_until`. The query is
  atomic and idempotent, so running it in two API replicas at once is harmless.
  This is the only thing that ever moves a job out of `claimed`, and it does it
  on evidence — a lease that ran out — rather than on the assumption `boot ⇒
  nothing is running` that `resumeOrphans` currently makes.
- **A laptop closed mid-section.** The heartbeat stops, the lease expires
  inside 90 seconds, the job goes back to `queued`, another capable worker
  claims it, `attempts` is now 2. The section stays `writing` throughout — it
  is being written, just by somebody else now — and the page shows which
  machine. Half a section is not saved; a `write_section` result arrives whole
  or not at all.
- **Attempts.** `max_attempts` 2 by default. One retry covers the closed
  laptop and the dropped connection, which are the failures that recur; a
  prompt the model refuses will refuse it again, and the third attempt is money
  spent to learn nothing. On exhaustion the section goes `failed` with the last
  error, exactly as today, and Retry — `requeueFailed` — is the way back.
- **Boot.** `resumeOrphans()` is deleted from `api/src/main.ts`. Migration
  `0015` should sweep existing `writing` rows to `queued` **once**, in the
  migration, because those really are orphans of the old world. After that,
  nothing at boot touches a section's state.

## Frames

The server is the single source of truth for frames and transcripts, and this
is not negotiable. Four reasons:

- The browser renders frames from `GET /api/sources/:id/frames/:file`. If they
  live on a laptop, the picker is blank whenever that laptop is shut.
- The worker that ingests and the worker that writes are usually different
  machines, and the researcher's HISTORY panel re-opens an answer with the
  frames it was read from already ticked — months later, from any machine.
- Ingest is expensive on purpose. `sources` exists so a second look does not
  pay yt-dlp, ffmpeg and whisper twice. Per-machine copies mean paying per
  machine.
- Desktops are not backed up. `sourcedata` on the server is.

So: **ingest uploads, write downloads.**

The ingesting worker runs the pipeline into a temp directory, posts each JPEG
to `POST /api/workers/sources/:id/frames` and the transcript to its endpoint,
then posts the result naming the files. The server re-checks every filename
against `FRAME_FILE` — those names now arrive over the network, and the regex
that was guarding a query string is now guarding a write.

A `write_section` job whose payload carries `frames` downloads them, in order,
to a temp directory of its own, then hands the CLI **local absolute paths**,
because none of the three CLIs takes bytes and each takes a file differently:

- **Claude** — the paths are listed in the prompt and `Read` is granted for
  that one call, gated on `allowFrameRead`.
- **Codex** — `-i <file>` repeated per frame, one flag per picture, never a
  list (a list swallows the `-` that says the prompt is on stdin).
- **Gemini** — `@<path>` references inside the `-p` prompt, plus
  `--include-directories` naming the temp directory so a path outside the
  CLI's cwd is allowed at all.

The temp directory goes in a `finally`, whether the call worked or not, and it
must not be `cliHome()` — that directory is deliberately empty so the CLI has
nothing to find, and filling it with JPEGs after the run undoes the reasoning
in `docs/DECISIONS.md`.

**One thing to fix while doing this.** `sourceBrief()` ends the frames line
with "They are on disk under `.data/sources/<id>/`." On a worker that sentence
is false — the frames are in a temp directory under a different name, on a
different machine — and it is also the server's filesystem layout being handed
to a model on somebody's desktop. The prompt should say how many frames there
are and at what seconds, and the paths should reach the CLI only through the
per-transport mechanisms above, which already name them correctly.

## What this breaks in the UI

`IntegrationsView` and `api/src/integrations/integrations.controller.ts` are
built on a premise that stops being true: that "this machine" is a machine the
server can probe. `wiring()` calls `toolStatuses()` and `brainStatuses()`,
which spawn `claude --version` and `yt-dlp --version` **in the API process**.
On the server those return nothing installed, forever, and the page becomes a
list of red rows about a box nobody uses.

The change:

- **A machine picker at the top of the page.** "This machine" becomes "which
  machine?", and the answer is a row from `workers`, with its owner, its
  platform, and how long ago it was seen. The desktop app can default it to the
  worker running beside it, which is the common case and makes the page feel
  local again.
- **Tool status is read, not probed.** The rows render `workers.tools` — the
  same `ToolStatus` shape, so the component barely changes — with a *last
  seen* line instead of a live spinner. "Re-check" stops meaning "spawn five
  processes" and starts meaning "ask that worker to probe again": enqueue a
  probe, or simply have the worker re-register, which it does on a timer
  anyway. `?recheck=1` and the 60s cache in `tools.ts` both belong to the
  worker now.
- **Test brain becomes a `test_brain` job.** The button already runs for up to
  150 seconds and already renders "running"; what changes is that the result
  arrives by polling the job rather than from the POST's own response, and the
  panel names the machine that answered. A model that works on one teammate's
  laptop and not another's is now a thing the page can say, and today it cannot
  express the question.
- **A worker that is offline is not a broken tool.** The distinction the page
  has to draw, in its own words: *`whisper` is not installed on that machine*
  versus *that machine has not been seen since Tuesday*. One is an install
  command, the other is "open your laptop".

### `settings.brain` is a singleton and must be scoped

`lib/server/repos/settings.ts` is a key/value table with one row per key and no
scope column at all. So `brain`, `enabled` and `cliCanReadFrames` are one value
for the whole console. On a laptop that was right — one console, one person,
one machine. On a server with four teammates it is three separate wrong things:

- **`brain` → workspace.** Which model writes is an editorial decision about
  the content, not about hardware: the workspace that writes Bangla scripts and
  the one writing SEO copy may reasonably want different ones, and neither
  should change under the other because somebody switched a global. Put it on
  `workspaces` — it sits naturally beside `brand_voice`, which is scoped for
  exactly this reason and read by `startRun` from the workspace rather than the
  request.
- **`enabled` → worker.** "yt-dlp is switched off" is a statement about a
  machine. It is `workers.enabled` above, and `allowed()` in `ingest.ts` — which
  today ANDs `toolStatus(id).present` with the global `settings.enabled` — is
  evaluated by the worker against its own row.
- **`cliCanReadFrames` → worker.** It grants the `Read` tool on one specific
  filesystem. Whoever owns that filesystem owns the switch; a global that lets
  a teammate grant file access on your desktop is not a setting, it is a hole.
  Note it defaults **on** today, and `workers.can_read_frames` above defaults
  **off**: enrolling a machine should not silently carry over a permission
  granted on a different one.

The rest of `Settings` — `quality`, `autoApprove`, `reduceMotion` — is fine
where it is, or wants to be per-user, which is a separate argument.

## Decisions

The six questions above, answered. Each is settled unless somebody argues it
down with a reason the answer does not already cover.

### The API-key fallback does not happen by itself

`viaAnthropic` / `viaOpenAI` / `viaGemini` stay on the server, and the server
never reaches for them on its own. A workspace carries `api_fallback BOOLEAN
NOT NULL DEFAULT false`; while it is false, a job with no capable worker takes
the routing above — `unroutable`, or queued behind `wait_until` — and says so.

The reason is the whole project. This split exists so a run costs a
subscription somebody already pays for rather than money per token. A fallback
that fires when nobody's laptop is open would spend that money precisely when
nobody is watching, which is the failure `docs/DEPLOYING.md` warns about with
"the reason to keep an eye on who runs what". Off by default is not caution
here, it is the feature.

It stays available because "everyone has gone home and this has to ship
tonight" is a real evening. Turning it on is a deliberate act, per workspace,
by someone who knows what it costs.

`run_sections` gains `wrote_with TEXT NOT NULL DEFAULT ''` — the worker's name,
or `server:api`. Without it "which sections did we pay for" is unanswerable,
and `created_by` from migration `0014` only says who pressed the button.

### Any worker may serve any workspace — but the column exists now

`workers` gains `workspace_ids JSONB NOT NULL DEFAULT '[]'::jsonb`, where empty
means every workspace. Today it will be empty on every row.

Narrowing it now would contradict a decision that is already made and written
down: there are no roles, and everyone who is in can read and change
everything. Building a permission the console has nowhere else would be one
team's answer imposed through a schema.

But the question in the sketch is a real one — a client's unreleased footage
reaching a contractor's laptop is a different kind of event from a teammate
reading a template — and the day it matters the answer must not be a
migration, a backfill and a claim-query rewrite under time pressure. An empty
array costs nothing and turns that day into one UPDATE and one `AND` in the
claim.

### Cancellation ships with Phase 1, server-side

`heartbeat` already returns `drop`; the worker already has to handle it. On the
server a cancel is one `UPDATE jobs SET state = 'cancelled' WHERE run_id = $1
AND state IN ('queued','claimed')`, and the next heartbeat tells whoever was
running it to kill the child.

It ships because the alternative is worse than the work. Deleting a run whose
sections are queued would otherwise leave jobs pointing at a row that is gone,
and a job waiting on an offline machine has no way to stop before `wait_until`.
Both are states somebody hits in the first week.

The UI is one Stop button on a run that is writing, and `deleteRun` cancels
first. Anything richer — cancelling a single section — waits.

### Jobs are kept; their prompts are not

The row lives forever. A day after `finished_at`, a sweep clears `payload` and
the bulky half of `result`, keeping `kind`, `worker_id`, `attempts`, the
timings, `result.ms` and `result.using`.

A `write_section` payload is six to eight thousand characters of system prompt
that `systemPrompt()` will rebuild identically on demand, and its `result.text`
is already the section — `run_sections` holds the copy that is read. Keeping
both makes `jobs` several times the size of the content it describes, for no
question it can answer that something else cannot.

What only `jobs` can answer is where work ran, how long it took, how often it
had to be retried and on whose machine — the operational record this console
has never had. That part is small and it stays.

The sweep runs in the reaper's interval. One more `UPDATE` in a pass that is
already atomic and already idempotent.

### The desktop app holds two credentials, on purpose

The app signs in as a person and holds that session. The worker holds its own
bearer token. They are not the same principal and must not be merged.

Everything in **The worker HTTP protocol** above argues this: different
lifetime, different blast radius, different revocation. A single credential
that is both would be a session that survives Team → Remove, or a worker token
that can read the whole content library — one of the two, depending on which
side won.

**What changed, and what did not.** The person's half is no longer a cookie in
the webview: the window is on a local origin, the API is on the team's server,
and that cookie is third-party. The app signs in itself, over
`POST /auth/login` with `X-Session-Return`, and sends the session back as
`Authorization: Session <id>` — same row, same expiry, same revocation, as
**Three credentials, and still two principals** sets out. Two credentials, two
entries in the OS credential store under `com.contentos.desktop`:
`worker-token` and `console-session`. Separately written, separately revoked,
and only the first is ever handed to the Node worker.

**Nobody types either of them.** The app mints this machine's worker token for
itself through `POST /api/machines` the moment somebody signs in, names it
after the computer, keeps the id it was given, and does not mint a second one
on the next launch. That is not a convenience: the deployment this is heading
for has no hosted console, so Settings → Machines is not a page anybody can
open, and "paste the token you were shown" was an instruction with nowhere to
follow it. The field is still on the setup window, one disclosure down, for
whoever is handed a token by a colleague.

### Uploads stay on the server, and whisper stops needing the video

`ingestFile` keeps running where the bytes already are. `ffmpeg` is a real
dependency of the API image — it already is, in `api/Dockerfile` — and cutting
eight stills out of a file that is already on local disk is cheap.

`whisper` does **not** become a server dependency, because transcription splits
off into its own job:

- **`ingest_source`** (worker): yt-dlp, the frames, and a 16 kHz mono WAV.
  Uploads all three.
- **`transcribe_audio`** (worker, `needs: ["whisper"]`): downloads **the WAV**,
  transcribes it, returns text.

For an upload the server does the ffmpeg half itself — frames and the WAV — and
enqueues `transcribe_audio` like any other.

This falls out of three things agreeing. Audio is roughly a thirtieth of the
video, so the round trip the sketch rejected stops being a round trip worth
rejecting: a megabyte a minute, not four hundred megabytes. Transcription is
the one step that wants a GPU and is therefore the one step most worth sending
to a desktop. And `whisper.cpp` — which is what a one-click installer can
actually put on a non-developer's Windows machine, where
`pip install openai-whisper` cannot — takes 16 kHz mono WAV as input anyway, so
the conversion is not overhead invented here, it is a step that had to happen
somewhere.

It also means a machine with no whisper at all still ingests: `needs` on
`ingest_source` never includes it.

## Still open

- **Which model a `test_brain` job uses when the workspace names one the
  machine cannot reach.** Probably: test what was asked for and report the
  refusal, since that is the question being asked. Not settled.
- **Whether `quality`, `autoApprove` and `reduceMotion` become per-user.** A
  separate argument from this one, and nothing here forces it.

## Running the worker

It lives in `worker/`, and it runs today as a plain `node` process — no build
step, no bundler, no ts-node. Node strips the types out of the `.ts` files
itself; `worker/register.mjs` is a five-line resolve hook that lets those files
import `lib/server/tools.ts` by its plain path, which Node's ESM resolver
otherwise refuses and `tsc` otherwise insists on.

```
CONTENTOS_API_URL=http://localhost:4000 \
CONTENTOS_WORKER_TOKEN=<the token from Settings → Machines> \
npm run worker
```

| Variable | |
|---|---|
| `CONTENTOS_API_URL` | **Required.** The **API** this machine works for — NestJS, on its own hostname (`API_HOST` in `docs/DEPLOYING.md`, `:4000` in a checkout). Not the address of the console you open in a browser; there is no `/api` under Next, so that one 404s everything. |
| `CONTENTOS_WORKER_TOKEN` | **Required.** Minted in Settings → Machines and shown once, or minted for this machine by the desktop app when somebody signs in there. Either way it is the same 256-bit token and the same row. |
| `CONTENTOS_WORKER_NAME` | What the machine picker calls it. Defaults to the hostname; "Shakhawat's desktop" reads better than `DESKTOP-7F2K1`. |
| `CONTENTOS_WORKER_ALLOW_FRAME_READ` | `1` to let Claude's CLI be granted `Read` for frame files **on this machine**. Off by default, and checked in addition to `workers.can_read_frames` — the grant lands on this filesystem, so whoever owns it gets the last word. |
| `CONTENTOS_WORKER_TOOLS_OFF` | Comma-separated tool ids to switch off here, whatever the probe found. |
| `CONTENTOS_WORKER_MAX_JOBS` | How many jobs to hold at once. 1, and the server's `max_concurrency` caps it again. |
| `CONTENTOS_OLLAMA_URL` | Where Ollama is, for the one brain that is an HTTP server rather than a CLI. Defaults to `http://localhost:11434`. |
| `CONTENTOS_DATA_DIR` | Only used for `cliHome()` — the empty directory the model CLIs are started in. Frames and downloads go to the system temp directory, never here. |

Neither required variable has a default that could be right: an API URL guessed
as localhost makes a worker that serves nobody, and a blank token authenticates
as nothing. A missing one is reported as the sentence naming what to set, and
the process exits 1 — nobody reading a console window on their own laptop needs
a stack trace to be told they have not pasted the token yet.

Two things worth knowing about how it behaves:

- **Each job runs in a process of its own.** That is what makes `drop` mean
  anything: `run()` in `lib/server/tools.ts` hands back a promise and keeps its
  `ChildProcess`, so the only thing a worker can actually kill is a whole
  process, and the heartbeat's `drop` list has to kill something. It also means
  a CLI that wedges takes one job down rather than the machine.
- **Stopping it is Ctrl-C.** It stops claiming immediately, kills whatever is
  running, and *fails those jobs explicitly* rather than leaving them to their
  leases. Both put the job back in the queue; the explicit one does it now
  instead of ninety seconds later, which is ninety seconds of somebody watching
  a row that says "Writing" on a machine that is already closed.

## Installing the tools

`npm run worker:setup` fetches the tools this machine is missing into a folder
the app owns, and the worker looks there before it looks at PATH.

It exists because of who the worker is for. The team running it are not
developers and they are on Windows, and every ordinary instruction fails that
audience: `pip install openai-whisper` needs a Python, then PyTorch, then
gigabytes, and then usually a conversation about CUDA; `winget install
Gyan.FFmpeg` needs an admin prompt and a PATH nobody will ever look at again.
This is a script, not an application — a desktop app would only put a button on
top of it — and its whole mechanism is: download four pinned files into one
folder, and teach the probe to look in that folder.

```
npm run worker:setup                 # ask, then fetch what is missing
npm run worker:setup -- --models     # what the whisper models cost
npm run worker:setup -- --yes --model small
npm run worker:setup -- --only whisper --whisper cublas   # the GPU build
npm run worker:setup -- --dry-run    # print the plan and stop
```

### What it downloads, and from where

Every version is a constant in `worker/setup.ts` with its URL and its sha256
beside it. **Nothing here ever resolves "latest".** A script that silently
pulls whatever a server feels like handing over today is not a thing to run on
a colleague's laptop, and a pinned version is also the only reason "it worked
last week" is a question with an answer.

| | Pinned | From |
|---|---|---|
| **yt-dlp** | `2026.08.19` | `github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe` (and `yt-dlp_linux` / `yt-dlp_macos`) |
| **ffmpeg + ffprobe** | `9.0.1` essentials | `gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-essentials_build.zip` — the Windows build ffmpeg.org itself links to, static, so the two executables carry no DLLs |
| **whisper.cpp** | `b4938` (v1.9.3) | `github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip`, or `whisper-cublas-12.4.0-bin-x64.zip` for `--whisper cublas` |
| **a whisper model** | `base` by default | `huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<name>.bin` |

The plan — what, from whose server, how big, pinned to which version, and the
digest — is printed **before** anything is fetched, and then it asks. With no
terminal to ask in, it refuses and says to pass `--yes`; "nobody was there" is
not consent.

`--models` prints what each model costs in disk and in accuracy, because
choosing one is a trade between disk, time and how many words come back wrong,
and nobody can make that choice from a list of names:

| | Disk | |
|---|---|---|
| `tiny` | 74 MB | roughest. Clear English only; mangles names and accents. |
| `base` | 141 MB | the default. Fine on clean speech, roughly real time on a CPU. |
| `small` | 465 MB | clearly better on accents, noise and non-English; ~3× slower. |
| `medium` | 1.4 GB | close to the best, slow enough on a CPU to outlast a job's timeout. |
| `large-v3-turbo` | 1.5 GB | near-large accuracy at roughly medium speed — the best trade with a GPU. |
| `large-v3` | 2.9 GB | the best there is. Hours per hour of audio without a GPU. |

The `.en` variants are deliberately not offered: this console is used for
Bangla as well, and an English-only model would quietly transcribe it wrong.

**What it deliberately does not install.** `claude`, `codex` and `gemini` each
sign in as a particular person with that person's own subscription, so the
app's job is to detect them, which it already does — the script prints the
`npm i -g` line for whichever are missing and stops there. Ollama is optional,
is roughly 700 MB with its own installer, and is one brain out of four: the
script asks `localhost:11434` whether it is running and points at
`https://ollama.com/download` if it is not, rather than pulling it down
uninvited. Both appear in the report at the end, so one command still answers
"is this machine ready".

### How an arrival is checked

Bytes stream into `.data/tools/downloads/<name>.part` while their sha256 and
their length are computed on the way past. Only a file that matches **both**
the digest and, where the publisher states one, the exact byte count is
`rename`d into `bin/` or `models/`. A mismatch deletes the file and says which
host it came from.

The staging is the point. A dropped wifi connection, a captive portal that
answers with a login page and a `200`, a proxy that gives up at two gigabytes —
each of those would otherwise leave a half-written `yt-dlp.exe` sitting in
`bin/`, where the probe reports it as an installed tool and the failure
resurfaces a week later as an ingest that cannot read any link. A partial
download must never end up under the name the probe looks for.

Where the checksums come from: GitHub publishes a `digest` on every release
asset (and yt-dlp additionally ships `SHA2-256SUMS`); gyan.dev publishes a
`.sha256` next to each package; Hugging Face stores the sha256 of an LFS file
as its object id, which is what the model digests are. They are copied into the
catalogue rather than fetched at install time, so the value being checked
against is the one in this repository and reviewed with it. gyan.dev states no
byte count, so ffmpeg is the one entry verified by digest alone.

Re-running is normal and cheap: what is already present is reported and
skipped, and `--force` fetches again. A file of the wrong size — half-copied
off a USB stick, left by an interrupted older script — does not count as
present, which is the same rule as above from the other side.

### Where it lands, and how to undo it

```
.data/tools/
  bin/       yt-dlp.exe  ffmpeg.exe  ffprobe.exe  whisper-cli.exe + its DLLs
  models/    ggml-base.bin
  installed.json     what was pinned, from where, with which digest, when
```

One flat `bin/` because whisper.cpp loads `whisper.dll`, `ggml.dll` and the
`ggml-cpu-*` variants out of its own executable's directory — copying the exe
without them yields a program the probe finds and Windows refuses to start —
and because the probe then has one place to look instead of a list that has to
be kept in step with the catalogue.

**Nothing is written outside that folder.** No PATH edit, no registry key, no
admin prompt, no `%APPDATA%`, nothing installed for all users. Undoing the
whole thing is deleting `.data/tools`. It sits under `.data/` specifically
because `.gitignore` already ignores that directory; anywhere else and the
first person to run the installer finds two hundred megabytes of executables in
`git status`.

`CONTENTOS_TOOLS_DIR` (or `--dir`) puts the folder somewhere else — another
drive, for the three-gigabyte model. It is read by `lib/server/tools.ts` and
set for it by `toolsRoot()` in `worker/config.ts`, which resolves it from the
worker's own file rather than from the working directory, so a sidecar started
from anywhere still finds its tools. It is deliberately not `CONTENTOS_DATA_DIR`,
which still belongs to `cliHome()` and to nothing else.
`CONTENTOS_WHISPER_MODEL` names one `.bin` outright, for a machine that already
has a models folder from something else.

**Keeping yt-dlp fresh.** It is the one tool here that goes stale on a schedule
nobody controls: it breaks when a platform changes its player, which happens
without warning and roughly monthly, and the symptom is an ingest that worked
last month and now cannot read a link. It updates itself, in place, with no
admin, because the file is ours:

```
.data\tools\bin\yt-dlp.exe -U
```

Or `npm run worker:setup -- --force --only yt-dlp` to go back to the pinned
version. Restart the worker afterwards so it re-registers and the Integrations
page shows the new version.

### Windows first, honest elsewhere

ffmpeg and whisper.cpp are fetched as Windows x64 builds, because that is what
the team runs. On macOS and Linux the script says so in as many words and
prints that platform's own one-liner — `brew install ffmpeg`, `brew install
whisper-cpp`, `sudo apt install ffmpeg` — rather than downloading a binary that
cannot execute. yt-dlp ships a single file per platform and is fetched on all
three; a whisper model is a data file and is fetched on all three too, since a
`brew`-installed whisper.cpp arrives without one.

### What the probe does with all this

`lib/server/tools.ts` resolves every command in `.data/tools/bin` **first** and
falls back to PATH. Both halves of that order matter: a machine that has just
run the installer has everything in the app folder and nothing on PATH — that
is the whole point of not editing PATH — and where both exist, ours is the one
whose version is pinned, checksummed and updatable, rather than a yt-dlp
somebody pip-installed in 2021. `installed.json` is read back for the version
column, because whisper.cpp's CLI has no `--version` flag to ask.

`whisper` now names two entirely different programs, and the probe tries them
in this order:

1. `whisper-cli` — whisper.cpp, preferred, because it is the one this installer
   can produce, the one with a GPU path, and the one that takes the 16 kHz mono
   WAV the ingest already uploads.
2. `main` — whisper.cpp under the name it used before v1.7.4. That is also the
   most ordinary name anybody has ever given an executable, so this attempt
   only counts if the output looks like whisper's usage.
3. `whisper`, then `python -m whisper`, `python3 -m whisper`, `py -3 -m
   whisper` — openai-whisper, still supported, still with `PYTHONIOENCODING`
   set for the reason recorded in that file.

`ToolStatus` gained `flavor`, which says which of the two answered, and
`transcribe-audio.ts` reads it and speaks whichever program's arguments apply.
They agree on nothing: one takes the audio as a bare argument with a model
*name* it downloads for itself, the other takes `-f` for the audio and `-m` for
a model *file* that has to already exist. whisper.cpp is also given `-l auto`,
because it defaults to `-l en` where openai-whisper defaults to detecting — a
Bangla source would otherwise come back as English-shaped nonsense with nothing
anywhere saying why.

**A missing model is not a missing program.** whisper.cpp with no `.bin` cannot
transcribe anything, so the probe does not report it as present: it falls
through to openai-whisper, and if that is not here either the row reads
`whisper.cpp is installed here, but there is no model file in …` with
`npm run worker:setup -- --only whisper` as the fix. Reporting it as present
would route transcription jobs to that machine and fail every one of them,
which is the "queued forever" failure this document argues against everywhere
else. Every other outcome stays its own sentence, because it took a bug to
separate them: switched off, not installed, no model, timed out, crashed, wrote
no file, and wrote an empty file — the last of which is a success, since a reel
with music and no speech genuinely has no words in it.

## The desktop app

Built, and small on purpose. It lives in `src-tauri/` — Tauri 2, Windows
first — and it is two things in one process: **a window onto the console the
team already runs**, and **the worker running beside it**. A teammate who is
not a developer installs one app, signs in with their email and their password,
and it starts taking jobs. Nobody opens a terminal, nobody is asked where the
console is — the installer was built knowing — and nobody is asked for a token:
the app mints this machine's own through `POST /api/machines` as part of
signing in.

**What it is not**, and this is the part worth defending:

- **Not a second frontend.** There is no copy of the console's UI in
  `src-tauri`, and there must not be. The console is served by the server, so a
  template change or a fix reaches every teammate the moment it is deployed
  instead of needing fifteen desktops updated. The one screen this app draws
  itself is `src-tauri/ui/setup.html`, and it exists only because this machine
  has to be set up *before* there is a console to set it up from — the sign-in,
  and the console and API addresses on the builds that were not compiled with
  them — and because a worker that cannot start needs somewhere to say so that
  is not a console window.
- **Not a second identity system.** It signs in with the console's own accounts,
  over the console's own `POST /auth/login`, and gets back the console's own
  session — the same row a browser would have held in a cookie, carried in a
  header because a webview on a local origin cannot keep that cookie. No users
  here, no passwords here, no second table anywhere. The worker holds the
  machine token. Two credentials, for the reasons in "The desktop app holds two
  credentials, on purpose" above.
- **Not a rewrite of the worker.** It spawns `worker/index.ts` with the same
  flag, the same loader hook and the same relative path `npm run worker` uses.
  If the two ever drift, this app is running a worker nobody can reproduce from
  a terminal, which is the one thing that would make a bug report useless.

### Where the settings live

| | |
|---|---|
| Console address | Compiled in, or in the environment, or in `%APPDATA%\com.contentos.desktop\settings.json` — three places in a fixed order, below. Not a secret in any of them: it is the URL a browser would show, and a person debugging their own machine has to be able to read it. |
| API address | The same three places, the same order, its own value. It is what the worker calls; the console address is not. Why they are two, and why neither is guessed from the other, is the next section. |
| Worker token | The **OS credential store**: Windows Credential Manager, under the target `worker-token.com.contentos.desktop`. Minted by the app itself at sign-in, or pasted in by somebody who was handed one. The console keeps only its sha256 so that a database dump is not a list of live credentials; writing the plaintext into `%APPDATA%` would undo that at the other end, where anything running as that user can read it and the first backup of the profile carries it off the machine. |
| The session | The same store, under `console-session.com.contentos.desktop`. A separate entry rather than a second field in one blob, because the two are separately replaced: signing in again writes this and leaves the token alone, re-enrolling writes the token and leaves this alone. It is in the credential store for the same reason the token is — a header credential in `%APPDATA%` is a credential in the next backup of the profile — and it is never given to the webview or to the worker. |
| Who is signed in | `accountEmail` in `settings.json`, and it is only a label: the window shows it, `settings::account_email` returns it only while there is a session in the store to go with it, and nothing authenticates with it. |
| This machine's row | `machineId` in `settings.json`. Not a credential — it is the id the machine picker shows beside a name — and it is what stops a second machine being minted on every sign-in. |
| Session cookie | The webview's own data directory, which is WebView2's business and not this app's. The API's cookie never reaches it: the window is on a local origin, so that cookie is third-party. |

### Where the two addresses come from

**There are two, and the app is told both.**

| | What it is | Production (`docs/DEPLOYING.md`) | A checkout |
|---|---|---|---|
| `CONTENTOS_CONSOLE_URL` | The console — the pages the app opens in its webview. Next. | `https://content.yourcompany.com` (`APP_HOST`) | `http://localhost:3333` |
| `CONTENTOS_API_URL` | The API — what the worker calls for jobs, and the only one of the two it ever touches. NestJS. | `https://api.content.yourcompany.com` (`API_HOST`) | `http://localhost:4000` |

**Why two.** `docs/DEPLOYING.md` puts the web app on `APP_HOST` and the API on
`API_HOST`, on two hostnames under one `COOKIE_DOMAIN`, and the browser calls
the API cross-origin — which is why `lib/api-base.ts` reads
`NEXT_PUBLIC_API_URL` and why `docker-compose.prod.yml` has to pass it as a
*build* arg. There is no `/api` under Next. An app that resolved one address
and handed the worker the console's origin would 404 every request that worker
made on any real deployment, while the window beside it worked perfectly — the
hardest kind of failure to report, because everything the person can see is
fine.

**Why neither is derived from the other.** Putting `api.` in front of the
console's host is this repository's compose convention, not a rule;
`docs/DEPLOYING.md` says the two may be anywhere. A guess that is usually right
is worse than a value that is always stated, because it does not fail for the
person who made it — it fails months later, on somebody else's DNS, as a
teammate whose machine will not connect.

**Nobody installing this app should have to type either.** The team has one
console and one API, whoever built the installer already knew both, and free
text in a setup window is a typo that ends as a support question weeks later on
somebody else's laptop. So both are compiled in, and the fields are gone from
the screen unless there is genuinely nothing else to go on.

Three places each, highest first, and the first one with a usable answer wins.
`pick` in `src-tauri/src/settings.rs` is the whole rule, in **one** function
that takes which address it is resolving — the two differ in what they name,
not in how they are found — with its candidates passed in so it can be tested
without a window system.

| | Where | Why it sits here |
|---|---|---|
| 1 | The variable in the **running app's** environment | Development. `npm run desktop` sets both, so a checkout works with no setup at all. It beats the two below on purpose: a debug build compiled against the team's servers, or one with a `settings.json` left from testing an installer, would otherwise point a debug worker at production and let it claim real jobs. |
| 2 | **Saved on this machine** — `consoleUrl` and `apiUrl` in `%APPDATA%\com.contentos.desktop\settings.json`, written by the setup window | The escape hatch: one machine pointed at a second team's servers, or at staging. It beats the compiled-in value so that it survives reinstalling the same installer — if it did not, moving one machine would mean building a second installer for it. Saving one address reads the file and puts the other back, so a machine cannot end up holding half a pair. |
| 3 | The variable at **compile time**, read with `option_env!` | What a production installer ships with, and what nearly everybody actually runs. The floor, not the ceiling. |

Every candidate goes through the same `normalise` the setup window's fields do,
and one that is not a usable address is skipped rather than accepted — so an
`apiUrl: ""` in a `settings.json` written before there was one does not shadow
the address the installer was built with.

**What the setup window asks for.** An email and a password, and nothing else.
Sign in, and the app keeps the session, mints this machine's worker token,
stores it, and starts the worker — one button, and the person never sees a
token at all. Afterwards the panel stops being a form and becomes a line saying
who is signed in, with two things beside it: *Set this machine up again*, which
mints a fresh token from the session already held and is the answer to a
machine revoked or a credential store cleared, and *Sign in as somebody else*,
for a computer handed to a colleague.

Every way it can fail gets its own sentence, because they are different things
to go and do:

| What happened | What the window says |
|---|---|
| The password is wrong | *That email and password do not match an account on this console. Accounts here are invite-only, so if you have never signed in before, ask whoever runs the console for an invite link.* |
| Signup is closed and there is no account for this person — which is every console that has an owner | The same sentence. It is the same 401, and the invite half is the part that is actually actionable. |
| The console has **no** accounts at all yet | *There are no accounts on this console yet… The very first account — the owner's — is made on the console itself.* Asked for with `GET /auth/signup` before anything is said, because telling somebody their password is wrong when nobody has made them an account sends them to change a password that was fine. |
| The API cannot be reached | The address, named, and said to be the **API** — *the server the worker asks for jobs, which is not the console*. The person very often has the console open behind the window, so a sentence about "the server" reads as obviously false. |
| The API answers, but with something else | *…answered with something this app could not read. That address may not be the Content OS API* — which is what a console address or a proxy's error page in that field actually looks like. |
| This computer is already enrolled | It is kept: *This computer was already set up as "Shifa", so it kept it rather than adding a second one.* |
| The API is older than this app | *…signed you in but did not give this app a session to keep.* The one case where everything the person can see says it worked, so it has to say plainly that the fix is on the server. |

**How "already enrolled" is decided**, since a wrong answer here fills Settings
→ Machines with a row per launch, each holding a live credential. The app keeps
the machine id it was handed when it minted the row, in `settings.json`, and
reuses that machine only when **all three** hold: the id is recorded, a worker
token is in the credential store, and the console still lists that id *against
the person who has just signed in*. Not by hostname — two laptops are both
called DESKTOP-something, and a machine somebody renamed must not be renamed
back. Not by the token alone — a token whose row was revoked authenticates as
nothing, and the machine would sit there doing no work. And the ownership check
is what stops a computer handed from one teammate to another carrying on as the
first, spending their subscription under their name in the picker.

**What the setup window shows.** Both addresses, one under the other, each with
its own provenance line — because "my machine will not connect" is answered by
knowing which server the worker was calling and who told it to call that one,
and the console can never answer it: the window the person is looking at is
proof that *that* address is fine.

| The address came from | The row |
|---|---|
| The build | The address as text, under *Built in when this copy of Content OS was made*. |
| This machine | The address as text, under *Set on this machine*. If the copy was also built with this address and it differs, a line naming the built-in one and a *Go back to it* link — otherwise one typo in an override would hide the correct address with no way back but deleting the file. |
| The environment | The address as text, under *From CONTENTOS\_CONSOLE\_URL* (or *CONTENTOS\_API\_URL*) *in this window's environment — a development setting, which wins over everything below*. It names the variable it means, because that line exists to say which one has to go before anything saved here takes effect. |
| Nowhere | The row is not drawn at all. A heading over an empty line says "broken" without saying what to do; the field below, already open, says it. |

*Use different addresses on this machine* is a disclosure under the pair:
closed and out of the way when both are known, and it writes to place 2.
Leaving a field blank means "leave that one alone" — nothing ever pre-fills
them, because a Save that also wrote a copy of the built-in addresses into
`settings.json` would pin the machine to today's answer forever. Both fields
are validated before either is written, so a typo in the second does not leave
the machine holding a saved first one.

Two edges are drawn on purpose. When **neither** address is known the
disclosure stops being one — no summary, just the fields, which is the screen
as it was before any of this. When **one** is known and the other is not — an
installer built before this app knew there were two, or built by somebody who
set only the first — it keeps its summary but opens itself, and the worker says
*This copy knows the console but not the API*, so nobody goes to check the
address that was already right.

The worker is handed exactly two things: `CONTENTOS_WORKER_TOKEN` and
`CONTENTOS_API_URL`, in its environment — the same two variables the
`npm run worker` line in `docs/DEPLOYING.md` sets by hand, which is the point.
Never the console's address, which it has no use for. And never a file next to
the binary and never an argument, which is why `worker/config.ts` reads them
from the environment in the first place.

### Running it in development

```
npm run desktop          # src-tauri/scripts/dev.mjs, then cargo run
npm run desktop:build    # a release binary
```

It needs the Rust MSVC toolchain and the WebView2 runtime, which every Windows
11 machine already has. `cargo run` is the whole dev loop; `@tauri-apps/cli` is
a devDependency and is needed only to produce an installer, which is the next
section.

`npm run desktop` is a launcher rather than a line in package.json because npm
runs scripts through `sh` on a Mac and `cmd.exe` on Windows, and `VAR=x cargo
run` parses in only one of them. It sets two variables, and anything already
exported wins:

| | |
|---|---|
| `CONTENTOS_CONSOLE_URL` | `http://localhost:3333` — the console, which is Next, on the port `start.sh` uses. The window opens this. |
| `CONTENTOS_API_URL` | `http://localhost:4000` — the API, which is NestJS on its own origin (`lib/api-base.ts`). The worker calls this. |

It prints both on every start with what each is for beside it, because the two
lines look nearly identical and exporting one and not the other gives you a
hybrid — a window on staging beside a worker on localhost.

It is deliberately **not** an `[env]` block in `src-tauri/.cargo/config.toml`,
which would have looked tidier. That applies to every cargo invocation under
`src-tauri`, including the one inside `tauri build` — and since both addresses
are read at compile time with `option_env!`, development addresses would have
been compiled into production installers, silently, which is the exact failure
this is all here to prevent.

First run opens the setup window when it is missing the token or has either
address from nowhere; on a build that carries both, that is the sign-in and
nothing else. After that it opens the console and starts the worker.

**A checkout runs the checkout's worker.** The app looks for `worker/index.ts`
in its own resource directory first — where an installed copy keeps it — and
then upwards from its own executable, which from `src-tauri/target/debug` is
the repository. So a debug build runs the files being edited, with whichever
Node is on PATH, and `npm run worker` in a terminal runs the same command
against the same files. `CONTENTOS_WORKER_DIR` names the folder when it is
somewhere else.

The status is in the tray menu and in the setup window, in these words:
*Connected*, *Cannot reach the server*, *This app's copy of Node is missing*,
*Node is too old*, *This machine's token was refused*, *The worker's files are
missing*, *Not set up yet*, *The worker is not running*. They are separate
states because they are separate actions — one is wifi, one is *Set this
machine up again* in the setup window, one is installing the app again — and a
single "error" would hide all of them behind the same shrug. Anything the worker prints that
this app does not recognise is still shown verbatim, under "What the worker is
saying".

*Cannot reach the server* is the API, not the console — that is the host the
worker calls, and a person reading the tray very often has the console open in
the window behind it, where "cannot reach the console" would be a sentence they
can see is false. The address it is calling is on the setup window above the
message.

Two of those changed meaning when Node moved inside the installer. *This app's
copy of Node is missing* used to mean "this computer has no Node", which was a
download from nodejs.org; on an installed copy it can only mean the
installation is damaged, so it says so and asks for a reinstall. From a
checkout it still gives the developer's sentence, because there the fix really
is to install one. *Node is too old* is now reachable only from a checkout at
all — the Node inside the installer is pinned well above the 22.18 floor.

### Building the installer

```powershell
# PowerShell. Both, every time — the pair from docs/DEPLOYING.md.
$env:CONTENTOS_CONSOLE_URL = "https://content.yourcompany.com"       # APP_HOST
$env:CONTENTOS_API_URL     = "https://api.content.yourcompany.com"   # API_HOST
npm run desktop:installer
```

```bash
export CONTENTOS_CONSOLE_URL=https://content.yourcompany.com
export CONTENTOS_API_URL=https://api.content.yourcompany.com
npm run desktop:installer
```

**Set both addresses first.** They are the only things about the artifact that
cannot be seen by looking at it, and getting one wrong is not felt by the
person building — it is felt by fifteen people individually, later, each of
them typing a URL. `src-tauri/build.rs` emits
`cargo:rerun-if-env-changed` for **each** of them so that changing one actually
rebuilds; without those lines the second installer of the day carries the first
one's addresses and nothing says so. Two lines rather than one because moving
only `API_HOST` is an ordinary thing to do, and that build would otherwise look
fine while carrying the old API.

Building **without** one — or without either — is a **loud warning, not a
refusal**, naming the variables that are missing and what each is for, printed
before the build and again after it, because `tauri build` puts several hundred
lines in between and a warning nobody scrolls back to was not given. When both
are set they are printed the same way, so the artifact's two addresses are on
screen at both ends of the build. Two reasons the absence is not a hard
failure:

- An installer with no addresses still works. It falls back to asking, exactly
  as this app did before, and that is sometimes the right build — a smoke test,
  or a copy for a team whose servers this machine does not know.
- An installer with the **wrong** address is worse than one with none: the
  missing one asks, the wrong one confidently sends a machine at a server that
  is not its team's and folds away the field that would fix it. A hard failure
  is one a hurried person gets past by typing any string that parses, which
  manufactures exactly that.

An address that is set but **malformed** does stop the build, for the same
reason — it can only be a mistake, and it is the wrong-address case. The
message names the variable it means, so nobody goes and corrects the one that
was already right.

**Check what a build actually carries** rather than trusting that a variable
reached the compiler:

```
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture says_which_addresses
```

It prints both `option_env!` values through the same function the app resolves
them with, so a build that prints an address there is a build that ships one.

Two steps, and it is worth knowing which: `src-tauri/scripts/fetch-node.mjs`
puts the pinned Node in `src-tauri/binaries/`, then `tauri build` bundles it.
`src-tauri/scripts/installer.mjs` runs both with this repository's own Node and
its own copy of the Tauri CLI, so neither step depends on a shell resolving a
name; extra arguments are passed through to `tauri build`.
The fetch is a separate step because a 90 MB runtime is not a thing to keep in
a repository — `src-tauri/binaries` is in `.gitignore`, and running the script
is how a fresh clone gets one. Repeating it is cheap: a file that is already
there and already matches its digest is reported and left alone.

```
src-tauri/target/release/bundle/nsis/Content OS_0.1.0_x64-setup.exe    ~25 MB
```

**What is inside it**, all of it landing in the install directory beside the
app, and all of it removed by the uninstaller:

| | |
|---|---|
| `contentos-desktop.exe` | the window, the tray, and the supervisor that runs the worker |
| `node.exe` | Node **24.20.0**, the current LTS, carried as a Tauri `externalBin` |
| `worker/` | every file, byte for byte the ones in this repository |
| `lib/server/tools.ts`, `brain-defs.ts`, `brain-transports.ts` | the only three things `worker/` imports from the rest of the app |
| `package.json` | the repository's, for the version the worker reports and so that Node reads the `.ts` files exactly as `npm run worker` does |

That list is short because the worker imports nothing from `node_modules` —
every import in `worker/*.ts` is a `node:` builtin, another `worker/` file, or
one of those three, and those three import only `node:` builtins and each
other. It is a claim worth re-checking rather than trusting whenever any of
them changes:

```
grep -h "^import" worker/*.ts lib/server/tools.ts lib/server/brain-defs.ts lib/server/brain-transports.ts
```

Nothing is installed and nothing is compiled at install time. Node strips the
types itself, which is the whole reason the worker was written without a build
step in the first place.

**How Node is pinned, and how the bytes are checked.** The version, the URL and
the sha256 are constants in `src-tauri/scripts/fetch-node.mjs`, deliberately
the same convention `worker/setup.ts` uses for yt-dlp, ffmpeg and whisper.cpp:
nothing ever resolves "latest", the plan is printed before anything is fetched,
and the digest being checked is the one in this repository, reviewed with it.
The digests come from `https://nodejs.org/dist/v<version>/SHASUMS256.txt`,
which is the file the Node project signs. Bytes stream into
`node-<triple>.exe.part` while their sha256 and their length are computed on
the way past, and only a file matching **both** is renamed into place — a
captive portal answering with a login page and a `200` would otherwise leave a
plausible-looking `node.exe` for the next build to ship. The name matters as
much: `externalBin` resolves `binaries/node` to
`binaries/node-x86_64-pc-windows-msvc.exe`, and a file under any other name
means an installer that builds cleanly and carries no runtime at all.

Bumping Node is that constant and its digest, and nothing else. Windows x64 and
arm64 are in the catalogue; macOS and Linux are not, for the reason
`worker/setup.ts` gives about ffmpeg — this team runs Windows, and an untested
entry is worse than an absent one.

**Where an installed app writes.** Its working directory is inside Program
Files, where a normal user account cannot create anything, so the app hands the
worker `CONTENTOS_DATA_DIR` and `CONTENTOS_TOOLS_DIR` under
`%APPDATA%\com.contentos.desktop\`. Without that, `cliHome()` in
`lib/server/tools.ts` — which does a `mkdirSync` — would fail on the first job,
on the machine where nobody is reading a terminal. A checkout is deliberately
left alone: `.data/` beside `worker/` is what `npm run worker` uses and what
`npm run worker:setup` fills, and an app quietly preferring somewhere else
would make a bug seen here impossible to reproduce there.

### Signing: decided against, deliberately

**The installer this repository produces is unsigned**, and every build says so
once per file:

```
sign.ps1: no certificate configured, so Content OS_0.1.0_x64-setup.exe is unsigned.
```

**That is the call, and it has been made.** This console is an internal tool
for one team, handed over in person or through a link they already trust, and a
certificate costs money and a verified legal identity to remove a warning that
five people will see once each.

What they will see: SmartScreen shows *"Windows protected your PC"* and hides
the Run button behind **More info**. Whoever hands the installer over should
say so in the same message, because the alternative is somebody deciding on
their own that the file is unsafe.

The moment this stops being right is the moment it leaves the team — a client,
a contractor, anyone downloading it from a page. That is exactly what malware
looks like, and teaching people to click through the warning is teaching them
the wrong reflex. The hook below is what makes changing the answer a
configuration change rather than a rewrite.

Fixing it costs money and identity rather than code: an **OV or EV code signing
certificate** from a certificate authority, issued to a verified legal entity,
roughly $200–$600 a year, and since June 2023 the private key has to live on a
hardware token or in a cloud HSM. An EV certificate skips SmartScreen's
reputation warm-up; an OV one still warns until enough people have installed
it.

The wiring is here and takes environment variables, so a real certificate plugs
in without editing anything that is committed.
`bundle.windows.signCommand` runs `src-tauri/scripts/sign.ps1` over every
binary and the installer, and that script reads:

| | |
|---|---|
| `CONTENTOS_SIGN_THUMBPRINT` | the SHA1 thumbprint of a certificate in this user's certificate store. This is the shape a token or HSM certificate takes — the key never leaves it, so there is no file to point at. |
| `CONTENTOS_SIGN_PFX`, `CONTENTOS_SIGN_PFX_PASSWORD` | …or a `.pfx`, for a certificate that is a file. |
| `CONTENTOS_SIGN_TIMESTAMP_URL` | an RFC3161 timestamp server. Defaults to DigiCert's. Not optional in practice: without a timestamp every signature stops verifying the day the certificate expires, including on installers already downloaded. |
| `CONTENTOS_SIGN_TOOL` | `signtool.exe`, when the newest Windows SDK copy is not where the script looks. |

With none of them set the script leaves the file alone and exits 0, so a build
on a machine with no certificate still produces an installer. With one of them
set and signing failing, the **build fails** — deliberately. An installer that
was not signed must never leave the machine believing it was, because it then
ships looking exactly like the signed one.

A self-signed certificate is not an option and is not offered here. It signs
nothing anybody's computer trusts, it does not remove the SmartScreen warning,
and calling the result "signed" is worse than being plainly unsigned.

### Auto-update: decided against too, and switched off in a way that shows

The team updates by being handed a new installer, which for a handful of people
in one company is a message with a file in it. Hosting an update endpoint,
holding a signing key and keeping a `latest.json` honest is real infrastructure
to save that message.

`tauri-plugin-updater` is registered and `src-tauri/src/updates.rs` does the
check and the install, because the code costs nothing to keep and the answer
changes the day the team is spread across offices. **None of it has been run
end to end** — there is nothing to run it against. The tray item is built only
when an endpoint is configured, so today it does not appear at all rather than
sitting there as a button that does nothing.

Turning it on is two configuration values, not code:

```json
"plugins": { "updater": {
  "endpoints": ["https://…/latest.json"],
  "pubkey": "…the public half of the signing key…"
} }
```

Neither can be invented in a repository. A key pair would have to have its
private half somewhere, and the only somewhere available to a commit is the
commit — at which point anybody who has cloned this can sign an "update" that
every installed copy downloads and runs. So `endpoints` is empty, and while it
is empty the tray item is not built at all: a button that can only ever answer
"this was built without an update server" teaches people that the menu is
decorative.

What a person does once there is somewhere to publish to:

1. `npx tauri signer generate -w ~/.tauri/contentos.key` — and keep the private
   half out of this repository.
2. Put the public half in `plugins.updater.pubkey` and the URL of a
   `latest.json` in `plugins.updater.endpoints`.
3. Build with `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set, and updater artifacts on:
   `npx tauri build --config "{\"bundle\":{\"createUpdaterArtifacts\":true}}"`.
   That produces the installer plus a `.sig` beside it.
4. Serve a `latest.json` naming the version, the notes, the date, and each
   platform's URL and signature. A static file on the console's own server is
   enough; nothing here needs a release service.

What the check does is deliberately small, and worth knowing before it is
switched on. It asks only when somebody clicks, never silently — a machine four
minutes into writing a section should not restart itself because a release
happened. It stops the worker *before* handing over to the installer, because
installing ends this process without going through the exit handler that would
otherwise have killed it, and an orphaned worker would keep claiming jobs and
spending somebody's model subscription while a second one started beside it.
And the answer replaces the menu item's own label, because the window is
usually closed — which is what the tray is for.

### What is still missing

- **The tools installer is not wired to a button.** `npm run worker:setup` is
  still a terminal command, and the audience for this app is exactly the
  audience that should not have to run it. It is also the one thing an
  installed copy cannot do for itself yet: the app points the worker at
  `%APPDATA%\com.contentos.desktop\tools`, and nothing fills it.
- **No start-at-login.** The difference between a machine that is available and
  a machine that is available when somebody remembers.
- **`workers.max_concurrency`, the per-machine tool switches and the machine's
  name are not exposed.** They are environment variables the worker already
  reads, and they belong in the setup window under the sign-in. The name
  matters more than it did: the app now names a new machine after the computer,
  and renaming it means opening Settings → Machines on a console this app's
  whole point is that you may not have.
- **A forced kill still orphans the worker.** Quit and window-close are handled;
  End Task on the app, or a machine shutting down, leaves the Node process to
  its lease. A Windows Job Object would close that hole.
- **Only Windows has been built and run.** The credential store is wired per
  platform in `Cargo.toml` (Keychain on macOS, Secret Service on Linux) so that
  neither silently falls back to keyring's non-persisting mock, and the Node
  catalogue has entries for Windows only, but nothing on either has been
  compiled, let alone used.
