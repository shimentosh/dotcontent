import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/*
 * Relative imports, not `@/lib/server/...`, and that is not a style slip.
 *
 * The worker imports this file directly and runs it under Node's own type
 * stripping, through the eleven-line resolve hook in `worker/resolve-ts.mjs`.
 * That hook adds a `.ts` to a plain relative specifier and knows nothing about
 * tsconfig `paths` — an `@/` alias here compiles fine, passes review, and is a
 * module-not-found the first time somebody starts the sidecar on their own
 * desktop. Everything this file reaches has to resolve by plain path too.
 */
import type { BrainDef, WriteRequest } from "./brain-defs";
import { cliHome, run } from "./tools";

/**
 * The ways a model is reached from the machine it is installed on.
 *
 * **This is the only copy.** It used to be two: these four functions were
 * private to `lib/server/brains.ts`, which a worker cannot import because it
 * re-derives the transport through `brainStatuses()` → `getSecret()` →
 * Postgres, so the worker carried a verbatim duplicate. Every flag below was
 * arrived at the hard way and every one of them is a bug that already came
 * back once — Windows truncating a long command line without saying so,
 * `codex exec` printing a transcript where the answer should be, gemini
 * refusing a path outside its own directory — which is what makes a second
 * copy the worst kind: fix one and the other stays broken, on the half of the
 * system that actually spawns the CLIs.
 *
 * What is deliberately NOT here: the API transports. `viaAnthropic`,
 * `viaOpenAI` and `viaGemini` stay in `brains.ts`, with the keys, because this
 * module is one import away from a worker — and a worker able to spend money
 * per token when its CLI was missing would do it on the evening nobody was
 * watching. A CLI is a subscription somebody already pays for; that asymmetry
 * is the reason the split exists at all.
 *
 * Nothing here reads a setting and nothing here decides anything. Which brain,
 * which transport, and whether frames may be opened have all been settled by
 * the caller — the server in `write()`, the worker from the payload it was
 * sent and its own switches — and a transport that re-derived any of it would
 * be free to answer some other way than it was told to.
 */

/**
 * How to start a CLI: the command that answers, and what comes before its own
 * arguments.
 *
 * Optional, because the two callers know it two different ways. The server
 * spawns the brand's own command name, which is what it has always spawned.
 * The worker passes the `ToolStatus` its probe produced instead — `command`
 * and `lead` rather than the brand's name, for the reason `probe()` records
 * them at all: an install the probe reached a second way is an install that
 * can be used, and hard-coding the first name means telling somebody to
 * install what they already have. `env` is what the tool needs to run at all;
 * for these three it is usually nothing, and it must still not be dropped.
 */
export type CliSpawn = {
  command: string;
  lead: string[];
  env?: Record<string, string>;
};

const spawnOf = (def: BrainDef, tool?: CliSpawn): CliSpawn =>
  // Only the three CLI brands reach this. Ollama is an HTTP server with no
  // command to start, which is why `command` is optional on the row at all,
  // and `viaOllama` never asks for a spawn.
  tool ?? { command: def.command ?? def.id, lead: [] };

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
 * on this machine — which matters more on a worker than it ever did on a
 * server, because there the machine is somebody's own desktop.
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
export const cliSystem = (req: WriteRequest) =>
  req.system + (req.imageFiles?.length ? CLI_GUARD_FRAMES : CLI_GUARD);

