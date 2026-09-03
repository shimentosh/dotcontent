import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cliHome, run, toolStatuses } from "@/lib/server/tools";
import { getSecret, getSettings } from "@/lib/server/repos/settings";

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

export const findBrain = (id: string) => BRAINS.find((b) => b.id === id);

export type BrainStatus = BrainDef & {
  /** Its headless command is installed. */
  cli: boolean;
  cliVersion: string;
  /** A key is set, in the environment or in settings. */
  api: boolean;
  /** Where the key came from, for a page that has to explain itself. */
  apiFrom: "env" | "settings" | "";
  /** Either path works. */
  available: boolean;
  transport: Transport | "";
  /** The model that will actually be asked for. */
  using: string;
  /** Why it cannot be used, when it cannot. */
  reason: string;
};

/** Effort per section tier — the pack says how hard each is worth thinking about. */
const EFFORT: Record<string, "low" | "medium" | "high"> = {
  cheap: "low",
  standard: "medium",
  high: "high",
};

async function keyFor(def: BrainDef) {
  const fromEnv = def.env ? (process.env[def.env] ?? "").trim() : "";
  if (fromEnv) return { key: fromEnv, from: "env" as const };
  const stored = def.secret ? await getSecret(def.secret) : "";
  return stored
    ? { key: stored, from: "settings" as const }
    : { key: "", from: "" as const };
}

/** Every brand, with what is actually true about it on this machine. */
export async function brainStatuses(): Promise<BrainStatus[]> {
  const tools = await toolStatuses();

  return Promise.all(
    BRAINS.map(async (def) => {
      const tool = def.command
        ? tools.find((t) => t.id === (def.command as never))
        : undefined;
      // Ollama has no CLI probe here — it is an HTTP server, and a reachable
      // port is the only thing that means anything about it.
      const cli = def.id === "ollama" ? await ollamaUp() : Boolean(tool?.present);
      const { key, from } = await keyFor(def);
      const api = def.id === "ollama" ? false : Boolean(key);
      const available = cli || api;

      return {
        ...def,
        cli,
        cliVersion: def.id === "ollama" ? (cli ? "localhost:11434" : "") : (tool?.version ?? ""),
        // What will actually be asked for, which is not always `model`: a CLI
        // with no override uses whatever the signed-in account defaults to.
        using:
          available && cli
            ? (def.cliModel ?? "the account's default model")
            : def.model,
        api,
        apiFrom: from,
        available,
        transport: available ? ((cli ? "cli" : "api") as Transport) : "",
        reason: available
          ? ""
          : def.id === "ollama"
            ? "Nothing is listening on localhost:11434"
            : `Install the ${def.command} CLI, or paste a key in Settings → API keys`,
      };
    }),
  );
}

async function ollamaUp() {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── Writing ────────────────────────────────────────────────────────────── */

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
};

/**
 * One section's worth of writing, by whichever brain was chosen.
 *
 * Returns the text as-is. Trimming, parsing and validation belong to whoever
 * asked for it — this only knows how to get words back.
 */
