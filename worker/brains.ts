import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cliHome, run, toolStatuses, type ToolId } from "../lib/server/tools";
import type { Config } from "./config";
import { Refusal, type Transport } from "./job-types";

/**
 * Reaching a model from this machine.
 *
 * **This is a copy of the four transports in `lib/server/brains.ts`, and it is
 * a copy under protest.** Every flag here is load-bearing and was arrived at
 * the hard way — Windows truncating a long command line without saying so,
 * codex's stdout being a transcript rather than an answer, gemini needing a
 * directory named before it will read a path outside its cwd — so nothing has
 * been "improved" on the way across. Only the reason for a copy is new:
 *
 * `write()` cannot be called from here. It re-derives the transport by calling
 * `brainStatuses()`, which reads settings out of Postgres and probes the
 * machine it is running on — and both halves are wrong on a worker. The
 * transport was decided by the server and travels in the payload; a worker
 * that re-derived it would be free to answer some other way than it was told,
 * which is exactly the silent downgrade `docs/DECISIONS.md` calls worse than
 * an error. The four `via*` functions are private to that module, so there is
 * nothing to import either.
 *
 * The fix, for whoever owns that file: export `viaClaudeCli`, `viaCodexCli`,
 * `viaGeminiCli` and `viaOllama`, and split the brain table out of the module
 * that imports the database. This file then becomes a dispatcher over them.
 */

/**
 * The models, reduced to what a machine needs to run one.
 *
 * A subset of `BRAINS` in `lib/server/brains.ts` — the id, the command and the
 * model — because the rest of that row is editorial (what it is good at, which
 * secret unlocks it) and belongs to the side that chooses. A brain the server
 * names and this table does not have is refused by name rather than guessed
 * at: guessing means running a different model than the run was costed for.
 */
type WorkerBrain = {
  id: string;
  name: string;
  /** The headless command, when it has one — which is also the tool it needs. */
  command?: ToolId;
  /** The model the API path asks for; for Ollama, the only model there is. */
  model: string;
  /** What the CLI is told to use. Absent means "let the CLI pick". */
  cliModel?: string;
};

const BRAINS: WorkerBrain[] = [
  {
    id: "claude-cli",
    name: "Claude",
    command: "claude",
    model: "claude-opus-5",
    cliModel: "claude-opus-5",
  },
  { id: "codex-cli", name: "ChatGPT", command: "codex", model: "gpt-5.1-codex" },
  {
    id: "gemini-cli",
    name: "Gemini",
    command: "gemini",
    model: "gemini-2.5-pro",
    cliModel: "gemini-2.5-pro",
  },
  { id: "ollama", name: "Ollama", model: "llama3.1" },
];

export type BrainCall = {
  brain: string;
  transport: Transport;
  system: string;
  user: string;
  tier: string;
  timeoutMs?: number;
  /** Frames already downloaded, as absolute paths on this machine, in order. */
  imageFiles?: string[];
  /** Whether the server says this machine may grant Claude `Read`. */
  allowFrameRead?: boolean;
};

/**
 * Ask the model, exactly the way the payload said to.
 *
 * The rule that matters here is negative: **there is no fallback.** A worker
 * told `cli` that has no CLI fails; it does not reach for an API key, and
 * there is no key on this machine to reach for. An answer produced some other
 * way than the run asked for, and presented as though it had been, is the
 * failure this whole split was careful to make impossible.
 */
