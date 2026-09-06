/**
 * The schema, as an ordered list of migrations.
 *
 * A list rather than one CREATE script: the database holds real work after the
 * first run, so the shape has to be able to move without the data being thrown
 * away and reseeded. A `migrations` table records which have run; `migrate()`
 * applies whatever is left, each in its own transaction.
 *
 * Modelled on the working system: Project -> Series -> Content -> Output there
 * is Workspace -> Series -> Topic -> Run -> Section here. The names changed
 * because this app calls them what you call them; the shape did not.
 *
 * Packs come from two places on purpose. The shipped ones stay in code
 * (`lib/packs`), exactly as recipes do in the working system: a tuned prompt is
 * versioned with the code that reads it, and moving it into a table would make
 * every instruction edit a data migration. Packs written in the builder are
 * rows — they are the user's, not the release's, and they have to survive a
 * deploy. Both resolve through the same lookup, so a run cannot tell them
 * apart.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "0001_model",
    sql: `
    CREATE TABLE workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      handle      TEXT NOT NULL DEFAULT '',
      channel     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'Planning',
      goal        TEXT NOT NULL DEFAULT '',
      brand_voice TEXT NOT NULL DEFAULT '',
      -- jsonb, not a join table: nothing queries by language, and "Bangla,
      -- English" does not need three files of plumbing to store.
      langs       JSONB NOT NULL DEFAULT '[]'::jsonb,
      tint        TEXT NOT NULL DEFAULT '',
      photo       TEXT,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE series (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      context      TEXT NOT NULL DEFAULT '',
      pack         TEXT NOT NULL DEFAULT '',
      -- The counter lives here rather than being derived from the topics:
      -- deleting part 6 must not hand part 6 to the next thing written.
      next_part    INTEGER NOT NULL DEFAULT 1,
      position     INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX series_workspace ON series(workspace_id);

    CREATE TABLE topics (
      id         TEXT PRIMARY KEY,
      series_id  TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      part       INTEGER,
      context    TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'idea',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX topics_series ON topics(series_id);

    CREATE TABLE runs (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      -- Nulled rather than cascaded: the content outlives the idea that started
      -- it, and deleting a topic must not delete the work it produced.
      topic_id     TEXT REFERENCES topics(id) ON DELETE SET NULL,
      pack_slug    TEXT NOT NULL,
      title        TEXT NOT NULL,
      inputs       JSONB NOT NULL DEFAULT '{}'::jsonb,
      brand_voice  TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX runs_workspace ON runs(workspace_id);
    CREATE INDEX runs_topic ON runs(topic_id);

    CREATE TABLE run_sections (
      run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL,
      title      TEXT NOT NULL,
      position   INTEGER NOT NULL,
      state      TEXT NOT NULL DEFAULT 'queued',
      content    TEXT NOT NULL DEFAULT '',
      error      TEXT NOT NULL DEFAULT '',
      ms         INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, section_id)
    );
    `,
  },

  {
    /*
     * Packs written in the builder.
     *
     * Stored in the runtime shape rather than the builder's, so `findPack` can
     * hand a row straight to the run engine. The builder's own fields (purpose,
     * audience, context) sit alongside because they are what the person wrote;
     * the rules text the model actually receives is assembled from them.
     */
    name: "0002_packs",
    sql: `
    CREATE TABLE packs (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version     INTEGER NOT NULL DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'DRAFT',
      purpose     TEXT NOT NULL DEFAULT '',
      audience    TEXT NOT NULL DEFAULT '',
      context     TEXT NOT NULL DEFAULT '',
      rules       TEXT NOT NULL DEFAULT '',
      inputs      JSONB NOT NULL DEFAULT '[]'::jsonb,
      sections    JSONB NOT NULL DEFAULT '[]'::jsonb,
      outputs     JSONB NOT NULL DEFAULT '[]'::jsonb,
      position    INTEGER NOT NULL DEFAULT 0,
      -- When a run last chose it. The packs list shows "USED 2h ago", and that
      -- was the last number on that screen nobody was keeping true.
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Built-in packs have no row, so their last-used time needs somewhere to
    -- live. One row per slug, written whether the pack is code or data.
    CREATE TABLE pack_usage (
      slug    TEXT PRIMARY KEY,
      used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      runs    INTEGER NOT NULL DEFAULT 0
    );
    `,
  },

  {
    /*
     * Who you are, what you have set, and what a run was given to watch.
     *
     * Three things at once because they arrived together and share one shape:
     * rows that belong to the person rather than to the content. Settings are
     * one row per key so a new preference is an INSERT rather than a column.
     */
    name: "0003_account",
    sql: `
    CREATE TABLE users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      -- scrypt, as "salt:hash" in hex. Never the password, never reversible,
      -- and never sent back to the browser in any form.
      password_hash TEXT NOT NULL,
      -- The first account made. It is the one that cannot be deleted, because
      -- a console with no owner is a console nobody can get into.
      owner         BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ
    );

    CREATE TABLE sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- What the browser was told about itself, so a stolen cookie used from
      -- somewhere else is at least visible in the session list.
      agent      TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX sessions_user ON sessions(user_id);

    CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    /*
     * A source video, and what was pulled out of it.
     *
     * The pack's first two sections are written for someone who has watched
     * the reel: they ask for on-screen text, a browser address bar, a spoken
     * domain. That is yt-dlp, ffmpeg and a transcriber, and this is where what
     * they produce is kept so a rewrite does not download the video again.
     */
    CREATE TABLE sources (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      url          TEXT NOT NULL,
      state        TEXT NOT NULL DEFAULT 'queued',
      error        TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      uploader     TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      duration     INTEGER,
      thumbnail    TEXT NOT NULL DEFAULT '',
      -- Everything yt-dlp reported, kept whole: the fields worth showing today
      -- are columns, and the rest is here for the day one more is worth it.
      meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
      transcript   TEXT NOT NULL DEFAULT '',
      frames       JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX sources_workspace ON sources(workspace_id);

    -- A run may have been given a video to work from. Nulled rather than
    -- cascaded: deleting the download must not delete what was written from it.
    ALTER TABLE runs ADD COLUMN source_id TEXT REFERENCES sources(id) ON DELETE SET NULL;
    `,
  },

  {
    /*
     * Whether a series numbers its parts.
     *
     * Some shelves are a run of parts — "Powerful websites you should know,
     * part 7" — and the number is half the title. Others are a pile of ideas
     * with no order at all, and stamping "part 3" on one is a promise about a
     * part 2 that was never written. It was true for every series before this,
     * because the counter had no off switch.
     *
     * Defaults to true: every series that already exists was numbered, and a
     * migration must not renumber anyone's shelf on the way past.
     */
    name: "0004_series_numbering",
    sql: `
    ALTER TABLE series ADD COLUMN numbered BOOLEAN NOT NULL DEFAULT true;

    /*
     * The counter never goes backwards.
     *
     * Enforced here rather than trusted to the code that writes it: a part
     * number that gets reused is two topics called part 6, and by the time you
     * notice, both are published. Deleting part 6 leaves a gap, and a gap is
     * honest — it says something was there.
     */
    CREATE OR REPLACE FUNCTION series_next_part_forward()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.next_part < OLD.next_part THEN
        NEW.next_part := OLD.next_part;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER series_next_part_forward_trigger
      BEFORE UPDATE ON series
      FOR EACH ROW
      EXECUTE FUNCTION series_next_part_forward();
    `,
  },

  {
    /*
     * A pack no longer carries an audience or a context of its own.
     *
     * Both described the BRAND, not the recipe. Who is watching is the same
     * for every pack a workspace runs, and the workspace already carries it:
     * `brand_voice` is prepended to every system prompt before anything else.
     * Two places to write down one fact is one place to write it down wrong,
     * and the pack's copy would be the stale one the moment a second brand
     * ran the same pack.
     *
     * `purpose` stays. What a pack is trying to achieve is genuinely a
     * property of the recipe: "this has to earn a save and a comment" is about
     * the format, not about whose account it is.
     */
    name: "0005_pack_brief_trim",
    sql: `
    ALTER TABLE packs DROP COLUMN audience;
    ALTER TABLE packs DROP COLUMN context;
    `,
  },
  {
    /*
     * Used / Ready / Ignored, kept.
     *
     * The pill on the content list wrote to a Map in the browser, so marking
     * six topics Used and reloading put all six back to Ready. It is its own
     * column rather than topics.status because that one already answers a
     * different question — idea, generating, done, which is where the topic is
     * in its life. This is what you decided about what came out.
     *
     * On the run rather than the topic: a topic can be written more than once,
     * and "I used that one" is about a particular piece of content, not about
     * the idea behind it.
     */
    name: "0006_run_decision",
    sql: `
    ALTER TABLE runs ADD COLUMN decision TEXT NOT NULL DEFAULT 'ready';
    ALTER TABLE topics ADD COLUMN decision TEXT NOT NULL DEFAULT 'ready';
    `,
  },
  {
    /*
     * What the number is CALLED.
     *
     * A series counted its topics and every screen printed "Part 7" over the
     * result, because that is what the one shipped template says. A shelf of
     * daily posts is on Day 7; a podcast is on Episode 7; a countdown is on
     * number 7 and wants no word at all. The count was never the disagreement.
     *
     * Empty means the number stands on its own — that is a real choice, not a
     * missing value, which is why the column is NOT NULL with a default of
     * 'Part' and empty is allowed.
     */
    name: "0007_part_label",
    sql: `
    ALTER TABLE series ADD COLUMN part_label TEXT NOT NULL DEFAULT 'Part';
    `,
  },
  {
    /*
     * When a person last edited a section by hand.
     *
     * Content was read-only once written: the only way to change a line was to
     * run the section again and hope the next attempt kept what was already
     * right. A timestamp rather than a flag, because "edited" is a thing that
     * happened at a time, and the reader wants to say when.
     *
     * NULL means the model's own words, untouched — which is what running the
     * section again puts it back to.
     */
    name: "0008_section_edited",
    sql: `
    ALTER TABLE run_sections ADD COLUMN edited_at TIMESTAMPTZ;
    `,
  },
  {
    /*
     * Where a series' brief comes from.
     *
     * It could only ever come from the box: a shelf was about whatever four
     * words you had typed into it, forever, and nothing in the app had ever
     * read a page off the web. `brief_from` says which tab is in use and
     * `source` holds what came back, whole, in the shape the fetcher returns.
     *
     * One JSONB column rather than six flat ones — url, kind, title, items,
     * text, when — because they are only ever written together, by one fetch,
     * and read together, by one panel. Six columns would be six chances for
     * five of them to be right.
     */
    name: "0009_series_source",
    sql: `
    ALTER TABLE series ADD COLUMN brief_from TEXT NOT NULL DEFAULT 'typed';
    ALTER TABLE series ADD COLUMN source JSONB;
    `,
  },
  {
    /*
     * Invitations, so a second person can exist.
     *
     * Signup closes the moment the console has an owner, which is right for a
     * thing on one laptop and useless the moment it is shared: an employee had
     * no way in at all. An invite is a token the owner hands out; signing up
     * with it is the only way past the closed door, and the row records who
     * opened it so a link cannot be passed around and used twice.
     *
     * Deliberately not a user row created up front with a password somebody
     * else chose — the person who will use the account should be the only one
     * who ever types its password.
     */
    name: "0010_invites",
    sql: `
    CREATE TABLE invites (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      used_by    TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX invites_open ON invites(used_at) WHERE used_at IS NULL;
    `,
  },

  {
    /*
     * Tools as rows, so a workspace can have its own.
     *
     * They were a constant in lib/tools.ts: every workspace saw the same list,
     * and the list could only change in a release. A workspace is a channel
     * with its own job — the one that researches Bangla reels does not want
     * the same bench as the one writing English blog posts — so which tools
     * appear where is the user's call, and a category is how a bench of a
     * dozen stays readable.
     *
     * `scope` is 'all' or 'chosen'. All is the default because a new tool that
     * appears nowhere until it is assigned is a tool nobody finds; `chosen`
     * reads its workspaces from tool_workspaces.
     */
    name: "0011_tools",
    sql: `
    CREATE TABLE tools (
      slug        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      tagline     TEXT NOT NULL DEFAULT '',
      takes       TEXT NOT NULL DEFAULT '',
      returns     TEXT NOT NULL DEFAULT '',
      feeds       TEXT NOT NULL DEFAULT '',
      runtime     TEXT NOT NULL DEFAULT '',
      category    TEXT NOT NULL DEFAULT 'Research',
      scope       TEXT NOT NULL DEFAULT 'all',
      enabled     BOOLEAN NOT NULL DEFAULT true,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE tool_workspaces (
      tool_slug    TEXT NOT NULL REFERENCES tools(slug) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      PRIMARY KEY (tool_slug, workspace_id)
    );
    CREATE INDEX tool_workspaces_workspace ON tool_workspaces(workspace_id);
    `,
  },

  {
    /*
     * A source can be a file somebody uploaded, not only a link.
     *
     * `url` was NOT NULL and the only way in, so a reel saved to disk — the
     * common case for footage that was never posted anywhere — had nothing to
     * be ingested as. An upload gets a `file:` url of its own id, which keeps
     * the "already fetched?" lookup working without a second code path.
     */
    name: "0012_source_uploads",
    sql: `
    ALTER TABLE sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'url';
    ALTER TABLE sources ADD COLUMN filename TEXT NOT NULL DEFAULT '';
    `,
  },

  {
    /*
     * What the researcher found, kept.
     *
     * The answer was returned to the browser and nowhere else: a reload, a
     * click on Tools, a closed tab — and several minutes of watching, plus the
     * ideas it produced, were gone with no way back to them. The download had
     * always been kept; the reading of it had not.
     *
     * On the source rather than in a table of its own, because it is one
     * answer about one video: researching it again replaces the answer, which
     * is what "again" means. `researched_at` is separate from `updated_at`,
     * which moves whenever a frame is cut.
     */
    name: "0013_source_research",
    sql: `
    ALTER TABLE sources ADD COLUMN research JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sources ADD COLUMN researched_at TIMESTAMPTZ;
    `,
  },

  {
    /*
     * Who started a run.
     *
     * Nothing recorded it. On one laptop that was the same person every time,
     * so the column would have been a joke; on a server it is the only way to
     * answer the question DEPLOYING.md poses — a run against an API key costs
     * real money, and "who ran what" had no answer anywhere in the database.
     * It is also the groundwork for several people on several machines driving
     * runs against one of these.
     *
     * Nulled rather than cascaded, for the reason `topic_id` above is: the
     * content outlives the person who asked for it, and an employee leaving
     * must not take a month of scripts with them. `invites.created_by` is the
     * same pattern for the same reason.
     *
     * Nullable with no backfill: every run that already exists was started by
     * somebody the database cannot name, and guessing — the owner, the first
     * user — would put a name on work as if it were known.
     */
    name: "0014_run_author",
    sql: `
    ALTER TABLE runs ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
    CREATE INDEX runs_created_by ON runs(created_by);
    `,
  },

  {
    /*
     * Workers, and the queue they claim from.
     *
     * Everything before this migration assumed one process: the box that
     * answered HTTP was the box with `claude`, `yt-dlp` and `whisper` on it,
     * so "is this section being written?" could be a Set in that process's
     * memory. The moment the model runs on somebody's laptop that assumption
     * is false, and the two things holding it together become bugs — a lock
     * that only locks one replica, and a boot sweep that steals work a
     * machine is four minutes into. `docs/WORKER.md` has the argument; these
     * two tables are it, written down.
     *
     * A `workers` row is one machine with one signed-in CLI on it. A `jobs`
     * row is one unit of work the server has already finished thinking about:
     * finished text and a command, never a pack or a rule, because business
     * logic shipped to fifteen desktops needs fifteen updates to change a
     * prompt, and the prompt changes weekly.
     */
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

  {
    /*
     * The three global settings that could never be global.
     *
     * `settings` is one row per key for the whole console, which was exactly
     * right for one person on one laptop and is three separate wrong things
     * for a team on a server. Each of these moves to the thing it is actually
     * a fact about — see docs/WORKER.md, "settings.brain is a singleton and
     * must be scoped".
     *
     * `enabled` and `cliCanReadFrames` need no new column: `workers.enabled`
     * and `workers.can_read_frames` arrived with 0015 and a machine reports
     * or is granted them per row. They are only deleted here.
     */
    name: "0016_scoped_settings",
    sql: `
    -- Which model writes is an editorial decision about the CONTENT, so it
    -- sits beside brand_voice, which is scoped for exactly that reason and is
    -- already read by startRun off the workspace rather than off the request.
    -- A workspace writing Bangla scripts and one writing SEO copy may want
    -- different models, and neither should change under the other because
    -- somebody switched a global.
    ALTER TABLE workspaces ADD COLUMN brain TEXT NOT NULL DEFAULT 'claude-cli';

    /*
     * Carry the global onto every workspace that exists.
     *
     * Without this, upgrading silently retunes every run in the database to
     * the default: somebody who switched the console to Gemini months ago
     * would press Run and get Claude, with nothing on any screen saying the
     * setting had moved. The value is a jsonb string, so #>> '{}' is what
     * takes the text out of it without the quotes coming along. COALESCE
     * covers a console that never wrote the row at all, which is every
     * install that left the picker alone.
     */
    UPDATE workspaces SET brain = COALESCE(
      (SELECT value #>> '{}' FROM settings WHERE key = 'brain'), 'claude-cli');

    /*
     * And delete all three globals, rather than leaving them to rot.
     *
     * getSettings() only copies keys it already knows, so a leftover row is
     * invisible today — which is the danger. A future setting that reuses one
     * of these names would come up holding a value somebody set for a
     * different purpose in a different world, and nothing would say so.
     *
     * cliCanReadFrames in particular must NOT be carried anywhere. It
     * defaults ON here and workers.can_read_frames defaults OFF, deliberately:
     * it grants the Read tool on one specific person's filesystem, and
     * enrolling a machine must not inherit a permission somebody granted on a
     * different one. Dropping the value on the floor is the migration doing
     * its job.
     */
    DELETE FROM settings WHERE key IN ('brain', 'enabled', 'cliCanReadFrames');
    `,
  },

  {
    /*
     * One sign-in, carried from the desktop app into its webview.
     *
     * The app signs in from Rust and holds the session as a header credential;
     * the console window beside it is an ordinary navigation to somebody
     * else's origin and carries no cookie. So a teammate signed in twice on
     * first setup — once in the setup window, once in the console — for the
     * same account, on the same machine, a second apart.
     *
     * A hand-off code is the bridge. The app mints one over the session it
     * already holds, the webview is opened at `/api/auth/adopt?code=…`, and
     * that route spends the code and sets the cookie the ordinary way. See
     * "Hand-off" in lib/server/auth.ts for the rules and docs/WORKER.md for
     * what this deliberately is not.
     */
    name: "0017_handoff_codes",
    sql: `
    CREATE TABLE handoffs (
      -- The sha256 of the code, never the code. For the two minutes it lives
      -- a hand-off code IS a session: whoever holds it can spend it and be
      -- signed in as that person. Storing it raw would make a database dump a
      -- list of live logins, which is the same argument workers.token_hash
      -- makes about a machine's token, and it is worth more here because the
      -- thing on the other end is a person's whole console.
      code_hash  TEXT PRIMARY KEY,

      -- The session this code hands over. NOT the user: spending a code must
      -- not mint a second session, or one sign-in would leave two rows and
      -- revoking either would leave the other alive. Cascaded, so signing out
      -- — or Settings → Team removing somebody — takes any un-spent codes
      -- with it rather than leaving a live one pointing at a dead session.
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- Minutes, not days. A code that outlives the navigation it was minted
      -- for is a session sitting in a URL — in a webview's history, in a
      -- proxy log, in whatever a screen recorder caught — waiting to be
      -- replayed.
      expires_at TIMESTAMPTZ NOT NULL,

      -- Set by the UPDATE that spends it, so single use is decided by
      -- Postgres rather than by a read followed by a write that two
      -- navigations can interleave. The row is kept rather than deleted so a
      -- replay is a row that says "already used" instead of a row that is
      -- missing for two different reasons.
      used_at    TIMESTAMPTZ
    );

    -- The sweep's index. Spent and expired rows are dead weight and are
    -- cleared whenever a code is minted, and that pass must not become a
    -- sequential scan of every hand-off this console has ever made.
    CREATE INDEX handoffs_sweep ON handoffs(expires_at);
    `,
  },
];