export async function write(brainId: string, req: WriteRequest): Promise<string> {
  const def = findBrain(brainId);
  if (!def) throw new Error(`No model called "${brainId}"`);

  const status = (await brainStatuses()).find((b) => b.id === brainId)!;
  if (!status.available) throw new Error(`${def.name} is not set up: ${status.reason}`);

  /*
   * Can this brain be shown a picture?
   *
   * Over an API, only the Anthropic path sends image blocks — the OpenAI and
   * Gemini fetches below send text, and would answer from the words alone.
   *
   * Over a CLI, all three can look. None of them takes bytes, and all of them
   * take a file: that is what `imageFiles` is for, and it is why reading
   * frames no longer needs a key bought for the purpose. This console is run
   * off signed-in CLIs, so the CLI is the path that has to work.
   *
   * Ollama is the exception — it is handed a prompt here and nothing else — so
   * a request about pictures it cannot see is refused rather than answered
   * from the transcript. An answer invented from the words and presented as
   * though the frames had been read is the one outcome worse than an error.
   */
  const canSeeOnApi = def.id === "claude-cli" && status.transport === "api";
  const canSeeOnCli =
    status.transport === "cli" &&
    def.id !== "ollama" &&
    Boolean(req.imageFiles?.length) &&
    /*
     * Claude's route is the only one that grants a TOOL — Read, for that one
     * call — rather than handing over the file itself, so it stays behind the
     * switch that says so. Codex and Gemini are given the picture and granted
     * nothing.
     */
    (def.id !== "claude-cli" || (await getSettings()).cliCanReadFrames);

  if (req.images?.length && !canSeeOnApi && !canSeeOnCli) {
    throw new Error(
      status.transport === "cli"
        ? def.id === "claude-cli"
          ? `${def.name} can read the frames, but “Let the Claude CLI open frame files” is off in Settings — that switch is what grants it Read for the one call.`
          : `${def.name} cannot be shown frames here.`
        : `${def.name} on an API key cannot be given frames here. Switch it to the CLI in Settings — a signed-in CLI can open the frame files.`,
    );
  }

  if (def.id === "ollama") return viaOllama(def, req);
  if (status.transport === "cli") {
    if (def.id === "claude-cli") return viaClaudeCli(def, req);
    if (def.id === "codex-cli") return viaCodexCli(def, req);
    if (def.id === "gemini-cli") return viaGeminiCli(def, req);
  }

  const { key } = await keyFor(def);
  if (def.id === "claude-cli") return viaAnthropic(def, req, key);
  if (def.id === "codex-cli") return viaOpenAI(def, req, key);
  if (def.id === "gemini-cli") return viaGemini(def, req, key);
  throw new Error(`No way to reach ${def.name}`);
}

/*
 * Every CLI gets the prompt on stdin rather than as an argument.
 *
 * These run to several thousand characters, and Windows has a hard
 * command-line length limit a long research instruction blows straight past —
 * as a truncated argument, not an error, which is the worst way to find out.
 */

/**
 * What the CLI is allowed to do on our behalf.
 *
 * `-p` is non-interactive, so a tool that has not been granted up front cannot
 * ask — it is refused, and the model writes the refusal into the section as
 * prose: "COULD NOT READ THE SITE … Claude requested permissions to use
 * WebFetch, but you haven't granted it yet". That reads like the site was
 * down, and it was our own spawn saying no.
 *
 * Reading the web is the whole job of the research sections, so those two are
 * granted here. Nothing else is: no Bash, no file editing, no writing anywhere
 * on this machine — a content run has no business doing any of it.
 */
const CLAUDE_TOOLS = "WebFetch,WebSearch";

async function viaClaudeCli(def: BrainDef, req: WriteRequest) {
  /*
   * Frames become a list of files to open, and Read is granted for that one
   * call. `write` has already checked that the person switched this on — the
   * grant is never made on the strength of the request alone.
   */
  const files = req.imageFiles ?? [];
  const tools = files.length ? `${CLAUDE_TOOLS},Read` : CLAUDE_TOOLS;
  const user = files.length
    ? `${req.user}

THE FRAMES ARE FILES ON THIS MACHINE. Read every one of them before answering, in this order, and answer from what you SEE in them:
${files
        .map((f, i) => `${i + 1}. ${f}`)
        .join("\n")}

Read nothing else on this machine — these files and nothing beside them.`
    : req.user;

  const { code, out, err } = await run(
    "claude",
    [
      "-p",
      ...(def.cliModel ? ["--model", def.cliModel] : []),
      "--allowedTools",
      tools,
      "--append-system-prompt",
      req.system,
    ],
    { input: user, cwd: cliHome(), timeout: req.timeoutMs ?? 600_000 },
  );
  if (code === 0 && out.trim()) return out.trim();
  throw new Error(err.trim() || `claude exited ${code} with no output`);
}

/**
 * Codex writes its answer to a file rather than to stdout.
 *
 * `codex exec` streams its reasoning and tool calls to the terminal, so stdout
 * is a transcript, not an answer. `--output-last-message` is the one that
 * hands back just the final message.
 */