export async function callBrain(
  cfg: Config,
  req: BrainCall,
): Promise<{ text: string; using: string }> {
  const def = BRAINS.find((b) => b.id === req.brain);
  if (!def) {
    throw new Refusal(
      `This machine's worker does not know a model called "${req.brain}". Update the worker on this machine.`,
    );
  }

  const frames = req.imageFiles ?? [];

  /*
   * Ollama is a server on this machine, not a command on it.
   *
   * So its transport is `api` and always was — that is `transportFor()` on the
   * server saying "no command to install", not a downgrade — and it is the one
   * `api` a worker may honour, because the address is local and nothing is
   * spent per token. It is also the one brain that cannot be shown a picture:
   * it is handed a prompt and nothing else, and answering a question about
   * frames from the words alone is the outcome worse than an error.
   */
  if (def.id === "ollama") {
    if (req.transport !== "api") {
      throw new Refusal(
        `The job asked for Ollama over "${req.transport}", and Ollama is only ever reached over its own HTTP API.`,
      );
    }
    if (frames.length) {
      throw new Refusal(
        "Ollama cannot be shown frames, so it must not answer a question about them.",
      );
    }
    return { text: await viaOllama(cfg, def, req), using: def.model };
  }

  if (req.transport !== "cli") {
    /*
     * A key would work here, and that is precisely why it is refused.
     *
     * The API transports stay on the server, deliberately: this split exists
     * so a run costs a subscription somebody already pays for, and a worker
     * that quietly spent money per token when its CLI was missing would do it
     * on the evening nobody was watching.
     */
    throw new Refusal(
      `This machine only writes through a signed-in CLI, and the job asked for ${def.name} over an API key. API keys stay on the server.`,
    );
  }

  const tool = await toolFor(cfg, def);

  if (frames.length && def.id === "claude-cli") {
    /*
     * Two checks, and this is the second one.
     *
     * The server sent `allowFrameRead` from `workers.can_read_frames`; this
     * machine checks its own switch again before granting Claude the `Read`
     * tool, because the grant lands on this filesystem and the person who owns
     * this filesystem gets the last word. Codex and Gemini are handed the
     * picture and granted nothing, so neither comes through here.
     */
    if (req.allowFrameRead !== true) {
      throw new Refusal(
        "Claude can read the frames, but the console has not allowed this machine to open frame files. Turn it on for this machine in Settings → Machines.",
      );
    }
    if (!cfg.allowFrameRead) {
      throw new Refusal(
        "Claude can read the frames, but this worker is not allowed to open files: set CONTENTOS_WORKER_ALLOW_FRAME_READ=1 on this machine and restart it.",
      );
    }
  }

  const text =
    def.id === "claude-cli"
      ? await viaClaudeCli(def, tool, req)
      : def.id === "codex-cli"
        ? await viaCodexCli(def, tool, req)
        : await viaGeminiCli(def, tool, req);

  // What was actually asked for, which is not always `model`: a CLI with no
  // override uses whatever the signed-in account defaults to, and reporting a
  // model name it was never told is how "which model wrote this" stops being
  // answerable.
  return { text, using: def.cliModel ?? "the account's default model" };
}

/**
 * The invocation that answered the probe, or the reason there was none.
 *
 * `tool.command` and `tool.lead` rather than the brand's own command string,
 * for the reason `probe()` records them at all: an install the probe reached a
 * second way — `python -m whisper` is the usual one — is an install this can
 * use, and hard-coding the first name means telling somebody to install what
 * they already have.
 */
