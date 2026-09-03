/**
 * The content model behind /content.
 *
 * One TOPIC is one group of data. A topic is not a pile of loose artifacts —
 * it walks a fixed workflow of sections, and those sections roll up into five
 * OUTPUTS (English script, Bangla script, Social captions, YouTube SEO,
 * Hashtags). There is no separate "scripts" or "titles" list anywhere; a
 * script and a title are outputs *of a topic*.
 *
 * Kept out of lib/data.ts so the two can evolve independently.
 */

/**
 * A section's own state.
 *
 * `failed` is the model's answer not arriving — the section had its turn and
 * did not produce anything. It is a state of its own rather than a return to
 * `queued`, because a queued section is one that has not run yet and a failed
 * one is work waiting to be tried again.
 */
export type SectionState = "written" | "writing" | "queued" | "failed";

export type OutputKey = "en" | "bn" | "social" | "seo" | "tags";

export type SectionKind =
  | "research"
  | "tags"
  | "script"
  | "caption"
  | "social"
  | "seo"
  | "cta";

export type Lang = "EN" | "BN";

export const OUTPUT_LABEL: Record<OutputKey, string> = {
  en: "English script",
  bn: "Bangla script",
  social: "Social captions",
  seo: "YouTube SEO",
  tags: "Hashtags",
};

export const OUTPUT_SHORT: Record<OutputKey, string> = {
  en: "EN",
  bn: "BN",
  social: "SOC",
  seo: "SEO",
  tags: "TAG",
};

export const OUTPUT_ORDER: OutputKey[] = ["en", "bn", "social", "seo", "tags"];

export const STATE_STYLE: Record<
  SectionState,
  { label: string; bg: string; fg: string; dot: string }
> = {
  written: {
    label: "READY",
    bg: "rgba(75,176,122,0.16)",
    fg: "#4bb07a",
    dot: "#4bb07a",
  },
  failed: {
    label: "FAILED",
    bg: "rgba(209,101,107,0.16)",
    fg: "#d1656b",
    dot: "#d1656b",
  },
  writing: {
    label: "WRITING",
    bg: "rgba(0,87,252,0.28)",
    fg: "#bcd3ff",
    dot: "#bcd3ff",
  },
  queued: {
    label: "QUEUED",
    bg: "rgba(255,255,255,0.07)",
    fg: "rgba(240,240,244,0.5)",
    dot: "rgba(240,240,244,0.32)",
  },
};

/** What you decided to do with a topic once it was produced. */
export type Decision = "used" | "ready" | "ignored";

/**
 * The status shown in the list.
 *
 * One lifecycle read left to right: an **idea** with nothing produced, then
 * **writing** while a pack runs, then the decision you make about what came out
 * — ready, used, ignored. "writing" and "idea" are both derived and never
 * stored: idea means the topic has no document behind it yet.
 */
export type UsageStatus = Decision | "writing" | "idea" | "failed";

export const USAGE: Record<
  UsageStatus,
  { label: string; bg: string; fg: string; dot: string }
> = {
  used: {
    label: "Used",
    bg: "rgba(75,176,122,0.16)",
    fg: "#4bb07a",
    dot: "#4bb07a",
  },
  ready: {
    label: "Ready",
    bg: "rgba(0,87,252,0.1)",
    fg: "#7ea9ff",
    dot: "#7ea9ff",
  },
  ignored: {
    label: "Ignored",
    bg: "rgba(255,255,255,0.06)",
    fg: "rgba(240,240,244,0.45)",
    dot: "rgba(240,240,244,0.3)",
  },
  writing: {
    label: "Writing",
    bg: "rgba(0,87,252,0.28)",
    fg: "#bcd3ff",
    dot: "#bcd3ff",
  },
  failed: {
    label: "Failed",
    bg: "rgba(209,101,107,0.16)",
    fg: "#d1656b",
    dot: "#d1656b",
  },
  idea: {
    label: "Idea",
    bg: "rgba(255,255,255,0.07)",
    fg: "rgba(240,240,244,0.6)",
    dot: "rgba(240,240,244,0.4)",
  },
};

export const USAGE_ORDER: UsageStatus[] = [
  "idea",
  "failed",
  "used",
  "ready",
  "ignored",
  "writing",
];

export type DocSection = {
  /**
   * The section's real id, when the document came from a run.
   *
   * `n` is a position for display; this is what a rewrite is addressed to.
   * Without it the redo button could only ever be a simulation, which is
   * exactly what it was.
   */
  id?: string;
  /**
   * Changed by hand since it was generated.
   *
   * Worth saying on the page: the whole document otherwise reads as the
   * model's work, and a line somebody fixed themselves is the one thing on it
   * that will not come back if the section is run again.
   */
  edited?: boolean;
  n: string;
  name: string;
  purpose: string;
  kind: SectionKind;
  /** Which output this section feeds, if any. */
  output: OutputKey | null;
  /** Language tab this section belongs to. */
  lang: Lang | null;
  state: SectionState;
  /** Lines shown when the section is expanded. */
  body: string[];
  /** How long it took, in ms, for a section that has actually run. */
  ms?: number | null;
  /** Why it failed, when it did. */
  error?: string;
};