async function viaCodexCli(def: BrainDef, req: WriteRequest) {
  const file = path.join(
    os.tmpdir(),
    `contentos-codex-${Date.now().toString(36)}.txt`,
  );
  /*
   * Frames are attachments here, not files to go and open.
   *
   * `codex exec -i` puts the picture into the first message itself, so nothing
   * has to be granted and nothing else on this machine is within reach. The
   * flag is repeated per frame rather than given a list: it takes several
   * values, and a list would swallow the `-` that says the prompt is on stdin.
   */
  const files = req.imageFiles ?? [];
  const user = files.length
    ? `${req.user}

THE ${files.length} FRAMES ARE ATTACHED TO THIS MESSAGE, in the order listed above. Answer from what you SEE in them.`
    : req.user;

  try {
    const { code, err } = await run(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--color",
        "never",
        ...(def.cliModel ? ["-m", def.cliModel] : []),
        ...files.flatMap((frame) => ["-i", frame]),
        "-o",
        file,
        "-",
      ],
      {
        input: `${req.system}\n\n---\n\n${user}`,
        cwd: cliHome(),
        timeout: req.timeoutMs ?? 600_000,
      },
    );
    const text = (await fs.readFile(file, "utf8").catch(() => "")).trim();
    if (text) return text;
    throw new Error(lastUseful(err) || `codex exited ${code} with no output`);
  } finally {
    await fs.unlink(file).catch(() => {});
  }
}

async function viaGeminiCli(def: BrainDef, req: WriteRequest) {
  /*
   * Frames are `@` references, which the CLI resolves before the model sees
   * anything: it opens each path itself and attaches the picture.
   *
   * They go in the -p prompt because that is the text it scans for them, and
   * their folders are added to the workspace so a path outside the directory
   * the server happens to be running in is still allowed to be read.
   */
  const frames = req.imageFiles ?? [];
  const dirs = [...new Set(frames.map((frame) => path.dirname(frame)))];
  const system = frames.length
    ? `${req.system}

THE FRAMES ARE THESE FILES, in this order. Look at every one of them, and answer from what you SEE:
${frames.map((frame, i) => `${i + 1}. @${frame}`).join("\n")}`
    : req.system;

  const { code, out, err } = await run(
    "gemini",
    [
      ...(def.cliModel ? ["-m", def.cliModel] : []),
      "-o",
      "text",
      ...(dirs.length ? ["--include-directories", dirs.join(",")] : []),
      "-p",
      system,
    ],
    { input: req.user, cwd: cliHome(), timeout: req.timeoutMs ?? 600_000 },
  );
  if (code === 0 && out.trim()) return out.trim();
  throw new Error(lastUseful(err) || `gemini exited ${code} with no output`);
}

/* ── The APIs, over plain fetch ─────────────────────────────────────────── */

async function viaAnthropic(def: BrainDef, req: WriteRequest, key: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: def.model,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT[req.tier] ?? "medium" },
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            // Frames first, then the question about them: the model reads the
            // content blocks in order, and a question that arrives before the
            // pictures it is about is answered from memory of the words.
            ...(req.images ?? []).map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType,
                data: img.data,
              },
            })),
            { type: "text" as const, text: req.user },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 600_000),
  });

  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `Anthropic returned ${res.status}`);
  if (body.stop_reason === "refusal") {
    throw new Error("the model declined this section");
  }
  return (body.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

async function viaOpenAI(def: BrainDef, req: WriteRequest, key: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: def.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 600_000),
  });

  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `OpenAI returned ${res.status}`);
  return (body.choices?.[0]?.message?.content ?? "").trim();
}

async function viaGemini(def: BrainDef, req: WriteRequest, key: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${def.model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 600_000),
    },
  );

  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `Gemini returned ${res.status}`);
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

async function viaOllama(def: BrainDef, req: WriteRequest) {
  const base = (await getSecret("ollama-url")) || "http://localhost:11434";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: def.model,
      stream: false,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 600_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    message?: { content?: string };
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `Ollama returned ${res.status}`);
  return (body.message?.content ?? "").trim();
}

/** The last line of a CLI's stderr that says something, not a progress bar. */
function lastUseful(err: string) {
  const lines = err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\s*[|/\-\\]\s*$/.test(l));
  return lines.slice(-3).join(" ").slice(0, 300);
}

