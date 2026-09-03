"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { ADVANCED_NAV } from "./config";
import type { Decision } from "./content-docs";
import { emptyDraft, packForSeries, type Pack } from "./packs";
import {
  ago,
  createPack as apiCreatePack,
  fromDraft,
  listPacks as apiListPacks,
  patchPack,
  removePack,
  restorePack as apiRestorePack,
  toUiPack,
} from "./packs-client";
import { listRuns, type Run } from "./runs-client";
import { startTopicRun } from "./start-run";
import {
  loadSettings,
  patchSettings,
  type Settings,
} from "./integrations-client";
import {
  SEED_SERIES,
  generateTopics,
  makeTopic,
  parseTopicLines,
  themesOf,
  type Topic,
  type Series,
  type SeriesSource,
  type TopicStatus,
} from "./topics";
import {
  PROJECTS,
  STATUS,
  type DraftSection,
  type PackDraft,
  type Project,
  type StatusKey,
} from "./data";

/** The chip styling for a section status, plus the pulse used while running. */
export function statusMeta(key: StatusKey) {
  const [label, bg, fg] = STATUS[key] ?? STATUS.not;
  return {
    status: label,
    bg,
    fg,
    anim: key === "running" ? "os-pulse 1.1s ease-in-out infinite" : "none",
  };
}

/** The three faceted filters on the Content screen. */
export type ContentFilterKey = "topic" | "pack" | "status";

export type ContentSortKey =
  "title" | "type" | "topic" | "pack" | "status" | "updated";

export type ContentSort = { key: ContentSortKey; dir: "asc" | "desc" };

/** The Add Section sheet is shared by the builder and the pack screen. */
export type AddSectionTarget = "draft" | "pack";

const NO_FILTERS: Record<ContentFilterKey, string[]> = {
  topic: [],
  pack: [],
  status: [],
};

/** What the confirm dialog needs to draw itself and act. */
export type ConfirmRequest = {
  title: string;
  body: string;
  /** The button that does the thing. Named for the act, never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  /**
   * A second way out, for a destructive act with a gentler version of itself:
   * deleting a shelf but keeping its topics, archiving instead of deleting.
   *
   * Sits between Cancel and the destructive button, styled as neither — it is
   * not the escape and it is not the damage. Omitted, the dialog is the plain
   * yes/no it has always been.
   */
  alternative?: { label: string; onChoose: () => void };
};

