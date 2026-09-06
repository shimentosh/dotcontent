import { toolStatuses } from "@/lib/server/tools";
import { getSecret } from "@/lib/server/repos/settings";
import {
  BRAINS,
  findBrain,
  type BrainDef,
  type Transport,
  type WriteRequest,
} from "@/lib/server/brain-defs";
import {
  viaClaudeCli,
  viaCodexCli,
  viaGeminiCli,
  viaOllama,
} from "@/lib/server/brain-transports";

/**
 * What this server can reach, and writing a section with it.
 *
 * The brands, the shape of a request and the four CLI transports are no longer
 * in this file. They were, and a worker on somebody's desktop could not import
 * a line of them — this module reaches Postgres through `getSecret()`, and a
 * sidecar has neither a database nor any business having one — so the worker
 * kept a hand-copied duplicate of both the table and the transports. The
 * transports are the most bug-prone code in the repo and every flag in them is
 * a bug that already came back once; two copies meant fixing one of them.
 *
 * So the declarations live in `brain-defs.ts`, which imports nothing at all,
 * and the CLI transports in `brain-transports.ts`, which imports only
 * `tools.ts`. Both are re-exported below, because "where does `BRAINS` come
 * from" should not become a question anybody has to answer twice.
 *
 * What stays here is everything that needs the database or the network to a
 * paid endpoint:
 *
 *  - `brainStatuses()` — which brands are actually reachable, which needs the
 *    stored keys and a probe of this machine.
 *  - `write()` — the server's own path, still used for the API fallback and
 *    for the researcher.
 *  - the three API transports, which stay next to the keys. They are the one
 *    thing the split must never hand a worker: a machine that could spend
 *    money per token when its CLI was missing would do it on the evening
 *    nobody was watching.
 */

/*
 * Re-exported, not moved out of reach.
 *
 * `services/runs.ts` and `services/researcher.ts` import `findBrain`, `write`
 * and `Transport` from here and have no reason to care that the table now
 * lives one file over. New server code should import from `brain-defs`
 * directly; anything that must ALSO run on a worker has no choice, because an
 * import of this module is an import of `pg`.
 */
export {
  BRAINS,
  findBrain,
  type BrainDef,
  type Transport,
  type WriteImage,
  type WriteRequest,
} from "@/lib/server/brain-defs";

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
    (def.id !== "claude-cli" || req.allowFrameRead === true);

  if (req.images?.length && !canSeeOnApi && !canSeeOnCli) {
    throw new Error(
      status.transport === "cli"
        ? def.id === "claude-cli"
          ? `${def.name} can read the frames, but this machine is not allowed to open frame files — turn that on for it in Settings → Machines. It is per machine because the grant lands on that machine’s disk.`
          : `${def.name} cannot be shown frames here.`
        : `${def.name} on an API key cannot be given frames here. Switch it to the CLI in Settings — a signed-in CLI can open the frame files.`,
    );
  }

  /*
   * The CLI transports are the shared ones, spawned with the brand's own
   * command name — no probed invocation, no extra environment, which is what
   * this path has always done. A worker calls exactly these four functions
   * with its probe's answer instead; that difference is the only one there is,
   * and it is a parameter rather than a second copy of the file.
   */
  if (def.id === "ollama") return viaOllama(def, req, await ollamaUrl());
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
