/**
 * Topic series.
 *
 * A CATEGORY is a shelf with a brief on it. The brief — its `context` — says
 * what the shelf is about, listed one theme per line. Generating from a
 * series turns those themes into topic IDEAS: a name and a line, nothing
 * more. No sections, no scripts, no content — a topic only starts producing
 * once a pack is run against it.
 *
 * A series also names the pack its topics run through, so an idea generated
 * here already knows where it is headed.
 */

import type { Decision } from "./content-docs";
import { TOPIC_GROUPS } from "./data";
import { normalizeName } from "@/lib/dedupe";
import { slug } from "./slug";

export type TopicStatus = "idea" | "generating" | "done";

/**
 * Three states, and only three.
 *
 * A topic is an IDEA until something produces from it, GENERATING while a pack
 * is running against it, and DONE once that pack has produced its content.
 * There is no "active": a topic is either producing right now or it is not,
 * and the content count already says whether anything came of it.
 */
export const TOPIC_STATUS: Record<
  TopicStatus,
  { label: string; bg: string; fg: string; pulse?: boolean }
> = {
  idea: {
    label: "Idea",
    bg: "rgba(255,255,255,0.07)",
    fg: "rgba(240,240,244,0.5)",
  },
  generating: {
    label: "Generating",
    bg: "rgba(0,87,252,0.2)",
    fg: "#8ab4ff",
    pulse: true,
  },
  done: {
    label: "Done",
    bg: "rgba(75,176,122,0.16)",
    fg: "#4bb07a",
  },
};

/** The states you can set by hand — generating is only ever set by a run. */
export const SETTABLE_STATUS: TopicStatus[] = ["idea", "done"];

export type Topic = {
  id: string;
  name: string;
  /**
   * Which part of its series this is.
   *
   * Claimed from the series' counter when the topic is made, never typed —
   * typing part numbers is how a series ends up with two part 3s and no part 4.
   * Null for a topic that belongs to no series.
   */
  part: number | null;
  /**
   * Anything the packs should know about this one idea.
   *
   * The series brief says what the shelf is about; this says what is different
   * about this topic — an angle, a source, a thing to avoid. Empty is the
   * normal case, which is why the field is folded away until you ask for it.
   */
  context: string;
  status: TopicStatus;
  /**
   * Used / Ready / Ignored, as set on the content list.
   *
   * Where `status` says how far along the topic is, this says what you
   * decided about what came out of it. Kept on the row so the pill survives a
   * reload — it used to live in a Map in the browser, which meant marking six
   * things Used and refreshing put all six back.
   */
  decision: Decision;
  content: string;
  packs: string;
  /** "2h ago" / "no runs" — for reading. */
  activity: string;
  /**
   * When the topic itself last changed, as an ISO instant — for ordering.
   *
   * `activity` is about its RUNS and is a sentence; neither can sort a list.
   * A topic added a minute ago has no runs at all, and still has to come out
   * above one added last week.
   */
  updatedAt: string;
};

/**
 * A page or a feed this series reads from.
 *
 * Mirrors what the fetcher returns. Declared here rather than imported from
 * the server module because that one reaches for `fetch` at import time and
 * has no business in a browser bundle.
 */
export type SeriesSource = {
  url: string;
  kind: "feed" | "page";
  title: string;
  items: { title: string; link: string; summary: string; date: string }[];
  text: string;
  fetchedAt: string;
};

export type Series = {
  id: string;
  name: string;
  /** One theme per line — what topics generated here are about. */
  context: string;
  /** The pack these topics run through. Empty when nothing is assigned. */
  pack: string;
  /**
   * The number the next topic here will take.
   *
   * Held by the series rather than derived from the topics in it: deleting part
   * 6 must not hand part 6 to the next thing you write. Gaps are honest — they
   * say something was there — and renumbering would rewrite the numbering of
   * work already published.
   */
  /**
   * Whether this shelf numbers its parts.
   *
   * Some series are a run — "part 7" is half the title. Others are a pile of
   * ideas, and a part number on one of those claims an order that is not
   * there. Off means topics land with no number and the counter stands still.
   */
  numbered: boolean;
  /**
   * The word in front of the number.
   *
   * "Part" is only right for the one template that shipped with the app. A
   * shelf of daily posts is on Day 7, a podcast on Episode 7, a countdown on
   * plain 7 — so the word is a property of the shelf, not a constant in the
   * markup of four different screens.
   *
   * Empty means the number stands alone, and is a choice rather than a value
   * somebody forgot to fill in.
   */
  partLabel: string;
  /** Which tab the brief is on: typed by hand, or read off the web. */
  briefFrom: "typed" | "link" | "feed";
  /** Where it sits in the shelf order. Contiguous once anything is moved. */
  position: number;
  /** What the last fetch brought back. Null until one happens. */
  source: SeriesSource | null;
  nextPart: number;
  topics: Topic[];
};