type Store = {
  /** Sidebar "Advanced" group visibility. */
  advancedNav: boolean;

  /** Pack-run simulation. */
  /** Held mid-run. The step counter keeps its place, so resuming continues. */

  /** Header project switcher. */
  projectIdx: number;
  setProjectIdx: (i: number) => void;
  projectOpen: boolean;
  toggleProject: () => void;

  /**
   * The workspaces themselves.
   *
   * State rather than the imported constant, because the brand voice, channel
   * name, goal and status are all editable now — a project you can only read is
   * a project whose voice you have to restate in every brief instead.
   */
  projects: Project[];
  /**
   * Whether `projects` is the server's list yet.
   *
   * It opens on the design's sample workspaces, which carry an empty id, so
   * that every screen has a name to show before the first request answers.
   * Anything that WRITES with a workspace id has to wait for this — a run or
   * an upload against `""` is a foreign-key error dressed as "something went
   * wrong", and it is only reachable in the first second after a load.
   */
  projectsLoaded: boolean;
  /** The one the switcher is pointed at. */
  project: Project;
  updateProject: (i: number, patch: Partial<Project>) => void;

  /**
   * Which workspace the sheet is editing.
   *
   * `null` closed, an index to edit that one, `"new"` to make one — the sheet
   * is the same form either way, so a separate create dialog would have been
   * the same eight fields maintained twice.
   */
  projectSheet: number | "new" | null;
  openProjectSheet: (i: number) => void;
  newProject: () => void;
  /** Appends a workspace and switches to it. Returns its index. */
  addProject: (patch: Partial<Project>) => number;
  /**
   * Removes one. The last workspace cannot go: every screen reads its packs,
   * topics and voice off the current workspace, so an empty list is a shell
   * with nothing to render and no way back.
   */
  removeProject: (i: number) => void;
  closeProjectSheet: () => void;

  /**
   * A destructive action waiting on a yes.
   *
   * One dialog rather than a `confirm()` — which is unstyled, blocking, and on
   * a page built out of glass looks like the browser caught fire.
   */
  confirm: ConfirmRequest | null;
  askConfirm: (request: ConfirmRequest) => void;
  closeConfirm: () => void;

  /** Header create menu. */
  createOpen: boolean;
  toggleCreate: () => void;

  /** Command palette. */
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  query: string;
  setQuery: (q: string) => void;

  /** "Add Section" sheet, and which list it is adding to. */
  addSectionOpen: boolean;
  addSectionTarget: AddSectionTarget;
  /** Which pack a section is being added to, when the target is a pack. */
  addSectionPackId: string | null;
  openAddSection: (target: AddSectionTarget, packId?: string) => void;
  closeAddSection: () => void;

  /** "Run Pack" sheet. */
  runSetupOpen: boolean;
  openRunSetup: (topicName?: string) => void;
  closeRunSetup: () => void;

  /**
   * Topic series, live.
   *
   * A series carries the brief its ideas are generated from and the pack
   * they run through, so both are editable on the Topics screen itself.
   */
  seriesList: Series[];
  topicCount: number;
  /**
   * Every run, for the counts that are counts of runs. Loaded once; the run
   * screens still fetch their own, because those need it fresh by the second.
   */
  runs: Run[];
  /** Preferences, or null until the first read answers. */
  settings: Settings | null;
  /** Change one, write it through, and keep every reader in step. */
  saveSettings: (patch: Partial<Settings>) => void;
  /** Re-read every run — after a rewrite, so the page shows what landed. */
  reloadRuns: () => Promise<void>;
  /**
   * Re-read this workspace's shelves from the server.
   *
   * For anything that adds topics from outside the topic screens — the
   * researcher saves its ideas straight onto a shelf, and the counts beside
   * that shelf are wrong until somebody navigates.
   */
  reloadSeries: () => Promise<void>;
  /**
   * A new shelf. `numbered` decides whether its topics get part numbers —
   * on for a run of parts, off for a pile of ideas with no order.
   */
  addSeries: (
    name: string,
    context: string,
    pack: string,
    numbered?: boolean,
    /** The word in front of the number. Empty for a bare count. */
    partLabel?: string,
  ) => void;
  updateSeries: (
    id: string,
    patch: Partial<Omit<Series, "id" | "topics">>,
  ) => void;
  /**
   * Read a page or a feed and hang it on a series.
   *
   * Resolves with an error message, or "" when it worked — the panel has a
   * place to show why a site refused, and a rejected promise would only get
   * swallowed by the same empty catch as everything else here.
   */
  readSeriesSource: (id: string, url: string) => Promise<string>;
  /** Detach it and go back to whatever was typed. */
  clearSeriesSource: (id: string) => void;
  /**
   * Takes the shelf down. Everything standing on it goes too, unless
   * `keepTopics` is set — then the topics move to the holding shelf and only
   * the shelf itself goes.
   */
  removeTopicSeries: (id: string, keepTopics?: boolean) => void;
  /**
   * Folds one shelf into another and deletes the empty one. Resolves with
   * what happened: how many topics moved, which were dropped as already
   * covered with nothing written, and which moved despite a name clash
   * because they had content.
   */
  mergeSeriesInto: (
    fromId: string,
    intoId: string,
  ) => Promise<{
    moved: number;
    duplicatedWithContent: string[];
    dropped: string[];
  }>;
  /** Moves a series one place up (-1) or down (1) in the order. */
  moveTopicSeries: (id: string, by: -1 | 1) => void;
  /** Appends `count` ideas to a series and returns the new topics' ids. */
  generateTopicsIn: (id: string, count: number) => string[];
  /** One topic, written by hand. Returns its id. */
  addTopic: (
    seriesId: string,
    name: string,
    status: TopicStatus,
    context?: string,
  ) => string;
  /** A pasted block, one topic per line. Returns the ids it created. */
  importTopics: (
    seriesId: string,
    text: string,
    status: TopicStatus,
  ) => string[];
  updateTopic: (topicId: string, patch: Partial<Omit<Topic, "id">>) => void;
  deleteTopic: (topicId: string) => void;
  /**
   * Point a pack at a topic: it goes Generating now and Done when the run
   * finishes, so the status on the list is never a label somebody forgot to
   * change.
   */
  runTopic: (topicId: string) => void;
  /**
   * Run a topic through its series' template, now, without asking anything.
   *
   * Everything a run is told — the shelf, the part number, the topic's note —
   * is already on the topic, so there is nothing left to fill in: the sheet
   * only exists for the run that has no topic behind it, or the shelf that has
   * not picked a template. Resolves with the new run's id, or null when it
   * could not start, in which case the sheet has been opened instead.
   */
  runTopicNow: (topicId: string) => Promise<string | null>;
  /**
   * The topic the run sheet is pointed at. Set when a run is started from a
   * topic row, so the sheet opens on the topic you clicked rather than on
   * whatever it happened to be showing.
   */
  runTopicName: string | null;
  setRunTopicName: (name: string | null) => void;

  /**
   * The pack library, live: the packs screen renames, restatuses and deletes,
   * so the list cannot be a constant.
   */
  packs: Pack[];
  updatePack: (id: string, patch: Partial<Omit<Pack, "id">>) => void;
  deletePack: (id: string) => void;
  /** Copy a pack into a new editable one and open it in the builder. */
  duplicatePack: (id: string) => void;
  /**
   * A template that arrived as a file, written into the library.
   *
   * Returns the new slug so the caller can open it — an import you cannot see
   * the result of is indistinguishable from one that failed.
   */
  importPack: (body: Parameters<typeof apiCreatePack>[0]) => Promise<string>;
  /** Put a pack back the way it shipped. Only for one that ships. */
  restorePack: (id: string) => void;
  /**
   * Which pack the builder is editing, or null when it is writing a new one.
   * Editing a pack IS the builder — there is no second, lesser editor.
   */
  draftPackId: string | null;
  /** Load a pack into the builder and go there. */
  editPack: (id: string) => void;
  /**
   * Load a pack into the builder WITHOUT navigating — for the builder itself,
   * arriving on /builder/<slug> from a link, a refresh or a new tab. Editing a
   * template has its own URL, so the state has to be reachable from the URL
   * alone and not only from the click that would have set it.
   */
  loadPackDraft: (id: string) => void;
  /** Start the builder on an empty pack. */
  newPack: () => void;
  /** Write the builder's draft back to its pack, creating one if needed. */
  savePack: () => void;

  /**
   * Content documents the list screen has edited or removed. The documents
   * themselves stay in lib/content-docs; these are the overrides on top.
   */

  /** Tabs and selections. */
  packTab: string;
  setPackTab: (t: string) => void;
  contentTab: string;
  setContentTab: (t: string) => void;

  /** Content screen faceting, kept here so it survives leaving and coming back. */
  contentFilters: Record<ContentFilterKey, string[]>;
  toggleContentFilter: (group: ContentFilterKey, value: string) => void;
  clearContentFilters: (group?: ContentFilterKey) => void;
  contentQuery: string;
  setContentQuery: (q: string) => void;
  contentSort: ContentSort;
  sortContentBy: (key: ContentSortKey) => void;
  /** Back to every artifact: tab, filters and search all cleared. */
  resetContent: () => void;

  quality: string;
  setQuality: (q: string) => void;
  builderStep: number;
  setBuilderStep: (n: number) => void;

  /** The pack being written in the builder. */
  draft: PackDraft;
  setDraft: (patch: Partial<PackDraft>) => void;
  addDraftSection: (name: string, type: string, at?: number) => void;
  /**
   * Append a section to a saved pack and write it through.
   *
   * The pack screen shared the builder's Add Section sheet and then threw the
   * pick away — it closed, and nothing was added. That was true while a pack
   * was a constant; a pack is a row now, so the sheet can finish the job.
   */
  addPackSection: (packId: string, name: string, type: string) => void;
  updateDraftSection: (id: string, patch: Partial<DraftSection>) => void;
  removeDraftSection: (id: string) => void;
  moveDraftSection: (id: string, by: -1 | 1) => void;
  /** Move a step to a position — what a drag onto the flow means. */
  moveDraftSectionTo: (id: string, at: number) => void;
  /** Which section has its prompt open in the builder. */
  editingSection: string | null;
  setEditingSection: (id: string | null) => void;
  /** Which section the Test step is previewing. */
  testSection: string | null;
  setTestSection: (id: string) => void;

  /** Pack rules panel. */
  showInstructions: boolean;
  toggleInstructions: () => void;

  /** Navigate, closing every open menu on the way. */
  go: (href: string) => void;
};

/**
 * The marks a new workspace can take, in order.
 *
 * Cycled by position rather than chosen at random: a colour that changes every
 * time the list re-renders is not an identity, and the fourth workspace looking
 * like the first is a far smaller problem than the first looking like itself
 * only some of the time.
 */
const TINTS = [
  "linear-gradient(150deg,#6a9dff,#0043c8)",
  "linear-gradient(150deg,#8fa3bd,#4a5a70)",
  "linear-gradient(150deg,#4bb07a,#1f6b46)",
  "linear-gradient(150deg,#c99a3f,#8a6520)",
];

