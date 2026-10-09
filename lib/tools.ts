/**
 * Tools are one-off jobs that feed the rest of the workspace. A pack runs a
 * whole production; a tool answers one question and hands back something you
 * keep — a brief, a list, a set of angles.
 *
 * Content Research is the first one.
 */

export type ToolSlug = "content-research" | "content-researcher";

/**
 * What a tool is for, in one word.
 *
 * The bench is grouped by it. Free text rather than a union: a category is a
 * label somebody types on the tools screen, and a fixed list would mean a
 * release every time a new kind of job appears.
 */
export const TOOL_CATEGORIES = ["Research", "Video", "Writing", "Admin"];

export type Tool = {
  slug: ToolSlug;
  name: string;
  tagline: string;
  /** What you hand it. */
  takes: string;
  /** What it hands back. */
  returns: string;
  /** Where that output is meant to go next. */
  feeds: string;
  runtime: string;
  category: string;
};

export const TOOLS: Tool[] = [
  {
    slug: "content-research",
    name: "Content Research",
    tagline:
      "Point it at a URL or a topic and it returns the brief everything else is built on.",
    takes: "A website URL, or a topic in plain words",
    returns: "Angles, a verify list, keywords and where to look",
    feeds: "Topic research · pack section 01",
    runtime: "under a minute",
    category: "Research",
  },
  {
    slug: "content-researcher",
    name: "Content Researcher for BNEN Projects",
    tagline:
      "Give it a reel — a link or a file — and it watches the frames you pick, reads the transcript, works out which website it is about, and hands back topic ideas.",
    takes: "A YouTube or reel URL, or a video file",
    returns: "The site it is about, what it shows, and topic ideas to save",
    feeds: "Topics · and the template that runs on them",
    runtime: "a few minutes, most of it the download",
    category: "Video",
  },
];

export function findTool(slug: string) {
  return TOOLS.find((t) => t.slug === slug);
}

/* ── Content Research ───────────────────────────────────────────────────── */

export type ResearchDepth = "Quick" | "Standard" | "Deep";

export const DEPTHS: ResearchDepth[] = ["Quick", "Standard", "Deep"];

export type ResearchLang = "EN" | "BN";

/** The steps the run walks through, in order. */
export const RESEARCH_STEPS = [
  "Reading the subject",
  "Building the verify list",
  "Framing angles",
  "Assembling the brief",
];

export type ResearchBrief = {
  subject: string;
  /** A URL was given, or a topic in words. */
  kind: "url" | "topic";
  /** The site's host, or the topic itself — what the copy calls it. */
  name: string;
  depth: ResearchDepth;
  lang: ResearchLang;
  intent: string;
  summary: string;
  /** Claims to confirm before anything is written on top of them. */
  verify: string[];
  angles: string[];
  questions: string[];
  keywords: string[];
  /** Pages to open, or searches to run. */
  look: string[];
};

const URL_LIKE = /^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/|$)/i;

export const looksLikeUrl = (s: string) => URL_LIKE.test(s.trim());

/** "https://remove.bg/pricing" → "remove.bg" */
export function hostOf(raw: string) {
  const s = raw.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return s.split(/[/?#]/)[0] || s;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "with", "how", "to", "of", "in", "on",
  "is", "it", "that", "this", "your", "my", "best", "using", "use",
]);

function keywordsFrom(subject: string, name: string, depth: ResearchDepth) {
  const words = subject
    .toLowerCase()
    .replace(/https?:\/\/\S*/g, "")
    .split(/[^a-z0-9ঀ-৿]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));

  const base = [...new Set([name.toLowerCase(), ...words])];
  const shaped = [
    ...base,
    `${name.toLowerCase()} review`,
    `${name.toLowerCase()} free`,
    `${name.toLowerCase()} alternative`,
  ];
  const take = depth === "Quick" ? 5 : depth === "Standard" ? 8 : 12;
  return [...new Set(shaped)].slice(0, take);
}

