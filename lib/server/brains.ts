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
      const { key, from } = await keyFor(def);
      /*
       * Ollama's address, resolved once for this whole row.
       *
       * `keyFor` has already fetched the `ollama-url` secret — that is what the
       * key IS for this brand — so the base comes off it rather than out of a
       * second `getSecret`. This function runs on every Integrations poll and
       * again inside `write()`; one round-trip is enough.
       */
      const base = def.id === "ollama" ? ollamaBase(key) : "";
      // Ollama has no CLI probe here — it is an HTTP server, and a reachable
      // port is the only thing that means anything about it. It is probed at
      // the configured address, not at localhost: an Ollama on another box was
      // marked unavailable and `write()` refused it before `viaOllama` — which
      // reads the very same secret — was ever given the chance to reach it.
      const cli = def.id === "ollama" ? await ollamaUp(base) : Boolean(tool?.present);
      const api = def.id === "ollama" ? false : Boolean(key);
      const available = cli || api;

      return {
        ...def,
        cli,
        cliVersion:
          def.id === "ollama" ? (cli ? hostOf(base) : "") : (tool?.version ?? ""),
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
            ? // The address that was actually tried, never a hard-coded
              // localhost: someone pointing this at Ollama on another machine
              // has to be able to see WHICH host did not answer.
              `Nothing is listening on ${hostOf(base)}`
            : `Install the ${def.command} CLI, or paste a key in Settings → API keys`,
      };
    }),
  );
}

/** Where Ollama is when nobody has said otherwise. */
const OLLAMA_DEFAULT = "http://localhost:11434";

/**
 * The one place that decides where Ollama is.
 *
 * There used to be two: the probe went to a hard-coded localhost while the
 * transport read the `ollama-url` secret. Point the secret at another box and
 * the probe found nothing at home, `available` came back false, and `write()`
 * threw "Nothing is listening on localhost:11434" before the configured
 * address was tried even once. Everything that needs the address takes it from
 * here, so the two can no longer disagree.
 *
 * The trailing slash is stripped here and nowhere else: a stored
 * `http://box:11434/` and a path joined with `/api/tags` make
 * `http://box:11434//api/tags`, which some proxies in front of Ollama answer
 * with a 404 that reads exactly like Ollama being absent.
 */
const ollamaBase = (stored: string) =>
  (stored.trim() || OLLAMA_DEFAULT).replace(/\/+$/, "");

/** The same secret, for the paths that have not already read it. */
const ollamaUrl = async () => ollamaBase(await getSecret("ollama-url"));

/**
 * Host and port, for saying which address answered or did not.
 *
 * A URL is what is stored and what is fetched; a person reading the
 * Integrations page wants the machine, not the scheme. A base that will not
 * parse is shown whole rather than swallowed — a typo in the setting is
 * exactly what someone reading this line is trying to find.
 */