async function toolFor(cfg: Config, def: WorkerBrain) {
  const id = def.command!;
  const status = (await toolStatuses()).find((t) => t.id === id);
  if (!status?.present) {
    throw new Refusal(
      `${def.name}'s CLI is not installed on this machine. Install it with: ${status?.install ?? id}`,
    );
  }
  if (cfg.toolsOff.has(id)) {
    throw new Refusal(
      `${id} is switched off on this machine (CONTENTOS_WORKER_TOOLS_OFF), so it must not be used to write.`,
    );
  }
  return status;
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
 * prose. That reads like the site was down, and it was our own spawn saying
 * no. Reading the web is the whole job of the research sections, so those two
 * are granted. Nothing else is: no Bash, no file editing, no writing anywhere
 * on this machine — which matters more here than it did on a server, because
 * this machine is somebody's own desktop.
 */
const CLAUDE_TOOLS = "WebFetch,WebSearch";

/** The tools a content run must never touch, named so the CLI cannot even try. */
const CLAUDE_NO_FILES = "Read,Glob,Grep,Bash,Edit,Write,NotebookEdit";

/**
 * Said to every CLI, after the pack's own system prompt.
 *
 * A CLI is an agent: told to "follow the fixed structure exactly", it went
 * looking for a file called the template, found an empty directory, and put "I
 * couldn't read the repo's script template" at the top of an English script.
 * This says the one thing an agent needs to hear before it starts hunting:
 * there is nothing to find.
 */
const CLI_GUARD = `

EVERYTHING YOU NEED IS IN THIS MESSAGE. There are no files, templates or documents to open — the rules and the structure above are the whole brief. Do not read, search for, or look for anything on disk. Never mention files, directories, permissions, tools, or your own working directory in what you write. Output only the section that was asked for.`;

/** With frames handed over as files, "there is nothing to open" would be a lie. */
const CLI_GUARD_FRAMES = `

Apart from the frame files named below there is nothing to open — the rules above are the whole brief. Never mention files, directories, permissions, tools, or your own working directory in what you write. Output only what was asked for.`;

const cliSystem = (req: BrainCall) =>
  req.system + (req.imageFiles?.length ? CLI_GUARD_FRAMES : CLI_GUARD);

type Tool = Awaited<ReturnType<typeof toolStatuses>>[number];

async function viaClaudeCli(def: WorkerBrain, tool: Tool, req: BrainCall) {
  /*
   * Frames become a list of files to open, and Read is granted for that one
   * call. Both switches have already been checked — the console's and this
   * machine's — because the grant is never made on the strength of the payload
   * alone.
   */
  const files = req.imageFiles ?? [];
  const tools = files.length ? `${CLAUDE_TOOLS},Read` : CLAUDE_TOOLS;
  const user = files.length
    ? `${req.user}

THE FRAMES ARE FILES ON THIS MACHINE. Read every one of them before answering, in this order, and answer from what you SEE in them:
${files.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Read nothing else on this machine — these files and nothing beside them.`
    : req.user;

  /*
   * The system prompt goes in a FILE, never on the command line.
   *
   * It is six to eight thousand characters — the pack's rules, its purpose,
   * the brand voice — and on Windows a command line that long is cut off
   * without a word of warning, so the fixed script format, deep in the rules,
   * never reached the model. `--append-system-prompt-file` carries the whole
   * thing whatever its length, and the file lives in the CLI's own empty
   * directory, which is also where the CLI is started from.
   */
  const systemFile = path.join(
    cliHome(),
    `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.md`,
  );
  await fs.writeFile(systemFile, cliSystem(req), "utf8");

  const { code, out, err } = await run(
    tool.command,
    [
      ...tool.lead,
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
    { input: user, cwd: cliHome(), env: tool.env, timeout: req.timeoutMs ?? 600_000 },
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
 * Belt and braces, and worth keeping on this side of the network: if a
 * disclaimer still comes first it is cut here rather than travelling to the
 * server and being saved as the top of somebody's script.
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
 * is a transcript, not an answer. `-o` is the one that hands back just the
 * final message.
 */
async function viaCodexCli(def: WorkerBrain, tool: Tool, req: BrainCall) {
  const file = path.join(os.tmpdir(), `contentos-codex-${Date.now().toString(36)}.txt`);
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
      tool.command,
      [
        ...tool.lead,
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
        env: tool.env,
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

async function viaGeminiCli(def: WorkerBrain, tool: Tool, req: BrainCall) {
  /*
   * Frames are `@` references, which the CLI resolves before the model sees
   * anything: it opens each path itself and attaches the picture.
   *
   * They go in the -p prompt because that is the text it scans for them, and
   * their folders are added to the workspace so a path outside the directory
   * the CLI happens to be started in is allowed to be read at all — which on a
   * worker it always is, because the frames are in a temp directory and the
   * CLI is started in an empty one.
   */
  const frames = req.imageFiles ?? [];
  const dirs = [...new Set(frames.map((frame) => path.dirname(frame)))];
  const system = frames.length
    ? `${cliSystem(req)}

THE FRAMES ARE THESE FILES, in this order. Look at every one of them, and answer from what you SEE:
${frames.map((frame, i) => `${i + 1}. @${frame}`).join("\n")}`
    : cliSystem(req);

  const { code, out, err } = await run(
    tool.command,
    [
      ...tool.lead,
      ...(def.cliModel ? ["-m", def.cliModel] : []),
      "-o",
      "text",
      ...(dirs.length ? ["--include-directories", dirs.join(",")] : []),
      "-p",
      system,
    ],
    { input: req.user, cwd: cliHome(), env: tool.env, timeout: req.timeoutMs ?? 600_000 },
  );
  if (code === 0 && out.trim()) return out.trim();
  throw new Error(lastUseful(err) || `gemini exited ${code} with no output`);
}

/**
 * The model on this machine, over its own HTTP API.
 *
 * The address comes from this machine's environment rather than from the
 * payload, because the server has none to send that would mean anything here:
 * `ollama-url` was a console setting about one host, and the host that matters
 * is whichever one this laptop can reach. It is named in the failure for the
 * same reason the server names it — "nothing is listening" is only useful with
 * an address attached.
 */
async function viaOllama(cfg: Config, def: WorkerBrain, req: BrainCall) {
  let res: Response;
  try {
    res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
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
  } catch {
    throw new Error(`Nothing is listening on ${cfg.ollamaUrl}`);
  }
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