/**
 * A topic's number, written out: "Episode 07", or "07" on a shelf with no
 * word set. One function, because four screens were each building this string
 * out of the literal "Part" and a padStart, and adding a fifth would have been
 * a fifth chance to pad it differently.
 *
 * Zero-padded: the tiles are a monospace column, and "8" beside "24" reads as
 * a stray digit where "08" reads as a number in a series.
 */
export function partName(label: string, part: number | null) {
  if (part === null) return "";
  const n = String(part).padStart(2, "0");
  return label.trim() ? `${label.trim()} ${n}` : n;
}

/** How many ideas the generate control offers in one go. */
export const TOPIC_BATCHES = [1, 3, 5, 10];

const SEED_CONTEXT: Record<string, string> = {
  AI: [
    "AI agents",
    "AI automation",
    "prompt engineering",
    "AI tools for creators",
  ].join("\n"),
  Business: [
    "offer framing",
    "short-form marketing",
    "creator productivity",
    "small SaaS teardowns",
  ].join("\n"),
};

/*
 * Which pack each seeded shelf runs through.
 *
 * The one that ships, for both — these named two packs that only ever existed
 * in the design, so a seeded shelf pointed at a recipe nothing could execute.
 */
const SEED_PACK: Record<string, string> = {
  AI: "Website Shorts",
  Business: "Website Shorts",
};

/**
 * A shelf for each sample workspace, each running a different example template.
 *
 * Every sample workspace used to start empty apart from the first, whose two
 * shelves both ran the website template. That showed one kind of content
 * twice. These show what the other templates are for, on the brand they suit:
 * the reviewer reviews, the client launches, the studio blogs. A newcomer can
 * open any workspace, see a topic waiting under a template, and press Run.
 *
 * Keyed by workspace name, as `PROJECTS` in lib/data.ts spells it. Only a
 * fresh database gets them, the same as every other sample.
 */
export type ExampleShelf = {
  name: string;
  context: string;
  /** The template's name, which is how a series refers to one. */
  pack: string;
  topics: { name: string; context?: string }[];
};

export const EXAMPLE_SHELVES: Record<string, ExampleShelf[]> = {
  "AI Growth Studio": [
    {
      name: "Blog",
      context: "how-to guides for creators\nAI tools, explained simply",
      pack: "SEO Blog Post",
      topics: [
        { name: "How to write AI prompts that actually work" },
        { name: "Free AI tools for a one-person business" },
      ],
    },
    {
      name: "Weekly newsletter",
      context: "one useful AI tool or idea a week",
      pack: "Newsletter Email",
      topics: [{ name: "Three AI tools I kept using this month" }],
    },
  ],
  "Dropship Lab": [
    {
      name: "Product teardowns",
      context: "trending products, tested before we sell them",
      pack: "Honest Product Review",
      topics: [{ name: "Portable USB blender" }, { name: "Smart LED strip lights" }],
    },
    {
      name: "Repurposed videos",
      context: "our best videos, turned into posts and articles",
      pack: "Repurpose a Video",
      topics: [
        {
          name: "Our best-performing TikTok this month",
          context: "Open the run sheet and paste the video's link, so it is transcribed first.",
        },
      ],
    },
  ],
  "Affiliate Desk": [
    {
      name: "Honest reviews",
      context: "gadgets and books, the catch before the pitch",
      pack: "Honest Product Review",
      topics: [
        { name: "Kindle Paperwhite" },
        { name: "Anker PowerCore 10000" },
      ],
    },
  ],
  "Client — Acme Skincare": [
    {
      name: "Serum launch",
      context: "the Glow Vitamin C Serum launch campaign",
      pack: "Product Launch Campaign",
      topics: [
        {
          name: "Acme Glow Vitamin C Serum",
          context: "Launch date, price and link are not decided yet.",
        },
      ],
    },
    {
      name: "Daily posts",
      context: "skincare tips, one a day",
      pack: "Social Media Post Pack",
      topics: [
        { name: "Why sunscreen still matters in winter" },
        { name: "A three-step morning skincare routine" },
      ],
    },
  ],
};