function hostOf(base: string) {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/**
 * A reachable Ollama, at the address it is actually configured at.
 *
 * The 1500ms cap stays: this runs on the Integrations page, which polls, and a
 * host that is switched off does not refuse a connection — it drops it, and
 * the fetch would sit there until the OS gave up and the whole page with it.
 */
async function ollamaUp(base: string) {
  try {
    const res = await fetch(`${base}/api/tags`, {
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

/**
 * The tools a content run must never touch, named so the CLI cannot even try.
 *
 * `--allowedTools` says what is granted; an agentic CLI still ATTEMPTS a
 * denied tool, is refused, and then writes a sentence about the refusal into
 * the script. Disallowing the filesystem outright removes the attempt.
 * Read is left off the list only when frames are handed over as files.
 */
const CLAUDE_NO_FILES = "Read,Glob,Grep,Bash,Edit,Write,NotebookEdit";

/**
 * Said to every CLI, after the pack's own system prompt.
 *
 * A CLI is an agent: told to "follow the fixed structure exactly", it went
 * looking for a file called the template, found an empty directory, and put
 * "I couldn't read the repo's script template" at the top of an English
 * script. The API transports never do this — they have no tools — so this is
 * appended on the CLI paths only, and it says the one thing an agent needs
 * to hear before it starts hunting: there is nothing to find.
 *
 * With frames handed over as files, "there is nothing to open" would be a
 * lie, so that run gets the shorter version: read those, and only those.
 */
const CLI_GUARD = `

EVERYTHING YOU NEED IS IN THIS MESSAGE. There are no files, templates or documents to open — the rules and the structure above are the whole brief. Do not read, search for, or look for anything on disk. Never mention files, directories, permissions, tools, or your own working directory in what you write. Output only the section that was asked for.`;

const CLI_GUARD_FRAMES = `

Apart from the frame files named below there is nothing to open — the rules above are the whole brief. Never mention files, directories, permissions, tools, or your own working directory in what you write. Output only what was asked for.`;

/** The system prompt as a CLI hears it. */
const cliSystem = (req: WriteRequest) =>
  req.system + (req.imageFiles?.length ? CLI_GUARD_FRAMES : CLI_GUARD);

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

  /*
   * The system prompt goes in a FILE, never on the command line.
   *
   * It is six to eight thousand characters — the pack's rules, its purpose,
   * the brand voice — and on Windows a command line that long is cut off
   * without a word of warning. So the fixed script format, deep in the rules,
   * never reached the model. The scripts that came out right did so because
   * the CLI, started in the repo, had read lib/packs/enbn-website.ts itself
   * and found the format there; move it to an empty directory and the format
   * vanished. `--append-system-prompt-file` carries the whole thing, whatever
   * its length, and the file lives in the CLI's own empty directory.
   */
  const systemFile = path.join(
    cliHome(),
    `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.md`,
  );
  await fs.writeFile(systemFile, cliSystem(req), "utf8");

  const { code, out, err } = await run(
    "claude",
    [
      "-p",
      ...(def.cliModel ? ["--model", def.cliModel] : []),
      "--allowedTools",
      tools,
      ...(files.length ? [] : ["--disallowedTools", CLAUDE_NO_FILES]),
      /*
       * Append to the CLI's system prompt; do not replace it. Replacing it
       * (`--system-prompt`) was tried: the model never finished, because the
       * default prompt is also what tells print mode how to end.
       */
      "--append-system-prompt-file",
      systemFile,
    ],
    { input: user, cwd: cliHome(), timeout: req.timeoutMs ?? 600_000 },
  ).finally(() => fs.unlink(systemFile).catch(() => {}));
  if (code === 0 && out.trim()) return scrubPreamble(out.trim());
  throw new Error(err.trim() || `claude exited ${code} with no output`);
}

/** The ways a CLI talks about itself instead of writing the section. */
const PREAMBLE =
  /AGENTS\.md|working director|read scope|I (couldn't|can't|cannot|could not) (read|open|access)|this session has no|no file-read|shell tools/i;

/**
 * Drop a first paragraph that is about the tool rather than the topic.
 *
 * Belt and braces. The guard tells the CLI there is nothing to open and the
 * dynamic sections that made it think otherwise are gone; if a disclaimer
 * still comes first, it is cut before the section is saved. Only the leading
 * paragraph, and only when it reads as one of these — a script that mentions
 * "permission" in its own words further down is left alone.
 */
function scrubPreamble(text: string) {
  const parts = text.split(/\n\s*\n/);
  if (parts.length > 1 && PREAMBLE.test(parts[0]) && !parts[0].startsWith("#")) {
    return parts.slice(1).join("\n\n").trim();
  }
  return text;
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
        input: `${cliSystem(req)}\n\n---\n\n${user}`,
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
    ? `${cliSystem(req)}

THE FRAMES ARE THESE FILES, in this order. Look at every one of them, and answer from what you SEE:
${frames.map((frame, i) => `${i + 1}. @${frame}`).join("\n")}`
    : cliSystem(req);

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
  const base = await ollamaUrl();
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

