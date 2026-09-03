import { write } from "@/lib/server/brains";
import { getSettings } from "@/lib/server/repos/settings";
import { getSource, updateSource } from "@/lib/server/repos/sources";
import { frameBytes, framePath } from "@/lib/server/services/ingest";

/**
 * Watching a reel, so a person does not have to.
 *
 * The pack's Identify and Research sections are written for someone who has
 * seen the video. This is that someone: the frames chosen on screen go to the
 * model as pictures, the transcript and the platform's own caption go with
 * them, and what comes back is which site the reel is about and a handful of
 * topics worth making about it.
 *
 * The frames are the point. A transcript says "go to this website" and names
 * nothing; the address bar in frame four says remove.bg. Asking for the answer
 * without the pictures is how you get a confident guess, which is why
 * `brains.write` refuses images on a transport that cannot carry them rather
 * than quietly dropping them.
 */

export class ResearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ResearchIdea = {
  /** What the topic would be called. */
  title: string;
  /** The one thing it shows, in a sentence. */
  angle: string;
  /** Why it is worth making — the save or the comment it is going for. */
  why: string;
};

export type ResearchResult = {
  sourceId: string;
  /** The site the video is about, as far as the frames show. */
  site: { name: string; url: string; confidence: "high" | "medium" | "low" };
  /** What the site does, in the words the video makes it look like. */
  does: string;
  /** What actually happens on screen, step by step. */
  shows: string[];
  /** Claims to check before anything is written on top of them. */
  verify: string[];
  ideas: ResearchIdea[];
  /** Which frames were looked at, in seconds. */
  readFrames: number[];
  /** The model's whole answer, kept for when the parse is thin. */
  raw: string;
};

/**
 * The answer's shape, written once.
 *
 * It goes in the system prompt AND at the end of the thing being answered —
 * see the last line of `context` — so it is defined here rather than typed
 * twice. Two copies of a schema is how a parser starts reading a field the
 * prompt stopped asking for.
 */
const SHAPE = `{
  "site": { "name": "", "url": "", "confidence": "high | medium | low" },
  "does": "one or two sentences on what the site is for, from what the video shows",
  "shows": ["what happens on screen, one short line per visible step"],
  "verify": ["claims a person should confirm on the site before writing: free or paid, sign-up, limits"],
  "ideas": [
    {
      "title": "what the topic would be called, in the words someone would search",
      "angle": "the one thing this video would show, in a sentence",
      "why": "the save or the comment it is going for"
    }
  ]
}`;

const SYSTEM = `You are a content researcher for a Bangla + English short-form channel.

You are given stills from one video and, where it exists, its transcript and the caption the platform carried. Your job is to work out WHICH WEBSITE OR TOOL the video is about, what it visibly does, and what is worth making about it.

READ THE FRAMES. The address bar, the logo in the corner, the on-screen text and the buttons being clicked are the evidence. A transcript that says "go to this website" names nothing — the frames do. If a domain is spoken aloud in the transcript ("remove dot bg"), reconstruct it, and confirm it against what is on screen where you can.

NEVER INVENT. If the frames and the words do not identify a site, say so with confidence "low" and leave the url empty. A wrong site sends the whole production down the wrong road, and it is expensive to notice later.

Answer with JSON and nothing else — no prose before it, no code fence around it:

${SHAPE}

Give between 4 and 8 ideas, each a DIFFERENT video rather than the same one reworded: a different benefit, a different audience, a different moment of the tool. Never name the site in an idea title — the channel withholds the link deliberately and the name gives away the answer the comment is meant to buy.`;