/** The series a fresh session starts with, lifted from the design data. */
/**
 * The part number each seeded topic carries.
 *
 * Written out rather than read off the sample documents, which have been
 * deleted. They are here because a shelf seeded from scratch should start its
 * counter past the numbers its topics already show, not renumber them from
 * one — "Part 24" becoming part 3 is the seed lying about history.
 */
const SEEDED_PART = new Map<string, number>([
  ["ai agents", 24],
  ["ai automation", 23],
  ["ai tools", 8],
  ["marketing", 5],
  ["productivity", 12],
  ["saas", 3],
]);

export const SEED_SERIES: Series[] = TOPIC_GROUPS.map((g) => ({
  id: slug(g.name),
  name: g.name,
  context: SEED_CONTEXT[g.name] ?? "",
  pack: SEED_PACK[g.name] ?? "",
  // The seeded shelves are runs — their topics already carry part numbers.
  numbered: true,
  partLabel: "Part",
  briefFrom: "typed" as const,
  source: null,
  position: 0,
  nextPart:
    Math.max(
      0,
      ...g.items.map((item) => SEEDED_PART.get(item.name.toLowerCase()) ?? 0),
    ) + 1,
  topics: g.items.map((item) => ({
    id: slug(item.name),
    name: item.name,
    part: SEEDED_PART.get(item.name.toLowerCase()) ?? null,
    context: "",
    // The design data carried a loose label; the state is derivable — anything
    // that produced content is done. One topic starts mid-run so the third
    // state is visible on a fresh session.
    status: (item.name === "AI Automation"
      ? "generating"
      : Number(item.content) > 0
        ? "done"
        : "idea") as TopicStatus,
    decision: "ready",
    // Older than anything real, so seed rows never sit above your own work
    // in "most recent" while the server's answer is still in flight.
    updatedAt: "1970-01-01T00:00:00.000Z",
    content: item.content,
    packs: item.packs,
    activity: item.activity,
  })),
}));

/**
 * The angles an idea can take. Each one is a frame the theme drops into, so a
 * generated topic reads like something you could actually shoot rather than a
 * restatement of the series name.
 */
const FRAMES: { title: (theme: string) => string; desc: string }[] = [
  {
    title: (x) => `${x}, explained in 60 seconds`,
    desc: "The shortest honest explanation, for someone who has never touched it.",
  },
  {
    title: (x) => `The ${x} mistake everyone makes`,
    desc: "One wrong assumption, what it costs, and the fix.",
  },
  {
    title: (x) => `${x} for people who do not code`,
    desc: "Same result, no terminal, no API keys.",
  },
  {
    title: (x) => `Three ${x} prompts worth stealing`,
    desc: "Three prompts, each with one worked example.",
  },
  {
    title: (x) => `${x} vs doing it by hand`,
    desc: "The same task twice — clock both, then decide.",
  },
  {
    title: (x) => `What ${x} still cannot do`,
    desc: "The limits, said out loud before the comments do.",
  },
  {
    title: (x) => `A week with ${x}`,
    desc: "Seven days, one verdict, and what got dropped.",
  },
  {
    title: (x) => `${x} on a free plan`,
    desc: "How far the free tier actually goes.",
  },
  {
    title: (x) => `${x}: what changed this month`,
    desc: "What is new, and what quietly went away.",
  },
  {
    title: (x) => `Who should skip ${x}`,
    desc: "The people it is wrong for, and what they should use instead.",
  },
];

/** The themes a series's brief lists, one per line or comma-separated. */
/**
 * The lines a series' ideas are framed from.
 *
 * From the source when the brief is on a web tab, from the box when it is not.
 * Same shape either way — one theme per line — so everything downstream works
 * on thirty real headlines without knowing they were not typed.
 */