/* ── The API's shape, and how it becomes the shape the screens read ─────── */

type ApiTopic = {
  id: string;
  name: string;
  part: number | null;
  context: string;
  status: string;
  decision: string;
  updatedAt: string;
};

type ApiSeries = {
  id: string;
  name: string;
  context: string;
  pack: string;
  numbered: boolean;
  partLabel: string;
  briefFrom?: "typed" | "link" | "feed";
  source?: SeriesSource | null;
  position?: number;
  nextPart: number;
  topics: ApiTopic[];
};

type ApiWorkspace = {
  id: string;
  name: string;
  handle: string;
  channel: string;
  status: string;
  goal: string;
  brandVoice: string;
  langs: string[];
  tint: string;
  photo: string | null;
  series: ApiSeries[];
};

const toSeries = (s: ApiSeries): Series => ({
  id: s.id,
  name: s.name,
  context: s.context,
  pack: s.pack,
  numbered: s.numbered,
  partLabel: s.partLabel ?? "Part",
  briefFrom: s.briefFrom ?? "typed",
  position: s.position ?? 0,
  source: s.source ?? null,
  nextPart: s.nextPart,
  topics: s.topics.map((t) => ({
    id: t.id,
    name: t.name,
    part: t.part,
    context: t.context,
    status: t.status as TopicStatus,
    decision: (t.decision === "used" || t.decision === "ignored"
      ? t.decision
      : "ready") as Decision,
    updatedAt: t.updatedAt ?? "",
    // Counts the list still shows. Derived below from real runs rather than
    // carried on the row, so nothing here can be stale.
    content: "0",
    packs: s.pack ? "1" : "0",
    activity: "just now",
  })),
});

const toProject = (w: ApiWorkspace): Project => ({
  id: w.id,
  name: w.name,
  handle: w.handle,
  channel: w.channel,
  status: w.status as Project["status"],
  goal: w.goal,
  brandVoice: w.brandVoice,
  langs: w.langs,
  tint: w.tint || "linear-gradient(150deg,#5b93ff,#0057fc)",
  photo: w.photo,
  // Counted from what the workspace actually holds instead of typed into the
  // record. These were the last invented numbers on the home page.
  topics: String(w.series.reduce((n, x) => n + x.topics.length, 0)),
  packs: String(new Set(w.series.map((x) => x.pack).filter(Boolean)).size),
  content: "0",
  run: "Idle",
  dot: "rgba(240,240,244,0.3)",
});

/**
 * Fire-and-forget writes.
 *
 * Every mutation below updates React state first and calls this after, so the
 * screen never waits on a round trip. A failed write is swallowed rather than
 * rolled back: for a local tool the honest failure mode is "it did not save",
 * which the next reload makes obvious, and snatching a typed character back
 * out of an input mid-sentence is worse than either.
 */
function send(path: string, method: string, body?: unknown) {
  void fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {});
}

/** The pages that render without a session, and so must not be redirected. */
const BARE_PATHS = ["/login", "/signup"];