/** The JSON out of an answer that may be wrapped in prose or a code fence. */
function parse(text: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const lines = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/**
 * Research one source.
 *
 * `frames` are file names off the source row — whichever ones were ticked on
 * screen. None ticked means every frame it has: the tool is still useful when
 * nobody wants to choose, and choosing is an optimisation of cost, not a
 * requirement.
 */
export async function research(input: {
  sourceId: string;
  frames?: string[];
  /** Anything the person knows that the video does not show. */
  note?: string;
}): Promise<ResearchResult> {
  const source = await getSource(input.sourceId);
  if (!source) throw new ResearchError("No such video", 404);
  if (source.state === "fetching") {
    throw new ResearchError("That video is still being fetched", 409);
  }

  const wanted = input.frames?.length
    ? source.frames.filter((f) => input.frames!.includes(f.file))
    : source.frames;

  /*
   * The frames twice: as bytes, and as paths.
   *
   * Which one is used depends on how the brain is reached — an API takes the
   * bytes, and the CLI can only be told where to look. Both are assembled here
   * because this service is not the place that knows which transport won.
   */
  const images = [];
  const files: string[] = [];
  for (const frame of wanted) {
    const bytes = await frameBytes(source.id, frame.file);
    if (bytes) {
      images.push({ mediaType: "image/jpeg", data: bytes.toString("base64") });
      const full = framePath(source.id, frame.file);
      if (full) files.push(full);
    }
  }

  if (!images.length && !source.transcript.trim() && !source.description.trim()) {
    throw new ResearchError(
      "There is nothing to read: no frames, no transcript and no caption. Check ffmpeg and whisper in Integrations.",
      409,
    );
  }

  const context = [
    source.kind === "file" ? `FILE: ${source.filename}` : `URL: ${source.url}`,
    source.title ? `TITLE: ${source.title}` : "",
    source.uploader ? `POSTED BY: ${source.uploader}` : "",
    source.duration ? `DURATION: ${source.duration}s` : "",
    source.description ? `CAPTION:\n${source.description}` : "",
    source.transcript ? `TRANSCRIPT:\n${source.transcript}` : "",
    images.length
      ? `FRAMES: ${images.length}, at ${wanted.map((f) => `${f.at}s`).join(", ")}, in that order.`
      : "FRAMES: none were taken — work from the words alone and lower your confidence accordingly.",
    input.note?.trim() ? `WHAT THE PERSON ADDED:\n${input.note.trim()}` : "",
    /*
     * The shape, said again, last, in full.
     *
     * A CLI brain is an agent with a personality of its own — asked to look at
     * eight stills it writes a REPORT, with headings, because that is what it
     * is for. The JSON contract lived in the system prompt only, which for a
     * CLI is an appended system prompt sitting under a much longer one of its
     * own, and it lost.
     *
     * Naming the shape rather than pointing at it, too: "the JSON described
     * above" got back a tidy JSON rendering of the CONTEXT — the URL, the
     * title, the transcript — because from where the model was reading, that
     * was what was above.
     */
    `ANSWER WITH EXACTLY THIS OBJECT, FILLED IN, AND NOTHING ELSE — no heading, no preamble, no explanation after it, no code fence. The first character of your answer is { and the last is }:\n${SHAPE}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const settings = await getSettings();
  const raw = await write(settings.brain, {
    system: SYSTEM,
    user: context,
    tier: "high",
    images: images.length ? images : undefined,
    imageFiles: files.length ? files : undefined,
    timeoutMs: 600_000,
  });

  const parsed = parse(raw);
  const site = (parsed?.site ?? {}) as Record<string, unknown>;
  const confidence = String(site.confidence ?? "low");

  const result: ResearchResult = {
    sourceId: source.id,
    site: {
      name: String(site.name ?? "").trim(),
      url: String(site.url ?? "").trim(),
      confidence:
        confidence === "high" || confidence === "medium" ? confidence : "low",
    },
    does: String(parsed?.does ?? "").trim(),
    shows: lines(parsed?.shows),
    verify: lines(parsed?.verify),
    ideas: (Array.isArray(parsed?.ideas) ? parsed.ideas : [])
      .map((raw) => {
        const idea = (raw ?? {}) as Record<string, unknown>;
        return {
          title: String(idea.title ?? "").trim(),
          angle: String(idea.angle ?? "").trim(),
          why: String(idea.why ?? "").trim(),
        };
      })
      .filter((idea) => idea.title),
    readFrames: wanted.map((f) => f.at),
    raw,
  };

  /*
   * Kept on the video it is about.
   *
   * The answer used to exist in one browser tab and nowhere else, so a reload
   * threw away several minutes of watching and every idea it produced. Saved
   * here, the tool has a history: the list of what has been read, each with
   * what came of it, and reopening one costs nothing.
   *
   * Not awaited into the answer's path — a database that will not take the row
   * is worth a lost history entry, not a lost reading. The caller still gets
   * what the model said.
   */
  void updateSource(source.id, { research: result }).catch(() => {});

  return result;
}
