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
];