/**
 * Builds the brief.
 *
 * Nothing here is fetched — dotcontent has no crawler wired up yet — so the tool
 * deliberately returns the *shape* of the research rather than invented facts:
 * what to confirm, which angles to test, where to look. Every claim starts
 * unconfirmed, which is also how the pack rules want it.
 */
export function buildBrief(
  subject: string,
  depth: ResearchDepth,
  lang: ResearchLang,
  notes: string,
): ResearchBrief {
  const clean = subject.trim();
  const kind = looksLikeUrl(clean) ? "url" : "topic";
  const name = kind === "url" ? hostOf(clean) : clean;
  const intent = notes.trim();

  const wide = depth !== "Quick";
  const deep = depth === "Deep";

  const verify = [
    kind === "url"
      ? `What the landing page promises, in its own words — not a paraphrase.`
      : `The one claim about ${name} that everybody repeats. Who said it first?`,
    `Free, freemium or paid — and exactly which part is gated.`,
    `Whether an account or a card is needed before anyone sees value.`,
    ...(wide
      ? [
          `Which platforms and languages are actually supported.`,
          `The strongest visible proof: a demo, a number, or a named user.`,
        ]
      : []),
    ...(deep
      ? [
          `What the newest reviews complain about, not the oldest.`,
          `What changed in the last release — and what quietly went away.`,
        ]
      : []),
  ];

  const angles = [
    `Show ${name} doing the single thing it is best at, inside twenty seconds.`,
    `The before and after: what this work looked like without ${name}.`,
    `The limitation nobody mentions — say it before the comments do.`,
    ...(wide
      ? [
          `Who should not use ${name}, and what they should reach for instead.`,
          `Price it against the alternative in the viewer's own numbers.`,
        ]
      : []),
    ...(deep
      ? [
          `The workflow around it: what has to be true before ${name} helps.`,
          `One week later — what you kept using and what you dropped.`,
        ]
      : []),
  ];

  const questions = [
    `Does the headline claim survive one real task, done on camera?`,
    `What does this cost the viewer if it goes wrong?`,
    ...(wide ? [`Is there a free path that reaches the same result slower?`] : []),
    ...(deep ? [`Who is this obviously wrong for, and why?`] : []),
  ];

  const look =
    kind === "url"
      ? [
          `https://${name}/`,
          `https://${name}/pricing`,
          `https://${name}/about`,
          ...(wide ? [`https://${name}/docs`] : []),
          ...(deep ? [`https://${name}/changelog`] : []),
        ]
      : [
          `"${name}" review`,
          `"${name}" vs`,
          ...(wide ? [`"${name}" tutorial`] : []),
          ...(deep ? [`site:reddit.com "${name}"`] : []),
        ];

  const summary =
    kind === "url"
      ? `A short-form package built on ${name}. Read the site first, confirm every claim below, then write — the pack rules refuse anything the page does not support.`
      : `A short-form package on ${name}. Nothing here is confirmed yet: settle the verify list first, then pick one angle and let the pack produce the rest.`;

  return {
    subject: clean,
    kind,
    name,
    depth,
    lang,
    intent,
    summary,
    verify,
    angles,
    questions,
    keywords: keywordsFrom(clean, name, depth),
    look,
  };
}

/** The brief as plain text, for the clipboard or a section input. */
export function briefToText(b: ResearchBrief) {
  const block = (title: string, lines: string[], bullet = "- ") =>
    [`${title}`, ...lines.map((l) => `${bullet}${l}`), ""].join("\n");

  return [
    `CONTENT RESEARCH — ${b.name}`,
    `Subject: ${b.subject}`,
    `Depth: ${b.depth} · Brief language: ${b.lang}`,
    b.intent ? `Wanted: ${b.intent}` : "",
    "",
    b.summary,
    "",
    block("VERIFY BEFORE WRITING", b.verify),
    block(
      "ANGLES",
      b.angles.map((a, i) => `${i + 1}. ${a}`),
      "",
    ),
    block("OPEN QUESTIONS", b.questions),
    block("WHERE TO LOOK", b.look),
    `KEYWORDS\n${b.keywords.join(", ")}`,
  ]
    .filter((part) => part !== "")
    .join("\n");
}
