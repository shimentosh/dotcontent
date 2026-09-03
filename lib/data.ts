/**
 * Static content transcribed from the Content OS design canvas
 * (design/meshclip.dc.html). Everything the prototype shows lives here so the
 * view components stay presentational.
 */

import type { PackStatus } from "./packs";

export type StatusKey =
  | "complete"
  | "ready"
  | "running"
  | "review"
  | "not"
  | "failed";

/** label, chip background, chip foreground */
export const STATUS: Record<StatusKey, readonly [string, string, string]> = {
  complete: ["Complete", "rgba(75,176,122,0.16)", "#4bb07a"],
  ready: ["Ready", "rgba(0,87,252,0.1)", "#7ea9ff"],
  running: ["Running", "rgba(0,87,252,0.28)", "#bcd3ff"],
  review: ["Needs review", "rgba(201,154,63,0.16)", "#c99a3f"],
  not: ["Not started", "rgba(255,255,255,0.07)", "rgba(240,240,244,0.5)"],
  failed: ["Failed", "rgba(209,101,107,0.16)", "#d1656b"],
};

/**
 * Where a project is in its own life, as opposed to what it is doing right
 * now. `run` answers "is a pack executing this minute"; this answers "am I
 * still publishing here at all" — a workspace can sit Idle all week and still
 * be the one you care most about.
 */
export type ProjectStatus = "Active" | "Planning" | "Paused" | "Archived";

/** Label, chip background, chip foreground — same shape as STATUS above. */
export const PROJECT_STATUS: Record<
  ProjectStatus,
  readonly [string, string, string]
> = {
  Active: ["Active", "rgba(75,176,122,0.16)", "#4bb07a"],
  Planning: ["Planning", "rgba(0,87,252,0.16)", "#6a9dff"],
  Paused: ["Paused", "rgba(201,154,63,0.16)", "#c99a3f"],
  Archived: ["Archived", "rgba(255,255,255,0.06)", "rgba(240,240,244,0.4)"],
};

export const PROJECT_STATUSES = Object.keys(PROJECT_STATUS) as ProjectStatus[];

/**
 * The languages offered in the picker.
 *
 * A starting set, not a closed one — the editor lets you add anything else, and
 * a project keeps whatever it already had even if it is not on this list.
 */
export const LANGUAGES = [
  "Bangla",
  "English",
  "Hindi",
  "Urdu",
  "Arabic",
  "Spanish",
] as const;

/** How a set of languages is written wherever one is shown. */
export const langLabel = (langs: string[]) => langs.join(" · ");

export type Project = {
  /**
   * The workspace's id in the database.
   *
   * Empty on the seed constants, which exist only until the API answers —
   * every workspace the app actually shows has come back from the server and
   * carries one, and every write needs it.
   */
  id: string;
  name: string;
  /** The account it posts from. */
  handle: string;
  /**
   * The channel it publishes as — the name a viewer actually sees on the post.
   *
   * Separate from `name`, which is what YOU call the workspace: "Client —
   * NovaSkin" is a useful label on this screen and the wrong thing to put on a
   * follow card.
   */
  channel: string;
  status: ProjectStatus;
  /** Why the project exists, in one line. */
  goal: string;
  /**
   * Prepended to every pack in this workspace, for every section.
   *
   * Held on the project rather than typed into each brief, which is the whole
   * point of it: set once, and nothing downstream has to describe the tone
   * again. Empty is a real state — the packs then run on their own rules only.
   */
  brandVoice: string;
  tint: string;
  /**
   * An uploaded mark, as a data URL, or null for the default icon.
   *
   * Held beside `tint` rather than replacing it: the tint is still what the
   * icon sits on, and it is what comes back if the photo is removed. Stored
   * inline because a prototype has nowhere to upload a file to — the editor
   * downscales before it gets here so a phone photo does not become a
   * multi-megabyte string in React state.
   */
  photo: string | null;
  /**
   * What it publishes in.
   *
   * A list rather than the "Bangla · English" string it used to be: it was only
   * ever displayed, so a string was enough — until it had to be *edited*, at
   * which point a free-text box is a way to typo your way to a fourth spelling
   * of Bangla. Rendered through `langLabel`, which owns the separator.
   */
  langs: string[];
  topics: string;
  packs: string;
  content: string;
  run: string;
  dot: string;
};