export function themesOf(series: Series) {
  const fromWeb = series.briefFrom !== "typed" && series.source;
  const raw = fromWeb ? sourceLines(series.source!) : series.context;

  /*
   * A comma separates themes you typed. It does not separate headlines.
   *
   * "free tools, no signup" is two themes; "Startup raises $1,000,000" is one,
   * and splitting it on commas produced a topic called "000". The brief you
   * write is a list; the brief that was fetched is already one line each.
   */
  const themes = raw
    .split(fromWeb ? /\n/ : /[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
  return themes.length ? themes : [series.name];
}

/** A fetched source as one line per thing worth writing about. */
export function sourceLines(source: SeriesSource) {
  if (source.items.length) {
    return source.items.map((i) => i.title).filter(Boolean).join("\n");
  }
  return source.text
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 30)
    .slice(0, 40)
    .join("\n");
}

/**
 * Ideas for a series, avoiding names it already has.
 *
 * Deterministic: the same series at the same size always produces the same
 * next idea, so clicking generate twice extends the list rather than
 * reshuffling it. Nothing is fetched or modelled — these are frames filled in
 * from the brief you wrote.
 */
export function generateTopics(
  series: Series,
  count: number,
  /**
   * Everything the workspace has already covered, from every other shelf.
   *
   * Without it the generator only knew this series' own topics, so the same
   * idea could be proposed again from the shelf next door — which is the
   * thing that makes two pieces of content about one subject.
   */
  coveredElsewhere: readonly string[] = [],
): Topic[] {
  const themes = themesOf(series);
  const taken = new Set(
    [...series.topics.map((t) => t.name), ...coveredElsewhere].map(
      normalizeName,
    ),
  );
  const made: Topic[] = [];

  let step = series.topics.length;
  let guard = 0;

  while (made.length < count && guard < count * FRAMES.length * 2) {
    guard += 1;
    const theme = themes[step % themes.length];
    const frame = FRAMES[Math.floor(step / themes.length) % FRAMES.length];
    step += 1;

    const name = frame.title(theme);
    // Compared the way everything else compares names, so "The X" and "x"
    // cannot both be generated, and neither can one the user typed by hand.
    if (taken.has(normalizeName(name))) continue;
    taken.add(normalizeName(name));

    made.push({
      id: `${slug(name)}-${step}`,
      name,
      // Claimed in the order they are generated, so a batch of three lands as
      // three consecutive parts rather than three copies of the same number.
      // Null throughout on a shelf that does not number.
      part: series.numbered ? series.nextPart + made.length : null,
      context: "",
      status: "idea",
      decision: "ready",
      updatedAt: new Date().toISOString(),
      content: "0",
      packs: series.pack ? "1" : "0",
      activity: "just now",
    });
  }

  return made;
}

/**
 * Turns a pasted block into topics — one per line.
 *
 * Lines may carry a description after a dash or a colon ("Hook banks — three
 * openings that work"), and list markers are stripped, so a list copied out of
 * notes or a doc imports as it stands.
 */
/**
 * One topic per line, and the line is the topic.
 *
 * It used to split each line on a dash or a colon and file the tail as a
 * description. With descriptions gone that split would silently eat half of
 * "Cold DMs: what to send after they reply" — so the whole line stands, and the
 * only thing stripped is a leading bullet or number from a pasted list.
 */
export function parseTopicLines(text: string) {
  const seen = new Set<string>();
  const topics: { name: string }[] = [];

  for (const raw of text.split("\n")) {
    const clean = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, "").trim();
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    topics.push({ name: clean });
  }

  return topics;
}

/** A topic written by hand or pasted in, ready for a series. */
export function makeTopic(
  name: string,
  status: TopicStatus,
  pack: string,
  part: number | null = null,
  context = "",
): Topic {
  return {
    id: `${slug(name)}-${slug(String(name.length))}${Math.abs(
      hash(name),
    ).toString(36)}`,
    name,
    part,
    context,
    status,
    // Every new topic starts ready: it is content you have not decided about
    // yet, which is exactly what ready means.
    decision: "ready",
    // Now, so it sorts to the top of "most recent" the instant it appears.
    // The server sends its own a moment later and they agree to the second.
    updatedAt: new Date().toISOString(),
    content: "0",
    packs: pack ? "1" : "0",
    activity: "just now",
  };
}

/** Small, stable string hash — keeps ids unique without a random source. */
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