/*
 * The twenty-four sample documents used to be here.
 *
 * Fifteen invented sections each, under a template that does not exist,
 * generated from a `WORKFLOW` spec and a per-topic `DOC_SPECS` list. They put
 * a full-looking Content list in front of anyone who opened the app and made
 * it impossible to see what had actually been written. Everything below is the
 * shape and the helpers, which are real: a run becomes a `ContentDoc` through
 * lib/run-doc.
 */

export type ContentDoc = {
  /** URL slug, derived from the topic name. */
  slug: string;
  /** The topic is the group. */
  topic: string;
  /** Which shelf the topic sits on, e.g. "AI". */
  series: string;
  pack: string;
  part: string;
  /** One line on what this topic produced. */
  blurb: string;
  /** What you did with it once it was finished. */
  decision: Decision;
  created: string;
  updated: string;
  /**
   * When this last changed, as an ISO instant.
   *
   * Separate from `updated`, which is "5d ago" — a sentence, and one that
   * sorts alphabetically. "Most recent" was comparing those, so it did not
   * sort at all; it returned 0 and took whatever order the list was built in,
   * which put a topic you had just added at the bottom of its shelf's block.
   */
  at: string;
  sections: DocSection[];
  /**
   * The run this row came from, when it came from one.
   *
   * Set where the row is built rather than worked out from the slug. The list
   * used to ask `slug.startsWith("run-")`, and ids are minted as `run_…` with
   * an underscore — so every real run linked to `/content/<run id>`, which is
   * a 404. A row that knows what it is cannot be wrong about it.
   */
  runId?: string;
  /**
   * The topic behind the row, when there is one.
   *
   * Set where the row is built, like `runId`. Edit and Delete used to write to
   * a map of overrides that only the sample documents were ever read through —
   * so renaming a real topic here changed nothing you could see.
   */
  topicId?: string;
  /**
   * The shelf this row is on, by id.
   *
   * `series` is its NAME, for display and for search. Two shelves may share a
   * name — nothing stops it, and the tab strip keyed by name put two options
   * with the same value in a pick-one control, which React reports as a
   * duplicate key and a person experiences as one tab selecting both.
   */
  seriesId?: string;
};

/**
 * A topic that is still producing reads as "Writing" whatever the decision
 * says, so the two can never contradict each other on screen.
 */
export function usageOf(doc: ContentDoc): UsageStatus {
  if (!doc.sections.length) return "idea";
  if (doc.sections.some((s) => s.state === "writing")) return "writing";
  if (doc.sections.some((s) => s.state === "failed")) return "failed";
  return doc.decision;
}

export const writtenCount = (doc: ContentDoc) =>
  doc.sections.filter((s) => s.state === "written").length;

export type DocOutput = {
  key: OutputKey;
  label: string;
  short: string;
  done: number;
  total: number;
  state: SectionState;
  sections: DocSection[];
};

/** The deliverables a document rolls up into, in a fixed order. */
export function outputsFor(doc: ContentDoc): DocOutput[] {
  return OUTPUT_ORDER.map((key) => {
    const mine = doc.sections.filter((s) => s.output === key);
    const done = mine.filter((s) => s.state === "written").length;
    const state: SectionState =
      done === mine.length
        ? "written"
        : mine.some((s) => s.state === "writing")
          ? "writing"
          : // A failed section makes the whole output failed rather than
            // queued: queued means "its turn has not come", and this one's did.
            mine.some((s) => s.state === "failed")
            ? "failed"
            : "queued";
    return {
      key,
      label: OUTPUT_LABEL[key],
      short: OUTPUT_SHORT[key],
      done,
      total: mine.length,
      state,
      sections: mine,
    };
  });
}

/** Sections that feed no single output — the research and CTA steps. */
export function looseSections(doc: ContentDoc) {
  return doc.sections.filter((s) => s.output === null);
}

/** The slug a name is reached by. */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function docsByPack(docs: ContentDoc[]) {
  const groups: { pack: string; docs: ContentDoc[] }[] = [];
  for (const doc of docs) {
    const group = groups.find((g) => g.pack === doc.pack);
    if (group) group.docs.push(doc);
    else groups.push({ pack: doc.pack, docs: [doc] });
  }
  return groups;
}

/** How many sections each language tab covers, for the tab labels. */
export function langCounts(doc: ContentDoc) {
  return {
    all: doc.sections.length,
    EN: doc.sections.filter((s) => s.lang === "EN").length,
    BN: doc.sections.filter((s) => s.lang === "BN").length,
  };
}