export async function viaClaudeCli(def: BrainDef, req: WriteRequest, tool?: CliSpawn) {
  const cli = spawnOf(def, tool);
  /*
   * Frames become a list of files to open, and Read is granted for that one
   * call. The caller has already checked that somebody switched this on — the
   * server in `write()`, the worker against both the payload and its own
   * environment — because the grant lands on a real filesystem and is never
   * made on the strength of the request alone.
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
   * without a word of warning. So the fixed script format, deep in the rules,
   * never reached the model. The scripts that came out right did so because
   * the CLI, started in the repo, had read lib/packs/website-shorts.ts itself
   * and found the format there; move it to an empty directory and the format
   * vanished. `--append-system-prompt-file` carries the whole thing, whatever
   * its length, and the file lives in the CLI's own empty directory, which is
   * also the directory the CLI is started in.
   */
  const systemFile = path.join(
    cliHome(),
    `system-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.md`,
  );
  await fs.writeFile(systemFile, cliSystem(req), "utf8");

  const { code, out, err } = await run(
    cli.command,
    [
      ...cli.lead,
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
    {
      input: user,
      cwd: cliHome(),
      env: cli.env,
      timeout: req.timeoutMs ?? 600_000,
    },
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
 * still comes first, it is cut before the section is saved — and cut on the
 * machine that spawned the CLI, so it never crosses the network to be stored
 * as the top of somebody's script. Only the leading paragraph, and only when
 * it reads as one of these: a script that mentions "permission" in its own
 * words further down is left alone.
 */
export function scrubPreamble(text: string) {
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
 * is a transcript, not an answer. `-o` (`--output-last-message`) is the one
 * that hands back just the final message.
 */
export async function viaCodexCli(def: BrainDef, req: WriteRequest, tool?: CliSpawn) {
  const cli = spawnOf(def, tool);
  const file = path.join(os.tmpdir(), `dotcontent-codex-${Date.now().toString(36)}.txt`);
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
      cli.command,
      [
        ...cli.lead,
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
        env: cli.env,
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

export async function viaGeminiCli(def: BrainDef, req: WriteRequest, tool?: CliSpawn) {
  const cli = spawnOf(def, tool);
  /*
   * Frames are `@` references, which the CLI resolves before the model sees
   * anything: it opens each path itself and attaches the picture.
   *
   * They go in the -p prompt because that is the text it scans for them, and
   * their folders are added to the workspace so a path outside the directory
   * the CLI happens to be started in is allowed to be read at all — which is
   * always the case on a worker, where the frames are downloaded to a temp
   * directory and the CLI is started in an empty one.
   */
  const frames = req.imageFiles ?? [];
  const dirs = [...new Set(frames.map((frame) => path.dirname(frame)))];
  const system = frames.length
    ? `${cliSystem(req)}

THE FRAMES ARE THESE FILES, in this order. Look at every one of them, and answer from what you SEE:
${frames.map((frame, i) => `${i + 1}. @${frame}`).join("\n")}`
    : cliSystem(req);

  const { code, out, err } = await run(
    cli.command,
    [
      ...cli.lead,
      ...(def.cliModel ? ["-m", def.cliModel] : []),
      "-o",
      "text",
      ...(dirs.length ? ["--include-directories", dirs.join(",")] : []),
      "-p",
      system,
    ],
    {
      input: req.user,
      cwd: cliHome(),
      env: cli.env,
      timeout: req.timeoutMs ?? 600_000,
    },
  );
  if (code === 0 && out.trim()) return out.trim();
  throw new Error(lastUseful(err) || `gemini exited ${code} with no output`);
}

/**
 * The model on this machine, over its own HTTP API.
 *
 * The address is the caller's to supply and never this module's to find: the
 * server reads the `ollama-url` secret, and a worker uses its own
 * `DOTCONTENT_OLLAMA_URL`, because a console setting about one host means
 * nothing on somebody else's laptop and the host that matters is whichever one
 * that laptop can reach. Whoever passes it strips the trailing slash — a
 * stored `http://box:11434/` joined with `/api/chat` makes a double slash,
 * which some proxies in front of Ollama answer with a 404 that reads exactly
 * like Ollama being absent.
 *
 * A rejected fetch is turned into the address that was tried, for the same
 * reason the Integrations page names it: "nothing is listening" is only useful
 * with a host attached, and the raw failure names none.
 */
export async function viaOllama(def: BrainDef, req: WriteRequest, base: string) {
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
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
    throw new Error(`Nothing is listening on ${base}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    message?: { content?: string };
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `Ollama returned ${res.status}`);
  return (body.message?.content ?? "").trim();
}

/** The last line of a CLI's stderr that says something, not a progress bar. */
export function lastUseful(err: string) {
  const lines = err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\s*[|/\-\\]\s*$/.test(l));
  return lines.slice(-3).join(" ").slice(0, 300);
}