export const PROJECTS: Project[] = [
  {
    id: "",
    name: "AI Growth Studio",
    handle: "@aigrowth",
    channel: "AI Growth Studio BN",
    status: "Active",
    goal: "Grow to 50k followers with useful websites",
    brandVoice: `A smart creator showing people useful websites, tools and tricks in a
simple, curious, scroll-friendly way.

Banglish is the default: Bangla sentence structure with common English words
left in Latin script — website, keyword, rank, search, click, free, tool, save.
Never transliterate those into Bangla script, never translate them.

Result over feature. Say what the viewer GETS, not what the tool has.
Never formal, never news-like, never salesy. It should read like a friend
showing you something useful.`,
    tint: "linear-gradient(150deg,#5b93ff,#0057fc)",
    photo: null,
    langs: ["Bangla", "English"],
    topics: "18",
    packs: "9",
    content: "214",
    run: "2 packs running",
    dot: "#4bb07a",
  },
  {
    id: "",
    name: "Dropship Lab",
    handle: "@dropshiplab",
    channel: "Dropship Lab",
    status: "Paused",
    goal: "Test one product teardown format to 20 videos",
    // Deliberately empty: two of the four have no voice yet, which is the state
    // the overview is meant to make impossible to miss.
    brandVoice: "",
    tint: "linear-gradient(150deg,#93a7c0,#4a5a70)",
    photo: null,
    langs: ["English"],
    topics: "11",
    packs: "6",
    content: "96",
    run: "Idle",
    dot: "rgba(240,240,244,0.3)",
  },
  {
    id: "",
    name: "Affiliate Desk",
    handle: "@affdesk",
    channel: "Affiliate Desk Bangla",
    status: "Active",
    goal: "Two honest reviews a week, every week",
    brandVoice: `Honest reviewer, not a salesperson. Bangla, spoken, second person.

Lead with the catch, not the pitch: what is wrong with the product comes before
what is right, because that is the line that earns the rest of the video.
Every claim is something you could check. No superlatives, no urgency, no
"limited time". Close on who it is actually for — and who should skip it.`,
    tint: "linear-gradient(150deg,#3d80ff,#00348f)",
    photo: null,
    langs: ["Bangla"],
    topics: "7",
    packs: "4",
    content: "61",
    run: "1 pack running",
    dot: "#4bb07a",
  },
  {
    id: "",
    name: "Client — NovaSkin",
    handle: "@novaskin",
    channel: "NovaSkin Official",
    status: "Active",
    goal: "Hand over 40 approved shorts by launch",
    brandVoice: "",
    tint: "linear-gradient(150deg,#a8c7ff,#4a6fa8)",
    photo: null,
    langs: ["English", "Hindi"],
    topics: "5",
    packs: "3",
    content: "38",
    run: "Awaiting review",
    dot: "#c99a3f",
  },
];

export const TOPIC_GROUPS = [
  {
    name: "AI",
    count: "3 topics",
    items: [
      {
        name: "AI Agents",
        status: "Researched",
        bg: "rgba(75,176,122,0.16)",
        fg: "#4bb07a",
        desc: "Agent tooling explained for creators who do not code.",
        content: "34",
        packs: "3",
        activity: "2h ago",
      },
      {
        name: "AI Automation",
        status: "Active",
        bg: "rgba(0,87,252,0.16)",
        fg: "#6a9dff",
        desc: "Workflows that replace repetitive posting work.",
        content: "21",
        packs: "2",
        activity: "yesterday",
      },
      {
        name: "AI Tools",
        status: "Idea",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.5)",
        desc: "Weekly tool picks, one honest verdict each.",
        content: "8",
        packs: "1",
        activity: "4d ago",
      },
    ],
  },
  {
    name: "Business",
    count: "3 topics",
    items: [
      {
        name: "Marketing",
        status: "Active",
        bg: "rgba(0,87,252,0.16)",
        fg: "#6a9dff",
        desc: "Offer framing and hooks for short-form.",
        content: "19",
        packs: "2",
        activity: "1d ago",
      },
      {
        name: "Productivity",
        status: "Researched",
        bg: "rgba(75,176,122,0.16)",
        fg: "#4bb07a",
        desc: "Systems for solo creators shipping daily.",
        content: "27",
        packs: "1",
        activity: "3d ago",
      },
      {
        name: "SaaS",
        status: "Idea",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.5)",
        desc: "Teardown format for small SaaS products.",
        content: "6",
        packs: "0",
        activity: "2w ago",
      },
    ],
  },
];

/** The pack column when an artifact was made outside any pack. */
export const NO_PACK = "—";

/*
 * Three steps, not eight.
 *
 * Four of the eight were one textarea each, all of them different halves of
 * the same shared brief, and two more were a preview and a Save button. What
 * you actually decide when you write a pack is: what it is called, what its
 * sections say, and what every section is told before its own prompt.
 */
export const BUILDER_STEP_LABELS = ["Pack", "Sections", "Shared brief"];

export type DraftSection = {
  id: string;
  name: string;
  type: string;
  /** This section's own prompt, written on top of the pack rules. */
  brief: string;
  /**
   * One line on what the section is for, when the pack carries one. The
   * shipped packs do; the builder does not ask for it, so a written section
   * shows its prompt instead.
   */
  summary?: string;
};