const StoreContext = createContext<Store | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [projectIdx, setProjectIdx] = useState(0);
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectSheet, setProjectSheet] = useState<number | "new" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addSectionPackId, setAddSectionPackId] = useState<string | null>(null);
  const [addSectionTarget, setAddSectionTarget] =
    useState<AddSectionTarget>("draft");
  const [runSetupOpen, setRunSetupOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [packTab, setPackTab] = useState("My Packs");
  /*
   * Empty until the API answers rather than seeded from a constant list. A
   * placeholder pack you can open, edit and save is worse than a moment of
   * nothing: the save lands on a pack that does not exist.
   */
  const [packs, setPacks] = useState<Pack[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  /*
   * Preferences, loaded once and shared.
   *
   * Three unrelated places need them — the settings screen edits them, the
   * shell applies reduced motion, and the run driver reads whether to carry on
   * by itself — and a preference each of them fetched separately would be a
   * preference they could disagree about.
   */
  const [settings, setSettings] = useState<Settings | null>(null);
  /*
   * Declared above the hydration effect that writes it.
   *
   * It lived a hundred lines further down, which put the setter in the
   * temporal dead zone as far as the linter was concerned — correct at
   * runtime, and exactly the kind of correct nobody should have to verify.
   */
  const [quality, setQuality] = useState("Balanced");
  const [draftPackId, setDraftPackId] = useState<string | null>(null);
  const [seriesList, setTopicSeries] = useState<Series[]>(SEED_SERIES);

  /*
   * Everything above this line is a seed, replaced the moment the API answers.
   *
   * The workspaces, their series and every topic live in the database now, so
   * this loads them once and every mutation below writes through. Optimistic:
   * the screen updates immediately and the request follows, because a UI that
   * waits for a round trip to show a typed character feels broken even when it
   * is correct.
   *
   * `hydrated` gates the writes — until the server has answered, these values
   * are the constants this file starts with, and sending those anywhere is how
   * a seed overwrites real work.
   */
  /*
   * Nothing is loaded until we know someone is signed in.
   *
   * The provider wraps the sign-in page too, so hydrating unconditionally
   * fired seven requests at a locked API and filled the console of the one
   * screen a new person ever sees with 401s. One question first, then the
   * three loads — and on the sign-in page it stops after the question.
   */
  useEffect(() => {
    let cancelled = false;

    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then(async (auth: { user: unknown }) => {
        if (cancelled) return;

        /*
         * No session: go to the sign-in page rather than render the seed.
         *
         * The middleware only checks that a cookie is PRESENT, because it runs
         * on the Edge and cannot reach the database. An expired or revoked
         * cookie therefore gets you a rendered console — and, until this, one
         * quietly filled with the design's constants: four workspaces that do
         * not exist and a pack count that answers nothing. Being signed out
         * has to look like being signed out.
         */
        if (!auth.user) {
          if (!BARE_PATHS.includes(window.location.pathname)) {
            const next = window.location.pathname + window.location.search;
            router.replace(`/login?next=${encodeURIComponent(next)}`);
          }
          return;
        }

        const [rows, packRows, runRows, prefs] = await Promise.all([
          fetch("/api/workspaces", { cache: "no-store" })
            .then((r) => (r.ok ? (r.json() as Promise<ApiWorkspace[]>) : null))
            .catch(() => null),
          apiListPacks().catch(() => null),
          listRuns().catch(() => null),
          loadSettings().catch(() => null),
        ]);
        if (cancelled) return;

        if (rows?.length) {
          setProjects(rows.map(toProject));
          setProjectsLoaded(true);
          // The series shown are the current workspace's. Which one that is
          // comes from `projectIdx`, so this follows it below rather than here.
          setTopicSeries(rows[0].series.map(toSeries));
        }
        if (packRows) setPacks(packRows.map(toUiPack));
        if (runRows) setRuns(runRows);
        if (prefs) {
          setSettings(prefs);
          setQuality(prefs.quality);
        }
      })
      // Silent: a console that cannot reach its own API should still render
      // rather than throw a blank shell at whoever opened it.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [router]);

  /**
   * Change a preference, everywhere at once.
   *
   * Local first so the control moves under the finger, then written through.
   * A failed write is put back from the server rather than left showing a
   * setting that did not save.
   */
  const saveSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    if (patch.quality) setQuality(patch.quality);
    void patchSettings(patch)
      .then(setSettings)
      .catch(() => {
        void loadSettings().then(setSettings).catch(() => {});
      });
  }, []);

  const reloadSeries = useCallback(async () => {
    const rows = await fetch("/api/workspaces", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ApiWorkspace[]>) : null))
      .catch(() => null);
    const mine = rows?.find((x) => x.id === projects[projectIdx]?.id);
    if (mine) setTopicSeries(mine.series.map(toSeries));
  }, [projects, projectIdx]);

  const reloadRuns = useCallback(
    () =>
      listRuns()
        .then(setRuns)
        .catch(() => {}),
    [],
  );

  /**
   * Re-read the pack library after it has been written to.
   *
   * The first load happens in the hydration effect above, with the workspaces
   * and the runs; this is for after a save, when the server has just chosen a
   * slug the builder needs to know about.
   */
  const reloadPacks = useCallback(
    () =>
      apiListPacks()
        .then((rows) => setPacks(rows.map(toUiPack)))
        .catch(() => {}),
    [],
  );

  /**
   * The topic a run is producing right now, if the run was started from one.
   *
   * A ref, not state: the run tick reads it and writes the result in the same
   * breath, and a state updater has to stay pure — nesting the write inside one
   * made React's double-invocation in development count the run twice.
   */
  const runningTopic = useRef<string | null>(null);
  const [runTopicName, setRunTopicName] = useState<string | null>(null);
  const [contentTab, setContentTab] = useState("All");
  const [contentFilters, setContentFilters] =
    useState<Record<ContentFilterKey, string[]>>(NO_FILTERS);
  const [contentQuery, setContentQuery] = useState("");
  const [contentSort, setContentSort] = useState<ContentSort>({
    key: "updated",
    dir: "asc",
  });
  /*
   * The builder opens empty, on step one.
   *
   * It used to open on BUILDER_DRAFT — "Dropship Product Teardown, step 6 of
   * 8" — a half-finished pack from the design canvas that exists in no
   * library. Walking to /builder showed someone else's work in progress, and
   * pressing Save would have written a pack invented by a constant.
   */
  const [builderStep, setBuilderStep] = useState(1);
  const [draft, setDraftState] = useState<PackDraft>(emptyDraft);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [testSection, setTestSection] = useState<string | null>(
    null,
  );
  const [showInstructions, setShowInstructions] = useState(false);

  const toggleContentFilter = useCallback(
    (group: ContentFilterKey, value: string) => {
      setContentFilters((f) => {
        const list = f[group];
        return {
          ...f,
          [group]: list.includes(value)
            ? list.filter((v) => v !== value)
            : [...list, value],
        };
      });
    },
    [],
  );

  const clearContentFilters = useCallback((group?: ContentFilterKey) => {
    setContentFilters((f) => (group ? { ...f, [group]: [] } : NO_FILTERS));
  }, []);

  /** Clicking the sorted column again flips its direction. */
  const sortContentBy = useCallback((key: ContentSortKey) => {
    setContentSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);

  const resetContent = useCallback(() => {
    setContentFilters(NO_FILTERS);
    setContentQuery("");
    setContentTab("All");
  }, []);

  const updateProject = useCallback((i: number, patch: Partial<Project>) => {
    setProjects((list) => {
      const target = list[i];
      if (target?.id) send(`/workspaces/${target.id}`, "PATCH", patch);
      return list.map((p, n) => (n === i ? { ...p, ...patch } : p));
    });
  }, []);

  /**
   * A new workspace, seeded with everything a screen needs to render it.
   *
   * The counts start at "0" rather than being left undefined: every view reads
   * `topics`/`packs`/`content` as strings straight onto the page, so a missing
   * one is a blank where a number belongs rather than a zero.
   */
  const addProject = useCallback((patch: Partial<Project>) => {
    let index = 0;
    setProjects((list) => {
      index = list.length;
      /*
       * Created on the server, and the row it returns replaces the local one.
       *
       * Not fire-and-forget like the rest: a workspace with no id cannot be
       * edited or deleted afterwards, so this is the one write whose answer
       * matters.
       */
      void fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, tint: patch.tint }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((made: ApiWorkspace | null) => {
          if (!made) return;
          setProjects((current) =>
            current.map((p, n) => (n === index ? { ...p, id: made.id } : p)),
          );
        })
        .catch(() => {});
      return [
        ...list,
        {
          id: "",
          name: "New workspace",
          handle: "@workspace",
          channel: "",
          status: "Planning",
          goal: "",
          brandVoice: "",
          tint: TINTS[list.length % TINTS.length],
          photo: null,
          langs: [],
          topics: "0",
          packs: "0",
          content: "0",
          run: "Idle",
          dot: "rgba(240,240,244,0.3)",
          ...patch,
        },
      ];
    });
    setProjectIdx(index);
    return index;
  }, []);

  const removeProject = useCallback((i: number) => {
    setProjects((list) => {
      if (list.length <= 1) return list;
      if (list[i]?.id) send(`/workspaces/${list[i].id}`, "DELETE");
      const next = list.filter((_, n) => n !== i);
      // Keep the selection inside the shortened list — removing the workspace
      // you are standing in must not leave the header pointing past the end.
      setProjectIdx((current) =>
        current >= next.length ? next.length - 1 : current,
      );
      return next;
    });
  }, []);

  const setDraft = useCallback((patch: Partial<PackDraft>) => {
    setDraftState((d) => ({ ...d, ...patch }));
  }, []);

  /** Opening a pack for editing is opening the builder on that pack's brief. */
  const loadPackDraft = useCallback(
    (id: string) => {
      const pack = packs.find((p) => p.id === id);
      if (!pack) return;
      setDraftState(pack.draft);
      setDraftPackId(id);
      setEditingSection(null);
      setTestSection(pack.draft.sections[0]?.id ?? null);
      setBuilderStep(1);
    },
    [packs],
  );

  /*
   * Each template's builder is its own URL, so it can be linked, bookmarked,
   * kept in a tab and told apart in history — which is also how a visit to one
   * template's builder is distinguishable from a visit to another's.
   */
  const editPack = useCallback(
    (id: string) => {
      loadPackDraft(id);
      router.push(`/builder/${id}`);
    },
    [loadPackDraft, router],
  );

  const newPack = useCallback(() => {
    setDraftState(emptyDraft());
    setDraftPackId(null);
    setEditingSection(null);
    setTestSection(null);
    setBuilderStep(1);
    router.push("/builder");
  }, [router]);

  /**
   * Save writes the whole brief back, not just the name: the sections and their
   * prompts are the pack.
   */
  const savePack = useCallback(() => {
    const name = draft.name.trim() || "Untitled pack";
    const body = fromDraft({ ...draft, name });

    /*
     * Saved on the server, and the list reloaded from what it wrote.
     *
     * Not fire-and-forget like a workspace rename: a new pack's slug is chosen
     * server-side (to keep it unique and to keep it clear of the shipped ones),
     * and the builder needs that slug to know it is now editing rather than
     * creating. A second Save would otherwise make a second pack.
     */
    if (draftPackId) {
      void patchPack(draftPackId, body)
        .then(() => reloadPacks())
        .catch(() => {});
      return;
    }

    void apiCreatePack(body)
      .then((made) => {
        setDraftPackId(made.slug);
        // The pack now exists, so the builder is editing rather than creating
        // and /builder is no longer where it lives. Replace rather than push:
        // Back should leave the builder, not return to a URL that would start
        // a second new template.
        router.replace(`/builder/${made.slug}`);
        return reloadPacks();
      })
      .catch(() => {});
  }, [draft, draftPackId, reloadPacks, router]);

  const updateDraftSection = useCallback(
    (id: string, patch: Partial<DraftSection>) => {
      setDraftState((d) => ({
        ...d,
        sections: d.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }));
    },
    [],
  );

  /** New sections land at the end with an empty prompt, ready to be written. */
  const addPackSection = useCallback(
    (packId: string, name: string, type: string) => {
      const pack = packs.find((p) => p.id === packId);
      if (!pack) return;
      const draft = {
        ...pack.draft,
        sections: [
          ...pack.draft.sections,
          // Empty prompt on purpose: the section exists now, and what it
          // should say is the next decision, made in the builder.
          { id: `s${Date.now().toString(36)}`, name, type, brief: "" },
        ],
      };
      void patchPack(packId, fromDraft(draft))
        .then(() => reloadPacks())
        .catch(() => {});
    },
    [packs, reloadPacks],
  );

  /**
   * A step, at a place in the flow.
   *
   * `at` is the index it lands on; leaving it out appends, which is what the
   * old sheet did from anywhere. The builder presses + on the connector
   * between two steps, and a step inserted there has to arrive there —
   * appending it and asking you to walk it up with the arrows is the
   * behaviour that made adding one in the middle a chore.
   */
  const addDraftSection = useCallback(
    (name: string, type: string, at?: number) => {
      const id = `s${Date.now().toString(36)}`;
      setDraftState((d) => {
        const next = [...d.sections];
        const where = at === undefined ? next.length : Math.max(0, Math.min(at, next.length));
        next.splice(where, 0, { id, name, type, brief: "" });
        return { ...d, sections: next };
      });
      setEditingSection(id);
      setAddSectionOpen(false);
    },
    [],
  );

  const removeDraftSection = useCallback((id: string) => {
    setDraftState((d) => ({
      ...d,
      sections: d.sections.filter((s) => s.id !== id),
    }));
    setEditingSection((cur) => (cur === id ? null : cur));
    setTestSection((cur) => (cur === id ? null : cur));
  }, []);

  /**
   * Drop a step at an index, rather than nudge it one place.
   *
   * `at` is the gap it was dropped on, counted on the list as it looks now —
   * so removing the row first would shift every gap after it. Taking the row
   * out and then correcting the index by one when it came from above is the
   * whole of the arithmetic, and getting it wrong puts the step one place
   * from where it was dropped, every time.
   */
  const moveDraftSectionTo = useCallback((id: string, at: number) => {
    setDraftState((d) => {
      const from = d.sections.findIndex((s) => s.id === id);
      if (from === -1) return d;
      const next = [...d.sections];
      const [row] = next.splice(from, 1);
      const where = Math.max(0, Math.min(from < at ? at - 1 : at, next.length));
      next.splice(where, 0, row);
      return { ...d, sections: next };
    });
  }, []);

  const moveDraftSection = useCallback((id: string, by: -1 | 1) => {
    setDraftState((d) => {
      const from = d.sections.findIndex((s) => s.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= d.sections.length) return d;
      const sections = d.sections.slice();
      const [moved] = sections.splice(from, 1);
      sections.splice(to, 0, moved);
      return { ...d, sections };
    });
  }, []);

  /**
   * A new series, created on the server so it has a real id.
   *
   * The id used to be derived from the name, which meant renaming a series
   * would have orphaned everything under it — and two workspaces could not
   * both have an "AI" shelf.
   */
  const addSeries = useCallback(
    (
      name: string,
      context: string,
      pack: string,
      numbered = true,
      partLabel = "Part",
    ) => {
      const workspaceId = projects[projectIdx]?.id;
      if (!workspaceId) return;
      void fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name,
          context,
          pack,
          numbered,
          partLabel,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((made: ApiSeries | null) => {
          if (made) setTopicSeries((cats) => [...cats, toSeries(made)]);
        })
        .catch(() => {});
    },
    [projects, projectIdx],
  );

  const updateSeries = useCallback(
    (id: string, patch: Partial<Omit<Series, "id" | "topics">>) => {
      send(`/series/${id}`, "PATCH", patch);
      setTopicSeries((cats) =>
        cats.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
    },
    [],
  );

  /**
   * A series owns its topics rather than tagging them, so removing one takes
   * its ideas with it. The screen says how many before it asks.
   *
   * The DELETE is the half that was missing: this dropped the shelf from the
   * array and told nobody, so the series came back on the next load. The
   * endpoint had been there the whole time, waiting for a caller.
   */
  /**
   * Take a shelf down.
   *
   * `keepTopics` moves what was standing on it to the holding shelf instead of
   * deleting it. That one is not optimistic: the holding shelf may not exist
   * yet, and inventing it here — with an id the server has not issued — would
   * put a row on screen that nothing can be done to until a reload.
   */
  const readSeriesSource = useCallback(async (id: string, url: string) => {
    try {
      const res = await fetch(`/api/series/${id}/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok) return String(body?.error ?? "That could not be read.");
      setTopicSeries((cats) =>
        cats.map((c) => (c.id === id ? toSeries(body) : c)),
      );
      return "";
    } catch {
      return "That could not be read.";
    }
  }, []);

  const clearSeriesSource = useCallback((id: string) => {
    send(`/series/${id}/source`, "DELETE");
    setTopicSeries((cats) =>
      cats.map((c) =>
        c.id === id ? { ...c, source: null, briefFrom: "typed" as const } : c,
      ),
    );
  }, []);

  const removeTopicSeries = useCallback(
    (id: string, keepTopics = false) => {
      if (!keepTopics) {
        send(`/series/${id}`, "DELETE");
        setTopicSeries((cats) => cats.filter((c) => c.id !== id));
        return;
      }

      void fetch(`/api/series/${id}?keepTopics=1`, { method: "DELETE" })
        .then(() => fetch("/api/workspaces"))
        .then((r) => (r.ok ? (r.json() as Promise<ApiWorkspace[]>) : null))
        .then((rows) => {
          const mine = rows?.find((w) => w.id === projects[projectIdx]?.id);
          if (mine) setTopicSeries(mine.series.map(toSeries));
        })
        .catch(() => {});
    },
    [projects, projectIdx],
  );

  /**
   * Fold one shelf into another.
   *
   * Not optimistic. The server decides which topics move, which are dropped
   * as covered-and-empty, and what part numbers they land on — guessing any
   * of that here and correcting it a moment later would show the wrong
   * numbers on a screen whose whole job is numbering.
   */
  const mergeSeriesInto = useCallback(
    async (fromId: string, intoId: string) => {
      const res = await fetch(`/api/series/${fromId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into: intoId }),
      });
      const report = (await res.json().catch(() => null)) as {
        moved?: number;
        duplicatedWithContent?: string[];
        dropped?: string[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(report?.error || "The merge did not run");

      const fresh = await fetch(`/api/workspaces`)
        .then((r) => (r.ok ? (r.json() as Promise<ApiWorkspace[]>) : null))
        .catch(() => null);
      const mine = fresh?.find((w) => w.id === projects[projectIdx]?.id);
      if (mine) setTopicSeries(mine.series.map(toSeries));

      return {
        moved: report?.moved ?? 0,
        duplicatedWithContent: report?.duplicatedWithContent ?? [],
        dropped: report?.dropped ?? [],
      };
    },
    [projects, projectIdx],
  );

  /**
   * Move a shelf one place up or down.
   *
   * The order is a column on the row, not the order the rows came back in, so
   * moving one has to write. Two rows change and they swap: the moved one
   * takes the position it is going to, and the one it displaced takes the
   * position it came from. Writing every row's new index instead would be a
   * dozen requests to say the same thing.
   */
  const moveTopicSeries = useCallback(
    (id: string, by: -1 | 1) => {
      const from = seriesList.findIndex((c) => c.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= seriesList.length) return;

      /*
       * Renumber the whole shelf order, not just the two that swapped.
       *
       * Swapping the two indices assumed positions were already 0..n-1. They
       * are not: merging two shelves left both on position 2, and against a
       * tie the order comes from created_at — so writing indices into it moved
       * a shelf two places instead of one. Writing every row's new index costs
       * a handful of requests, is exact whatever state the column is in, and
       * leaves it contiguous so the next move is trivially right.
       *
       * Only the rows that actually change are written.
       */
      const next = seriesList.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      next.forEach((series, index) => {
        if (seriesList.indexOf(series) !== index || series.position !== index) {
          send(`/series/${series.id}`, "PATCH", { position: index });
        }
      });

      setTopicSeries((cats) => {
        const local = cats.slice();
        const [pulled] = local.splice(from, 1);
        local.splice(to, 0, pulled);
        return local.map((series, index) => ({ ...series, position: index }));
      });
    },
    [seriesList],
  );

  /**
   * Generation only ever adds ideas. Sections and content stay untouched —
   * those come from running a pack against the topic later.
   */
  /** Rename or restatus one pack. Every pack is a row, so every pack edits. */
  const updatePack = useCallback(
    (id: string, patch: Partial<Omit<Pack, "id">>) => {
      setPacks((list) => {
        void patchPack(id, {
          name: patch.name,
          description: patch.desc,
          status: patch.status,
        }).catch(() => {});
        return list.map((p) => (p.id === id ? { ...p, ...patch } : p));
      });
    },
    [],
  );

  /**
   * Copy a pack into a new, editable one.
   *
   * The only way to change a shipped pack: its prompts are versioned with the
   * code and refused by the API, so "edit this" has to mean "start from this".
   * The copy opens in the builder, because that is what you wanted to do.
   */
  const importPack = useCallback(
    async (body: Parameters<typeof apiCreatePack>[0]) => {
      const made = await apiCreatePack(body);
      await reloadPacks();
      return made.slug;
    },
    [reloadPacks],
  );

  const duplicatePack = useCallback(
    (id: string) => {
      const source = packs.find((p) => p.id === id);
      if (!source) return;
      const draft = {
        ...source.draft,
        name: `${source.draft.name} copy`,
      };
      void apiCreatePack(fromDraft(draft))
        .then((made) => {
          setDraftPackId(made.slug);
          setDraftState(draft);
          setEditingSection(null);
          setTestSection(draft.sections[0]?.id ?? null);
          setBuilderStep(1);
          void reloadPacks();
          // The copy is a template in its own right the moment it is written,
          // so the builder opens on ITS url rather than on the one that means
          // "a template that does not exist yet".
          router.push(`/builder/${made.slug}`);
        })
        .catch(() => {});
    },
    [packs, reloadPacks, router],
  );

  /**
   * Put a shipped pack back.
   *
   * Reloaded from what the server wrote rather than patched locally: a restore
   * replaces twelve sections, their instructions and the rules, and rebuilding
   * that in the browser would be a second implementation of the same thing.
   */
  const restorePack = useCallback(
    (id: string) => {
      void apiRestorePack(id)
        .then(() => reloadPacks())
        .catch(() => {});
    },
    [reloadPacks],
  );

  const deletePack = useCallback((id: string) => {
    setPacks((list) => {
      void removePack(id).catch(() => {});
      return list.filter((p) => p.id !== id);
    });
    setDraftPackId((current) => (current === id ? null : current));
  }, []);

  const patchTopic = useCallback(
    (topicId: string, patch: Partial<Omit<Topic, "id">>) => {
      send(`/topics/${topicId}`, "PATCH", patch);
      setTopicSeries((cats) =>
        cats.map((c) => ({
          ...c,
          topics: c.topics.map((t) =>
            t.id === topicId ? { ...t, ...patch } : t,
          ),
        })),
      );
    },
    [],
  );

  /**
   * Write new topics, then take the server's version of the series back.
   *
   * The local insert above it is what makes the row appear instantly; this is
   * what makes it real. Replacing the whole series rather than merging ids is
   * deliberate — the server owns the part numbers, and reconciling two
   * independent opinions about which topic is part 7 is a bug waiting to be
   * written.
   */
  const pushTopics = useCallback(
    (
      seriesId: string,
      topics: { name: string; context?: string; status?: string }[],
    ) => {
      if (!topics.length) return;
      void fetch(`/api/series/${seriesId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics }),
      })
        .then((r) => (r.ok ? fetch(`/api/series/${seriesId}`) : null))
        .then((r) => (r?.ok ? r.json() : null))
        .then((fresh: ApiSeries | null) => {
          if (!fresh) return;
          setTopicSeries((cats) =>
            cats.map((c) => (c.id === seriesId ? toSeries(fresh) : c)),
          );
        })
        .catch(() => {});
    },
    [],
  );

  const addTopic = useCallback(
    (seriesId: string, name: string, status: TopicStatus, context = "") => {
      const series = seriesList.find((c) => c.id === seriesId);
      const topic = makeTopic(
        name,
        status,
        series?.pack ?? "",
        // No number on a shelf that does not number, and the counter stands
        // still. The server decides the same thing a moment later; showing a
        // part number here first would flash one on and then take it away.
        series?.numbered ? series.nextPart : null,
        context,
      );
      setTopicSeries((cats) =>
        cats.map((c) =>
          c.id === seriesId
            ? {
                ...c,
                nextPart: c.numbered ? c.nextPart + 1 : c.nextPart,
                topics: [...c.topics, topic],
              }
            : c,
        ),
      );
      pushTopics(seriesId, [{ name, context, status }]);
      return topic.id;
    },
    [seriesList, pushTopics],
  );

  /** Skips blank lines, list markers, and names the series already carries. */
  const importTopics = useCallback(
    (seriesId: string, text: string, status: TopicStatus) => {
      const series = seriesList.find((c) => c.id === seriesId);
      if (!series) return [];

      const taken = new Set(series.topics.map((t) => t.name.toLowerCase()));
      const made = parseTopicLines(text)
        .filter((line) => !taken.has(line.name.toLowerCase()))
        // Numbered in the order they were pasted, so a list of five lands as
        // five consecutive parts.
        .map((line, i) =>
          makeTopic(
            line.name,
            status,
            series.pack,
            series.numbered ? series.nextPart + i : null,
          ),
        );

      if (!made.length) return [];
      setTopicSeries((cats) =>
        cats.map((c) =>
          c.id === seriesId
            ? {
                ...c,
                nextPart: c.numbered ? c.nextPart + made.length : c.nextPart,
                topics: [...c.topics, ...made],
              }
            : c,
        ),
      );
      pushTopics(
        seriesId,
        made.map((t) => ({
          name: t.name,
          context: t.context,
          status: t.status,
        })),
      );
      return made.map((t) => t.id);
    },
    [seriesList, pushTopics],
  );

  const deleteTopic = useCallback((topicId: string) => {
    send(`/topics/${topicId}`, "DELETE");
    setTopicSeries((cats) =>
      cats.map((c) => ({
        ...c,
        topics: c.topics.filter((t) => t.id !== topicId),
      })),
    );
  }, []);

  const runTopic = useCallback(
    (topicId: string) => {
      const topic = seriesList
        .flatMap((c) => c.topics)
        .find((x) => x.id === topicId);
      patchTopic(topicId, { status: "generating", activity: "just now" });
      runningTopic.current = topicId;
      setRunTopicName(topic?.name ?? null);
      setRunSetupOpen(true);
    },
    [patchTopic, seriesList],
  );

  /**
   * The one-press run.
   *
   * `runTopic` opens the sheet, which is the right answer when something is
   * genuinely unknown. For a topic on a shelf that has a template, nothing is:
   * the sheet would open on the topic you clicked, with the template already
   * chosen, so that you could press Start. This does that press.
   *
   * The topic goes to "generating" before the request rather than after it, so
   * the row you clicked changes under your cursor instead of a second later.
   */
  const runTopicNow = useCallback(
    async (topicId: string): Promise<string | null> => {
      const series = seriesList.find((c) =>
        c.topics.some((x) => x.id === topicId),
      );
      const topic = series?.topics.find((x) => x.id === topicId);
      if (!series || !topic) return null;

      // No template to be sure of means there is a real question to ask, and
      // the sheet is where it is asked.
      const pack = packForSeries(packs, series.pack);
      if (!pack) {
        runTopic(topicId);
        return null;
      }

      const workspace = projects[projectIdx] ?? projects[0];
      if (!workspace) return null;

      patchTopic(topicId, { status: "generating", activity: "just now" });
      try {
        const run = await startTopicRun({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          packSlug: pack.id,
          topic: {
            id: topic.id,
            name: topic.name,
            part: topic.part,
            partLabel: series.partLabel,
            context: topic.context,
            seriesName: series.name,
            seriesContext: themesOf(series).join("\n"),
          },
        });
        await reloadRuns();
        return run.id;
      } catch {
        // The status goes back: a topic that says "generating" with no run
        // behind it is a lie the list would keep telling.
        patchTopic(topicId, { status: topic.status });
        return null;
      }
    },
    [seriesList, packs, patchTopic, projects, projectIdx, reloadRuns, runTopic],
  );

  const generateTopicsIn = useCallback(
    (id: string, count: number) => {
      const series = seriesList.find((c) => c.id === id);
      if (!series) return [];
      // Built outside the updater: a state updater has to stay pure, and this
      // one has to hand its new ids back to the caller.
      // Every other shelf's topics go in, so the generator cannot propose
      // something this workspace has already written under another series.
      const elsewhere = seriesList
        .filter((c) => c.id !== id)
        .flatMap((c) => c.topics.map((t) => t.name));
      const fresh = generateTopics(series, count, elsewhere);
      setTopicSeries((cats) =>
        cats.map((c) =>
          c.id === id
            ? {
                ...c,
                nextPart: c.numbered ? c.nextPart + fresh.length : c.nextPart,
                topics: [...c.topics, ...fresh],
              }
            : c,
        ),
      );
      pushTopics(
        id,
        fresh.map((t) => ({
          name: t.name,
          context: t.context,
          status: t.status,
        })),
      );
      return fresh.map((t) => t.id);
    },
    [seriesList, pushTopics],
  );

  const closeMenus = useCallback(() => {
    setCreateOpen(false);
    setPaletteOpen(false);
    setProjectOpen(false);
  }, []);

  const go = useCallback(
    (href: string) => {
      closeMenus();
      router.push(href);
    },
    [closeMenus, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setAddSectionOpen(false);
        setCreateOpen(false);
        setProjectOpen(false);
        setRunSetupOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * The numbers on the workspace cards, counted from real runs.
   *
   * Kept out of `toProject` and derived here because runs arrive on their own
   * request: folding them into the mapping would mean re-mapping every
   * workspace whenever a section finishes, and losing any local edit made in
   * between. The card's dot is the honest one — it is green only while a
   * section is genuinely being written.
   */
  const countedProjects = useMemo(
    () =>
      projects.map((p) => {
        const mine = runs.filter((r) => r.workspaceId === p.id);
        const writing = mine.some((r) =>
          r.sections.some((x) => x.state === "writing"),
        );
        const finished = mine.filter((r) =>
          r.sections.every((x) => x.state === "done"),
        ).length;
        return {
          ...p,
          content: String(mine.length),
          run: writing ? "Writing" : mine.length ? `${finished} done` : "Idle",
          dot: writing
            ? "#4bb07a"
            : mine.length
              ? "rgba(106,157,255,0.9)"
              : "rgba(240,240,244,0.3)",
        };
      }),
    [projects, runs],
  );

  /** The same, for topics: how many runs point at each one. */
  const countedSeries = useMemo(
    () =>
      seriesList.map((series) => ({
        ...series,
        topics: series.topics.map((topic) => {
          const mine = runs.filter((r) => r.topicId === topic.id);
          return {
            ...topic,
            content: String(mine.length),
            activity: mine.length
              ? ago(
                  mine.reduce(
                    (latest, r) =>
                      r.updatedAt > latest ? r.updatedAt : latest,
                    "",
                  ),
                )
              : "no runs",
          };
        }),
      })),
    [seriesList, runs],
  );

  const value = useMemo<Store>(
    () => ({
      advancedNav: ADVANCED_NAV,

      projectIdx,
      setProjectIdx: (i: number) => {
        setProjectIdx(i);
        setProjectOpen(false);
      },
      projectOpen,
      toggleProject: () => {
        setProjectOpen((v) => !v);
        setCreateOpen(false);
      },

      projects: countedProjects,
      projectsLoaded,
      // Clamped rather than indexed blindly: the switcher's index and the list
      // are separate pieces of state, and a stale index must not blank the
      // header while every screen reads `project.name` off it.
      project: countedProjects[projectIdx] ?? countedProjects[0],
      updateProject,

      projectSheet,
      openProjectSheet: (i: number) => {
        closeMenus();
        setProjectSheet(i);
      },
      newProject: () => {
        closeMenus();
        setProjectSheet("new");
      },
      addProject,
      removeProject,
      closeProjectSheet: () => setProjectSheet(null),

      confirm,
      askConfirm: setConfirm,
      closeConfirm: () => setConfirm(null),

      createOpen,
      toggleCreate: () => {
        setCreateOpen((v) => !v);
        setProjectOpen(false);
      },

      paletteOpen,
      openPalette: () => setPaletteOpen(true),
      closePalette: () => setPaletteOpen(false),
      query,
      setQuery,

      addSectionOpen,
      addSectionTarget,
      addSectionPackId,
      addPackSection,
      openAddSection: (target: AddSectionTarget, packId?: string) => {
        setAddSectionPackId(packId ?? null);
        setAddSectionTarget(target);
        setAddSectionOpen(true);
      },
      closeAddSection: () => setAddSectionOpen(false),

      runSetupOpen,
      /*
       * Opened cold, or opened on a topic.
       *
       * It always cleared the topic, which quietly undid the line every caller
       * wrote just before it — arriving from a topic's own page and being
       * asked which topic to write is the question you answered by being
       * there. A name passed in survives; opening it from the header or the
       * palette, where no topic is implied, still starts blank.
       */
      openRunSetup: (topicName?: string) => {
        closeMenus();
        runningTopic.current = null;
        setRunTopicName(topicName ?? null);
        setRunSetupOpen(true);
      },
      closeRunSetup: () => setRunSetupOpen(false),

      settings,
      saveSettings,
      reloadRuns,
      reloadSeries,
      seriesList: countedSeries,
      topicCount: seriesList.reduce((n, c) => n + c.topics.length, 0),
      runs,
      addSeries,
      updateSeries,
      readSeriesSource,
      clearSeriesSource,
      removeTopicSeries,
  mergeSeriesInto,
      moveTopicSeries,
      generateTopicsIn,
      addTopic,
      importTopics,
      updateTopic: patchTopic,
      deleteTopic,
      runTopic,
      runTopicNow,
      runTopicName,
      setRunTopicName,

      packs,
      updatePack,
      deletePack,
      duplicatePack,
      importPack,
      restorePack,
      draftPackId,
      editPack,
      loadPackDraft,
      newPack,
      savePack,

      packTab,
      setPackTab,
      contentTab,
      setContentTab,
      contentFilters,
      toggleContentFilter,
      clearContentFilters,
      contentQuery,
      setContentQuery,
      contentSort,
      sortContentBy,
      resetContent,
      quality,
      setQuality,
      builderStep,
      setBuilderStep,
      draft,
      setDraft,
      addDraftSection,
      updateDraftSection,
      removeDraftSection,
      moveDraftSection,
      moveDraftSectionTo,
      editingSection,
      setEditingSection,
      testSection,
      setTestSection,

      showInstructions,
      toggleInstructions: () => setShowInstructions((v) => !v),

      go,
    }),
    [
      addDraftSection,
      addPackSection,
      addSectionPackId,
      addSectionOpen,
      addTopic,
      addSeries,
      mergeSeriesInto,
      addSectionTarget,
      builderStep,
      countedProjects,
      countedSeries,
      runs,
      reloadRuns,
      reloadSeries,
      settings,
      saveSettings,
      clearContentFilters,
      closeMenus,
      contentFilters,
      contentQuery,
      contentSort,
      contentTab,
      createOpen,
      draft,
      editingSection,
      deleteTopic,
      generateTopicsIn,
      importTopics,
      patchTopic,
      runTopic,
      runTopicNow,
      runTopicName,
      go,
      moveDraftSection,
      moveDraftSectionTo,
      moveTopicSeries,
      paletteOpen,
      packTab,
      packs,
      updatePack,
      deletePack,
      duplicatePack,
      importPack,
      restorePack,
      draftPackId,
      editPack,
      loadPackDraft,
      newPack,
      savePack,
      projectIdx,
      projectsLoaded,
      projectOpen,
      addProject,
      confirm,
      projectSheet,
      quality,
      removeProject,
      query,
      runSetupOpen,
      removeDraftSection,
      removeTopicSeries,
      resetContent,
      setDraft,
      showInstructions,
      sortContentBy,
      testSection,
      seriesList,
      toggleContentFilter,
      updateDraftSection,
      updateSeries,
      readSeriesSource,
      clearSeriesSource,
      updateProject,
    ],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <AppProvider>");
  return store;
}

