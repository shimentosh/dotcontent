/**
 * The models that can be the brain, and how each one is reached.
 *
 * Every brand here used to be a row on the integrations page with nothing
 * behind it: connecting ChatGPT set a boolean, and the next section was still
 * written by Claude. Now each has a real transport, and one that is not
 * reachable says so on the page instead of pretending.
 *
 * Two kinds of transport:
 *
 *  - **CLI** — the vendor's own headless command, already signed in under this
 *    machine's login. No key to store, no key to leak, and it is the right
 *    default for a console that runs on one person's machine.
 *  - **API** — a key, pasted into Settings and kept encrypted. For running this
 *    somewhere the CLI is not installed.
 *
 * A brand is available if either works. The CLI is preferred when both do:
 * a key that costs money should not be spent when a subscription is sitting
 * right there.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * **Nothing here imports anything, and nothing here ever should.** The table
 * used to live in `brains.ts`, which reaches Postgres through `getSecret()`;
 * the worker that actually runs the CLIs is a sidecar on somebody's desktop
 * with no database and no business having one, so it could not import the
 * table and kept a hand-copied subset of it instead. A copied table is a run
 * costed for one model and written by another — the second copy drifts, and it
 * drifts on the half of the system that does the work.
 *
 * One `import` of a repo, a client, or anything that reaches one, puts `pg`
 * back on that desktop and brings the copy back with it. Adding a field to
 * `BrainDef` is free; adding an import is not.
 */

export type Transport = "cli" | "api";

export type BrainDef = {
  id: string;
  name: string;
  vendor: string;
  /** What it is good at, in this app's vocabulary. */
  role: string;
  /** The headless command, when it has one. */
  command?: string;
  /** The model the API path asks for. */
  model: string;
  /**
   * The model the CLI is told to use, when it should be told at all.
   *
   * Absent means "let the CLI pick". That is not laziness: codex rejects a
   * model string its build does not know about, and the names move between
   * releases — a hard-coded one turns an upgrade into a broken brain. The CLI
   * already knows what the signed-in account can reach.
   */
  cliModel?: string;
  /** Which stored secret unlocks the API path. */
  secret?: string;
  /** The env var checked before the stored secret. */
  env?: string;
};

export const BRAINS: BrainDef[] = [
  {
    id: "claude-cli",
    name: "Claude",
    vendor: "Anthropic",
    role: "Writes every section — research, scripts, captions, SEO",
    command: "claude",
    model: "claude-opus-5",
    cliModel: "claude-opus-5",
    secret: "anthropic",
    env: "ANTHROPIC_API_KEY",
  },
  {
    id: "codex-cli",
    name: "ChatGPT",
    vendor: "OpenAI",
    role: "Structured output — titles, hashtags, anything with a fixed shape",
    command: "codex",
    model: "gpt-5.1-codex",
    secret: "openai",
    env: "OPENAI_API_KEY",
  },
  {
    id: "gemini-cli",
    name: "Gemini",
    vendor: "Google",
    role: "Long-context passes — a whole topic's research read at once",
    command: "gemini",
    model: "gemini-2.5-pro",
    cliModel: "gemini-2.5-pro",
    secret: "gemini",
    env: "GEMINI_API_KEY",
  },
  {
    id: "ollama",
    name: "Ollama",
    vendor: "Local",
    role: "A model on this machine — no credits, no network",
    model: "llama3.1",
    secret: "ollama-url",
  },
];

/**
 * The row for an id, or nothing.
 *
 * Nothing, deliberately, rather than a default row: a brain the caller names
 * and this table does not have is refused by name everywhere it is looked up.
 * Guessing means running a different model than the run was costed for, and
 * saying so afterwards.
 */
export const findBrain = (id: string) => BRAINS.find((b) => b.id === id);

/* ── What a request to write looks like ─────────────────────────────────── */

/** A still from a video, handed to a model that can look at it. */
export type WriteImage = {
  /** "image/jpeg" — what the bytes are. */
  mediaType: string;
  /** The bytes, base64, no data: prefix. */
  data: string;
};

export type WriteRequest = {
  system: string;
  user: string;
  tier: string;
  timeoutMs?: number;
  /**
   * Frames to look at, for a request that is about what is on screen.
   *
   * The bytes, for the one transport that takes bytes: the Anthropic API. A
   * CLI is sent `imageFiles` instead. The caller assembles both, because it
   * has no business knowing which brain won.
   */
  images?: WriteImage[];
  /**
   * The same frames, as absolute paths on this machine.
   *
   * A CLI takes its prompt on stdin and has nowhere to put an image, but every
   * one of them can be pointed at a file — each in its own way: Claude opens
   * it with Read, Codex takes it as an attachment (`-i`), Gemini as an `@`
   * reference in the prompt. This is how a still gets read with no API key
   * anywhere.
   */
  imageFiles?: string[];
  /**
   * Whether Claude's CLI may be granted `Read` for this one call.
   *
   * Decided by whoever owns the filesystem the grant lands on, and carried in
   * the request rather than read from a console-wide setting. It used to be
   * `settings.cliCanReadFrames`, one row for the whole install — which was
   * right while the install was one person's laptop and is a hole the moment
   * the CLI runs somewhere else: a teammate flipping a switch in the console
   * would be granting file access on YOUR desktop.
   *
   * The server sends it from `workers.can_read_frames`; the worker checks its
   * own row again before spawning, because the last word belongs to the
   * machine. Absent means no — a grant is never made on the strength of the
   * request alone.
   */
  allowFrameRead?: boolean;
};