export type PackDraft = {
  name: string;
  summary: string;
  /**
   * Where the template stands in the library.
   *
   * It lives on the brief because the builder is the only place a template is
   * edited. It used to be set in a small sheet on the library screen, beside a
   * name field and a button that said "Edit in builder" — two ways in, one of
   * which could not touch a prompt.
   */
  status: PackStatus;
  /**
   * What this pack is trying to achieve, sent above its rules.
   *
   * There is no `audience` or `context` beside it any more. Both described the
   * BRAND rather than the recipe, and the workspace already carries that: its
   * brand voice is prepended to every system prompt before anything a pack
   * says. Two places to write down one fact is one place to write it down
   * wrong.
   */
  purpose: string;
  /** Prepended to every section's prompt. */
  rules: string;
  sections: DraftSection[];
};

export const QUALITIES = ["Fast", "Balanced", "Deep"];

/**
 * What a section can be, and what each one hands back.
 *
 * There were nineteen of these in six groups, and three of them were called
 * Content Plan, Shot Plan and Visual Plan. Nothing told them apart because
 * nothing DID tell them apart: a section's type is a label on its row, and a
 * plan of any kind is whatever its prompt asks for. Offering three names for
 * one thing does not give you three tools, it gives you a decision you cannot
 * make.
 *
 * Also gone: Voice, Audio and Image, because every brain this app can reach is
 * a text model — a section called Image returned a paragraph describing one.
 * And Approval and Human Input, because the run engine has no way to stop and
 * wait for a person. A control that cannot work is worse than a missing one:
 * you build a template around it before finding out.
 *
 * What is left is nine, each producing something you can picture, and the
 * custom box at the bottom for everything else — which is where the three
 * "FROM LIBRARY" entries always went anyway.
 */
export type SectionTypeDef = {
  name: string;
  /** One line, in the second person: what you get back. */
  makes: string;
};

export const SECTION_TYPE_GROUPS: {
  name: string;
  items: SectionTypeDef[];
}[] = [
  {
    name: "WHAT GETS WRITTEN",
    items: [
      { name: "Script", makes: "What gets said, start to finish" },
      { name: "Hook", makes: "The opening line that stops the scroll" },
      { name: "Caption", makes: "Short text on screen, or under the post" },
      { name: "Title", makes: "A headline someone would actually search for" },
      { name: "Description", makes: "The longer blurb underneath it" },
      { name: "CTA", makes: "The one thing you want them to do next" },
    ],
  },
  {
    name: "BEFORE ANY OF THAT",
    items: [
      {
        name: "Research",
        makes: "Go and find out first — facts to write from, not guesses",
      },
      {
        name: "Plan",
        makes: "The shape and the order, decided before a word is written",
      },
    ],
  },
];

export type PaletteAction = { kind: "nav"; href: string } | { kind: "runSetup" };

type PaletteItem = {
  glyph: string;
  label: string;
  hint: string;
  bg: string;
  fg: string;
  action: PaletteAction;
};

export const PALETTE_GROUPS: { name: string; items: PaletteItem[] }[] = [
  {
    /*
     * One action, and it is the one you came for.
     *
     * This group listed three: run a template that does not exist, regenerate
     * a numbered section on a page that has been deleted, and generate a voice
     * from a script nothing produces. Only Run survived, because only Run does
     * anything — and it opens the sheet, which asks which template.
     */
    name: "RUN",
    items: [
      {
        glyph: "▶",
        label: "Run a template",
        hint: "⏎",
        bg: "rgba(0,87,252,0.18)",
        fg: "#6a9dff",
        action: { kind: "runSetup" },
      },
    ],
  },
  {
    name: "CREATE",
    items: [
      {
        glyph: "+",
        label: "Create Content Template",
        hint: "⌘⇧P",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.7)",
        action: { kind: "nav", href: "/builder" },
      },
      {
        glyph: "+",
        label: "Create Topic",
        hint: "⌘⇧T",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.7)",
        action: { kind: "nav", href: "/content" },
      },
    ],
  },
  {
    name: "GO TO",
    items: [
      {
        glyph: "⌂",
        label: "Home",
        hint: "G H",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.7)",
        action: { kind: "nav", href: "/" },
      },
      {
        glyph: "◫",
        label: "Packs",
        hint: "G P",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.7)",
        action: { kind: "nav", href: "/packs" },
      },
      {
        glyph: "≡",
        label: "Content",
        hint: "G C",
        bg: "rgba(255,255,255,0.07)",
        fg: "rgba(240,240,244,0.7)",
        action: { kind: "nav", href: "/content" },
      },
    ],
  },
];
