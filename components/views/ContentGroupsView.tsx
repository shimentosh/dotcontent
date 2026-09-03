"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  USAGE,
  USAGE_ORDER,
  STATE_STYLE,
  docsByPack,
  outputsFor,
  type ContentDoc,
  type Decision,
  type UsageStatus,
} from "@/lib/content-docs";
import {
  isEditable,
  setDecision,
  statusOf,
  useDecisions,
} from "@/lib/decisions";
import { useStore } from "@/lib/store";
import { slugify } from "@/lib/content-docs";
import { partName } from "@/lib/topics";
import {
  deleteRun,
  listRuns,
  startWriting,
  type Run,
} from "@/lib/runs-client";
import { runToDoc } from "@/lib/run-doc";
import { CONTENT_TABS } from "@/components/views/content-tabs";

/** Where a row opens: the run that made it, or the document it is. */
const hrefFor = (doc: ContentDoc) =>
  doc.runId ? `/runs/${doc.runId}` : `/content/${doc.slug}`;
import { useTopicAdmin } from "@/components/topics/TopicAdmin";
import { font, panel, primary, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { FilterMenu, type FilterOption } from "@/components/ui/FilterMenu";
import type { RailItem } from "@/components/ui";
import {
  Button,
  Field,
  IconButton,
  Modal,
  Rail,
  Segmented,
  TabNav,
  TextInput,
} from "@/components/ui";
import { PencilIcon, PlayIcon, TrashIcon } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Popover";
import {
  CaretDown,
  CaretRight,
  CheckGlyph,
  CloseGlyph,
  FindGlyph,
  ListGlyph,
  OUTPUT_GLYPH,
  PulseGlyph,
  RedoGlyph,
  SortGlyph,
  StackGlyph,
  USAGE_GLYPH,
} from "@/components/ui/DocIcons";

/**
 * The digits out of "Part 07" / "Episode 12", for the tile.
 *
 * Padded, because the tiles are a monospace column down the left of the list
 * and "8" above "24" reads as a stray digit where "08" reads as a number in a
 * series. The tile is 34px, which fits two digits and not a word — the word is
 * on the tile's tooltip, where "Episode 08" is one hover away.
 *
 * An em dash for a topic with no number at all, rather than an empty tile: a
 * blank square in a column of numbers reads as something that failed to load.
 */
const partNumber = (part: string) => {
  const digits = /(\d+)/.exec(part)?.[1];
  if (!digits) return part.trim() || "—";
  return digits.padStart(2, "0");
};

/**
 * TOPIC · STATUS · UPDATED · chevron.
 *
 * SECTIONS — a progress bar and "12/12" — used to sit between status and
 * updated. It was the same figure on almost every row, because a topic that
 * has been produced is finished by definition; the two rows where it was not
 * 12/12 already said so in the status column, which reads "Writing". A column
 * that repeats another column on the rows that matter and says nothing on the
 * rest is a column you are scanning past.
 */
const GRID = "1fr 168px 132px 76px 96px";

/** The statuses you can pick — "Writing" is derived, so it is not offered. */
const DECISIONS: Decision[] = ["used", "ready", "ignored"];

/**
 * The status switcher: one status at a time, never a set.
 *
 * This was a checkbox menu, which asked a question nobody was answering. The
 * list is one lifecycle — an idea, then the writing of it, then what came out
 * — and you read it a stage at a time: what have I not started, what is in
 * flight, what is done. Ticking two boxes interleaves two stages into one
 * list, and the "0 selected means all" state that a checkbox menu needs made
 * the default screen a pile of everything at once.
 *
 * So it is a switcher, opening on IDEA — the shelf of things not yet made,
 * which is where the work starts.
 *
 * Used and Ignored are not tabs here: they are the end of the line, and a
 * permanent tab for a status nothing has yet is a dead segment. They join the
 * row the moment a topic carries one — see `statusTabs` — so nothing is ever
 * filtered out of reach.
 */
/*
 * Writing is not one of them.
 *
 * A run in flight is not a shelf you browse — it is a thing happening right
 * now, and hiding it behind a filter meant the only way to see what the
 * machine was doing was to remember to go and look. It has its own strip at
 * the top of the page instead, always on, whichever status you are reading.
 */
const STATUS_TABS: UsageStatus[] = ["idea", "ready"];

/** The status's colour, in the switcher. */
const StatusDot = ({ color }: { color: string }) => (
  <span
    style={{
      width: 6,
      height: 6,
      flex: "none",
      borderRadius: "50%",
      background: color,
    }}
  />
);

type SortKey = "recent" | "topic" | "status";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Most recent" },
  { key: "topic", label: "Topic A–Z" },
  // "Least finished" went with the SECTIONS column: it ordered the list by a
  // number that is no longer on screen, so the rows moved and nothing visible
  // explained why.
  // Content first, ideas last — the split "most recent" does not make.
  { key: "status", label: "Finished first" },
];

const chipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  height: 32,
  padding: "0 11px",
  borderRadius: 9,
  fontSize: 12.5,
  fontWeight: 600,
  background: w(0.05),
  border: `1px solid ${w(0.08)}`,
  color: "rgba(240,240,244,0.72)",
  cursor: "pointer",
};

/**
 * What this topic actually produced, in the pack's own order.
 *
 * A pack decides which sections run, and those sections roll up into outputs —
 * so this row of glyphs is the difference between a list of topics and a list
 * of content. Each one is lit when its sections are written, pulses while they
 * are being written, and sits dim until they run.
 */
function OutputsCell({ doc }: { doc: ContentDoc }) {
  const outputs = outputsFor(doc).filter((o) => o.total > 0);

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {outputs.map((output) => {
        const Glyph = OUTPUT_GLYPH[output.key];
        const st = STATE_STYLE[output.state];
        return (
          <span
            key={output.key}
            title={`${output.label} — ${output.done}/${output.total}`}
            aria-label={`${output.label} ${output.done} of ${output.total}`}
            style={{
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              borderRadius: 7,
              background: output.state === "queued" ? w(0.04) : st.bg,
              border: `1px solid ${w(0.06)}`,
              animation:
                output.state === "writing"
                  ? "os-pulse 1.1s ease-in-out infinite"
                  : undefined,
            }}
          >
            <Glyph
              size={12}
              stroke={output.state === "queued" ? t(0.28) : st.fg}
            />
          </span>
        );
      })}
    </span>
  );
}

/** The status pill. Once a topic is finished, it opens a picker. */
function StatusCell({
  doc,
  open,
  onOpen,
}: {
  doc: ContentDoc;
  open: boolean;
  onOpen: (next: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const status = statusOf(doc);
  const u = USAGE[status];
  const Glyph = USAGE_GLYPH[status];
  const editable = isEditable(doc);
  const marker = `status-${doc.slug}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest(`[data-menu="${marker}"]`)) ||
        Boolean(ref.current?.contains(target));
      if (!inside) onOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [marker, onOpen, open]);

  return (
    /*
      Stops the row underneath from navigating when the pill is used.

      Both halves matter, and stopPropagation alone is the half that looks
      sufficient and is not: the row is a real <a href>, so following the link
      is the browser's DEFAULT action, not something that bubbles. Stopping
      propagation kept the row's own handler from firing and let the navigation
      happen anyway — clicking the status pill opened the document instead of
      the menu.
    */
    <div
      ref={ref}
      style={{ justifySelf: "start", position: "relative" }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Hov
        onClick={editable ? () => onOpen(!open) : undefined}
        aria-expanded={editable ? open : undefined}
        aria-haspopup={editable ? "menu" : undefined}
        aria-label={
          editable ? `Status: ${u.label}. Change it` : `Status: ${u.label}`
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: editable ? "4px 7px 4px 9px" : "4px 9px",
          borderRadius: 20,
          fontSize: 11.5,
          fontWeight: 600,
          background: u.bg,
          color: u.fg,
          border: `1px solid ${open ? w(0.18) : "transparent"}`,
          cursor: editable ? "pointer" : "default",
        }}
        hover={editable ? { borderColor: w(0.18) } : undefined}
      >
        <Glyph
          size={11}
          stroke={u.fg}
          style={
            status === "writing"
              ? { animation: "os-pulse 1.1s ease-in-out infinite" }
              : undefined
          }
        />
        {u.label}
        {editable ? <CaretDown size={9} stroke={u.fg} /> : null}
      </Hov>

      <Popover
        anchorRef={ref}
        open={open}
        width={158}
        offset={6}
        data-menu={marker}
      >
        <div
          style={{
            padding: "6px 9px 7px",
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.14em",
            color: t(0.36),
          }}
        >
          MARK AS
        </div>
        {DECISIONS.map((d) => {
          const s = USAGE[d];
          const DGlyph = USAGE_GLYPH[d];
          const current = status === d;
          return (
            <Hov
              key={d}
              role="menuitemradio"
              aria-checked={current}
              onClick={() => {
                setDecision(doc, d);
                onOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 9px",
                borderRadius: 9,
                cursor: "pointer",
                fontSize: 12.5,
                color: current ? "#f0f0f4" : t(0.72),
              }}
              hover={{ background: w(0.09) }}
            >
              <DGlyph size={12} stroke={s.fg} />
              <span style={{ flex: 1 }}>{s.label}</span>
              {current ? <CheckGlyph size={11} stroke={s.fg} /> : null}
            </Hov>
          );
        })}
      </Popover>
    </div>
  );
}

/**
 * The row's own Run button.
 *
 * Three situations wear it, because from where you are sitting they are one
 * thing — make this topic:
 *
 *   · an idea nobody has run     → RUN, which creates the run and drives it
 *   · a run that stopped part-way → CARRY ON, from wherever it got to
 *   · a run with a failed section → RETRY, failures cleared first
 *
 * A run being written right now shows the same square, pulsing and dead: the
 * button has to hold its place or the row's controls shuffle sideways every
 * time a section finishes, and pressing Run on something already running is
 * not a thing to offer.
 *
 * A finished topic gets nothing here. Rewriting what is already written is a
 * decision about one section, and it lives on the document beside the section
 * it would replace.
 */
function RunCell({
  doc,
  busy,
  onRun,
}: {
  doc: ContentDoc;
  busy: boolean;
  onRun: () => void;
}) {
  const status = statusOf(doc);

  if (status === "writing") {
    return (
      <IconButton
        label={`${doc.topic} is being written now`}
        variant="quiet"
        disabled
      >
        <PulseGlyph size={12} stroke="currentColor" />
      </IconButton>
    );
  }

  const done =
    doc.sections.length > 0 && doc.sections.every((x) => x.state === "written");
  if (done) return null;

  // Nothing to address it by: a run row always has its run, and a topic row
  // always has its topic, but a document from neither cannot be started.
  if (!doc.runId && !doc.topicId) return null;

  const failed = status === "failed";
  const label = failed
    ? `Retry ${doc.topic}`
    : doc.runId
      ? `Carry on writing ${doc.topic}`
      : `Run ${doc.topic}`;

  return (
    <IconButton
      label={busy ? `Starting ${doc.topic}…` : label}
      variant="accent"
      disabled={busy}
      onClick={onRun}
      stopPropagation
    >
      {failed ? (
        <RedoGlyph size={12} stroke="currentColor" />
      ) : (
        <PlayIcon size={11} fill="currentColor" />
      )}
    </IconButton>
  );
}

/** Single-select menu, for sorting. */
function SortMenu({
  value,
  onPick,
}: {
  value: SortKey;
  onPick: (k: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = SORTS.find((s) => s.key === value)!;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Hov
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={chipStyle}
        hover={{ background: w(0.09), borderColor: w(0.14) }}
      >
        <SortGlyph size={12} stroke={t(0.5)} />
        {current.label}
        <CaretDown size={10} stroke={t(0.4)} />
      </Hov>

      <Popover anchorRef={ref} open={open} width={172} data-menu="sort">
        {SORTS.map((s) => (
          <Hov
            key={s.key}
            onClick={() => {
              onPick(s.key);
              setOpen(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "7px 9px",
              borderRadius: 9,
              cursor: "pointer",
              fontSize: 12.5,
              color: s.key === value ? "#f0f0f4" : t(0.7),
            }}
            hover={{ background: w(0.09) }}
          >
            <span style={{ width: 12, flex: "none" }}>
              {s.key === value ? (
                <CheckGlyph size={11} stroke="#6a9dff" />
              ) : null}
            </span>
            {s.label}
          </Hov>
        ))}
      </Popover>
    </div>
  );
}

/** An applied filter, with a way to take it off again. */
function ActiveChip({
  label,
  dot,
  onRemove,
}: {
  label: string;
  dot?: string;
  onRemove: () => void;
}) {
  return (
    <Hov
      as="span"
      onClick={onRemove}
      aria-label={`Remove filter ${label}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        height: 26,
        padding: "0 9px",
        borderRadius: 20,
        fontSize: 11.5,
        fontWeight: 600,
        background: w(0.07),
        border: `1px solid ${w(0.1)}`,
        color: t(0.75),
        cursor: "pointer",
      }}
      hover={{ background: w(0.12), color: "#f0f0f4" }}
    >
      {dot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dot,
          }}
        />
      ) : null}
      {label}
      <CloseGlyph size={10} stroke={t(0.5)} />
    </Hov>
  );
}

type FilterKey = "status" | "template" | "series";

export function ContentGroupsView() {
  const {
    go,
    updateTopic,
    deleteTopic,
    reloadRuns,
    askConfirm,
    seriesList,
    packs,
    runTopicNow,
  } = useStore();

  /** The series strip, the two dialogs, and the state behind them. */
  const admin = useTopicAdmin();

  /*
   * What has actually been written.
   *
   * The rows above this are topics and the design's sample documents; these are
   * real runs off the server, with real text behind every section. Fetched
   * rather than seeded, and merged in below so a pack you ran ten minutes ago
   * appears in the list you came here to read.
   */
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => {
    void listRuns()
      .then(setRuns)
      // Silent: the list is still useful without them, and a failed fetch must
      // not blank a page that has plenty else to show.
      .catch(() => {});
  }, []);

  /**
   * Start a failed run again.
   *
   * The server clears the failures and picks up where the drive stopped, so
   * this is one press rather than a section-by-section repair. The list is
   * re-read straight after: the row has to leave the Failed tab the moment it
   * is writing again, or the button looks like it did nothing.
   */
  const retry = useCallback(async (runId: string) => {
    try {
      await startWriting(runId);
    } catch {
      // The row keeps saying Failed, which is still true. Nothing else to say.
    }
    await listRuns()
      .then(setRuns)
      .catch(() => {});
    void reloadRuns();
  }, [reloadRuns]);

  /**
   * The row that is being started, so its button can say so.
   *
   * By slug rather than a boolean: pressing Run on one row must not grey out
   * the Run on every other row, which is what a single "starting" flag does to
   * a list.
   */
  const [starting, setStarting] = useState<string | null>(null);

  /**
   * Run the row.
   *
   * Three things wear this one button, because from where you are sitting they
   * are one thing — make this topic. A topic with no run gets one created and
   * driven; a run that stopped part-way carries on; a run that failed clears
   * its failures first (the server does that on the same call). Either way you
   * land on the run and watch it write, because that is what you asked for.
   */
  const runRow = useCallback(
    async (doc: ContentDoc) => {
      if (starting) return;
      setStarting(doc.slug);
      try {
        if (doc.runId) {
          await retry(doc.runId);
          go(`/runs/${doc.runId}`);
          return;
        }
        if (!doc.topicId) return;
        // Null means it could not start unasked — no template on the shelf —
        // and the run sheet has opened to ask which one. Nowhere to go yet.
        const id = await runTopicNow(doc.topicId);
        if (id) go(`/runs/${id}`);
      } finally {
        setStarting(null);
      }
    },
    [starting, retry, runTopicNow, go],
  );

  /** The topic open in the edit sheet, as a draft. */
  const [editing, setEditing] = useState<{
    slug: string;
    topicId?: string;
    topic: string;
  } | null>(null);

  /**
   * Delete what the row actually is.
   *
   * A row is either content a run produced or a topic nobody has run yet, and
   * they are different things to delete. Removing the content leaves the topic
   * to be run again; removing an unwritten topic takes the idea itself.
   */
  const removeRow = (doc: ContentDoc) => {
    if (doc.runId) {
      void deleteRun(doc.runId)
        .then(reloadRuns)
        .catch(() => {});
      return;
    }
    if (doc.topicId) deleteTopic(doc.topicId);
  };

  // Re-renders this list whenever a status is changed anywhere.
  const version = useDecisions();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [open, setOpen] = useState<FilterKey | null>(null);
  const [statusOpen, setStatusOpen] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, string[]>>({
    status: ["idea"],
    template: [],
    series: [],
  });

  const toggle = (key: FilterKey, value: string) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }));

  const clear = (key: FilterKey) =>
    setFilters((prev) => ({ ...prev, [key]: [] }));

  const clearAll = () => {
    // The series is navigation now, not a filter — the tab survives a clear.
    // Neither does the status: it is a switcher, and a switcher with nothing
    // selected is not a state it has. Clearing returns it to Idea.
    setFilters((prev) => ({
      status: ["idea"],
      template: [],
      series: prev.series,
    }));
    setQuery("");
  };

  /** The switcher's current status, and how it moves. */
  const status = (filters.status[0] ?? "idea") as UsageStatus;
  const pickStatus = (next: UsageStatus) =>
    setFilters((prev) => ({ ...prev, status: [next] }));

  /**
   * The documents as this screen sees them: the data underneath, with the
   * renames applied and the removed ones dropped. The documents themselves are
   * left alone, so /content/<slug> still opens what it always did.
   */
  const DOCS = useMemo(() => {
    /*
     * Every topic in this workspace, plus what has actually been written.
     *
     * The sample documents are gone. They put twenty-four invented topics on
     * this list under a template that does not exist, each opening a page of
     * text nobody wrote — which made the screen look full and made it
     * impossible to see what was really there.
     *
     * A topic with no run gets a row with no sections, which `statusOf` reads
     * as "idea": the first step of the same lifecycle that ends in used or
     * ignored. Real runs go in front, newest first, because the thing you just
     * made is the thing you came to look at.
     */
    const shelfOf = new Map(
      seriesList.flatMap((series) =>
        series.topics.map((topic) => [topic.id, series.id] as const),
      ),
    );

    const produced: ContentDoc[] = runs.map((r) => ({
      ...runToDoc(
        r,
        packs.find((x) => x.id === r.packSlug),
      ),
      // A run's shelf is its topic's shelf. `inputs.series` is the name that
      // was typed into it, which is a label, not an identity.
      seriesId: r.topicId ? shelfOf.get(r.topicId) : undefined,
    }));

    const written = new Set(produced.map((d) => d.topic.toLowerCase()));
    const rows: ContentDoc[] = [];

    for (const series of seriesList) {
      for (const topic of series.topics) {
        // A topic whose run is already in `produced` would otherwise appear
        // twice: once as the content, once as the idea it started as.
        if (written.has(topic.name.toLowerCase())) continue;
        rows.push({
          slug: slugify(topic.name),
          topicId: topic.id,
          seriesId: series.id,
          topic: topic.name,
          series: series.name,
          pack: series.pack || "No template",
          // Zero-padded: the tiles are a monospace column, and "8" beside "24"
          // reads as a stray digit where "08" reads as a part number.
          part:
            topic.part !== null
              ? partName(series.partLabel, topic.part)
              : "",
          blurb: "",
          decision: topic.decision,
          created: topic.activity,
          updated: topic.activity,
          at: topic.updatedAt,
          sections: [],
        });
      }
    }

    return [...produced, ...rows];
  }, [seriesList, runs, packs]);

  const { groups, shown, options, active } = useMemo(() => {
    void version;
    const q = query.trim().toLowerCase();

    const passes = {
      search: (d: ContentDoc) =>
        !q ||
        `${d.topic} ${d.pack} ${d.blurb} ${d.series}`.toLowerCase().includes(q),
      status: (d: ContentDoc) =>
        !filters.status.length || filters.status.includes(statusOf(d)),
      pack: (d: ContentDoc) =>
        !filters.template.length || filters.template.includes(d.pack),
      series: (d: ContentDoc) =>
        !filters.series.length || filters.series.includes(d.seriesId ?? ""),
    };

    const matched = DOCS.filter(
      (d) =>
        passes.search(d) &&
        passes.status(d) &&
        passes.pack(d) &&
        passes.series(d),
    );

    /**
     * Counts for one dimension are taken with that dimension left open, so
     * picking "Ignored" still shows how many Used topics there are. Values
     * that would match nothing are dropped unless they are already picked.
     */
    const facet = (
      pool: ContentDoc[],
      pick: (d: ContentDoc) => string,
      values: string[],
      selected: string[],
      label: (v: string) => string,
      dot?: (v: string) => string,
    ): FilterOption[] =>
      values
        .map((value) => ({
          value,
          label: label(value),
          count: pool.filter((d) => pick(d) === value).length,
          dot: dot?.(value),
        }))
        .filter((o) => o.count > 0 || selected.includes(o.value));

    const forStatus = DOCS.filter(
      (d) => passes.search(d) && passes.pack(d) && passes.series(d),
    );
    const forPack = DOCS.filter(
      (d) => passes.search(d) && passes.status(d) && passes.series(d),
    );
    const forSeries = DOCS.filter(
      (d) => passes.search(d) && passes.status(d) && passes.pack(d),
    );

    const packs = [...new Set(DOCS.map((d) => d.pack))].sort();
    const series = [...new Set(DOCS.map((d) => d.seriesId ?? ""))];

    /*
     * Writing first, then what needs a person: a failed run is the one thing
     * on the list that is waiting on you rather than on the model.
     */
    const rank: Record<UsageStatus, number> = {
      writing: 0,
      failed: 1,
      ready: 2,
      used: 3,
      idea: 4,
      ignored: 5,
    };

    const sorted = [...matched].sort((a, b) => {
      switch (sort) {
        case "topic":
          return a.topic.localeCompare(b.topic);
        case "status":
          /*
           * Status first, then recency inside it.
           *
           * This is the view that separates finished content from ideas, which
           * "most recent" deliberately does not — sorted by time, an idea from
           * yesterday belongs between two runs from yesterday. Without the
           * second key, rows sharing a status fell back to build order and
           * moved for reasons nothing on screen explained.
           */
          return (
            rank[statusOf(a)] - rank[statusOf(b)] || b.at.localeCompare(a.at)
          );
        default:
          /*
           * Most recent, actually sorted.
           *
           * This used to return 0 and lean on the order DOCS builds — runs
           * first, then topics shelf by shelf — so a topic you had just added
           * appeared at the bottom of its shelf's block with nothing above it
           * explaining why. `at` is an ISO instant and sorts as a string, so
           * newest first is a plain descending compare.
           *
           * A tie falls back to the name, so equal timestamps give a stable
           * order rather than one that reshuffles on every render.
           */
          return b.at.localeCompare(a.at) || a.topic.localeCompare(b.topic);
      }
    });

    return {
      groups: docsByPack(sorted),
      shown: sorted.length,
      options: {
        status: facet(
          forStatus,
          (d) => statusOf(d),
          USAGE_ORDER,
          filters.status,
          (v) => USAGE[v as UsageStatus].label,
          (v) => USAGE[v as UsageStatus].dot,
        ),
        template: facet(
          forPack,
          (d) => d.pack,
          packs,
          filters.template,
          (v) => v,
        ),
        series: facet(
          forSeries,
          (d) => d.seriesId ?? "",
          series,
          filters.series,
          // The facet is keyed by id but read by people: anything rendering it
          // needs the shelf's name, not `ser_mtbuo7f4e59wg`.
          (id) => seriesList.find((x) => x.id === id)?.name ?? "No series",
        ),
      },
      // Series and status are left out on purpose: both are controls that
      // always read their own state — the rail says which shelf, the switcher
      // says which status — and a chip that removes one would leave it with
      // nothing selected, which is not a state either of them has.
      active: filters.template.map((value) => ({
        key: "template" as FilterKey,
        value,
        label: value,
        dot: undefined as string | undefined,
      })),
    };
  }, [DOCS, query, filters, sort, version, seriesList]);

  /**
   * The switcher's segments: the three lifecycle stages, plus any end state a
   * topic has actually reached. Mark one Used and a USED segment appears —
   * which is the only way back to it, so it has to.
   */
  const statusTabs = useMemo(() => {
    const present = new Set(options.status.map((o) => o.value));
    return [
      ...STATUS_TABS,
      ...USAGE_ORDER.filter(
        (s) =>
          !STATUS_TABS.includes(s) &&
          present.has(s) &&
          // Writing has the strip; a segment for it would be a second place
          // saying the same thing, and the worse of the two. It comes back
          // only if it is the segment you are standing on, because otherwise
          // there would be no way off it.
          (s !== "writing" || status === "writing"),
      ),
    ];
  }, [options.status, status]);

  /**
   * What the machine is doing right now.
   *
   * Off DOCS rather than off the filtered list on purpose: a run in flight is
   * news whatever you happen to be reading, and a strip that empties because
   * you switched to Ready would be a status light you cannot trust.
   */
  const writingNow = useMemo(
    () =>
      DOCS.filter((d) => statusOf(d) === "writing").map((d) => ({
        slug: d.slug,
        topic: d.topic,
        pack: d.pack,
        // Where this row opens. Carried rather than rebuilt from the slug: a
        // row that came from a run has the RUN's id as its slug, and
        // `/content/run_…` is a 404 that reads as "your work is gone".
        href: hrefFor(d),
        written: d.sections.filter((x) => x.state === "written").length,
        total: d.sections.length,
      })),
    [DOCS],
  );

  const anyFilter = active.length > 0 || query.trim().length > 0;

  /*
   * The tabs run off the series filter rather than a second piece of state, so
   * picking one narrows the list the same way the menu used to and the counts
   * on the other filters stay honest.
   */
  const ALL = "";
  const seriesTab = filters.series[0] ?? ALL;
  const activeSeries =
    admin.seriesList.find((series) => series.id === seriesTab) ?? null;

  const pickSeries = (id: string) =>
    setFilters((prev) => ({ ...prev, series: id === ALL ? [] : [id] }));

  /**
   * Counts come from the facet, so they already answer "how many are left in
   * here once the status, pack and search are applied". A series with none
   * still gets a tab — it is where you go to make its first idea.
   */
  const seriesCounts = new Map(options.series.map((o) => [o.value, o.count]));

  /*
   * How far along each shelf is, for the colour of its glyph.
   *
   * Off the UNFILTERED documents, unlike the counts beside them: a shelf that
   * is finished is finished whatever the search box says, and a glyph that
   * turned from green to grey because you typed three letters would be
   * reporting on the filter rather than on the work.
   */
  const shelfProgress = new Map<string, { total: number; written: number }>();
  for (const doc of DOCS) {
    if (!doc.seriesId) continue;
    const at = shelfProgress.get(doc.seriesId) ?? { total: 0, written: 0 };
    at.total += 1;
    if (doc.sections.length > 0) at.written += 1;
    shelfProgress.set(doc.seriesId, at);
  }

  /**
   * The templates, listed the way the series are.
   *
   * The same choice was already here as a dropdown in the toolbar, which is
   * the right control for a filter you set once and forget. It is the wrong
   * one for the thing this page is organised BY: the list below is grouped by
   * template, so which template you are looking at should be a place you
   * stand, visible without opening anything — exactly as the shelf is.
   *
   * Counts come off the same facet as the menu, so the number beside a
   * template is the number of rows picking it would leave.
   */
  const railTemplates: RailItem[] = (() => {
    const counts = new Map(options.template.map((o) => [o.value, o.count]));
    /*
     * Every template in the workspace, not only the ones the current filter
     * left standing — the shelf list works that way, and a rail whose rows
     * come and go as you filter is a rail you cannot navigate by. A template
     * with nothing under it right now shows a zero and still takes you there.
     */
    const rows = packs.map((pack) => ({
      id: pack.name,
      label: pack.name,
      count: counts.get(pack.name) ?? 0,
      icon: (
        <StackGlyph
          size={12}
          stroke={counts.get(pack.name) ? "#6a9dff" : t(0.3)}
        />
      ),
    }));

    /*
     * Anything the facet knows about that is not a template in the library:
     * "No pack", which is what a topic on a shelf with no template carries,
     * and the name of a template that has since been deleted but whose runs
     * are still here. Both are places rows actually sit, so both get a row —
     * keyed on "" would have missed them, because the value is the label the
     * row was given, not an empty string.
     */
    const known = new Set(packs.map((pack) => pack.name));
    for (const [value, count] of counts) {
      if (known.has(value) || count === 0) continue;
      rows.push({
        id: value,
        label: value || "No template",
        count,
        icon: <StackGlyph size={12} stroke={t(0.3)} />,
      });
    }

    return [
      {
        id: ALL,
        label: "All templates",
        count: [...counts.values()].reduce((n, c) => n + c, 0),
        icon: <ListGlyph size={12} stroke={t(0.42)} />,
      },
      ...rows,
    ];
  })();

  const templateTab = filters.template[0] ?? ALL;
  const pickTemplate = (value: string) =>
    setFilters((prev) => ({
      ...prev,
      template: value === ALL ? [] : [value],
    }));

  const railSeries: RailItem[] = [
    {
      id: ALL,
      label: "All series",
      count: [...seriesCounts.values()].reduce((n, c) => n + c, 0),
      icon: <ListGlyph size={12} stroke={t(0.42)} />,
    },
    ...admin.seriesList.map((series) => {
      const at = shelfProgress.get(series.id) ?? { total: 0, written: 0 };
      return {
        id: series.id,
        label: series.name,
        count: seriesCounts.get(series.id) ?? 0,
        icon: (
          <StackGlyph
            size={12}
            stroke={
              at.total > 0 && at.written === at.total
                ? "#4bb07a"
                : at.written > 0
                  ? "#6a9dff"
                  : t(0.3)
            }
          />
        ),
      };
    }),
  ];

  const brief = activeSeries ? admin.briefFor(activeSeries) : null;

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1180,
        margin: "0 auto",
        padding: "34px 30px 60px",
      }}
    >
      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          margin: "0 0 5px",
        }}
      >
        Content
      </h1>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13.5,
          color: t(0.48),
          maxWidth: 660,
        }}
      >
        Everything the templates have produced, under the template that produced
        it. Each template runs its own set of sections, so each one turns out a
        different shape of content.
      </p>

      <TabNav tabs={CONTENT_TABS} />

      {/* Whatever is being written, at the top, always. */}
      {writingNow.length ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 14,
            padding: "10px 13px",
            borderRadius: 13,
            background: "rgba(0,87,252,0.08)",
            border: "1px solid rgba(0,87,252,0.22)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#6a9dff",
              animation: "os-pulse 1.1s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: "0.14em",
              color: "#6a9dff",
            }}
          >
            WRITING NOW
          </span>

          {writingNow.map((doc) => (
            <Hov
              key={doc.slug}
              onClick={() => go(doc.href)}
              href={doc.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                color: "inherit",
                textDecoration: "none",
                background: w(0.06),
                border: `1px solid ${w(0.09)}`,
              }}
              hover={{ background: w(0.12) }}
            >
              <span
                style={{
                  maxWidth: 260,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {doc.topic}
              </span>
              <span
                style={{ fontFamily: font.mono, fontSize: 11, color: t(0.45) }}
              >
                {doc.written}/{doc.total}
              </span>
            </Hov>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            height: 32,
            width: 260,
            padding: "0 11px",
            borderRadius: 9,
            background: "rgba(0,0,0,0.28)",
            border: `1px solid ${w(0.08)}`,
          }}
        >
          <FindGlyph size={13} stroke={t(0.4)} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics and templates…"
            aria-label="Search topics and templates"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f0f0f4",
              fontSize: 12.5,
            }}
          />
        </div>

        <Segmented
          size="sm"
          value={status}
          onChange={pickStatus}
          options={statusTabs.map((s) => ({
            value: s,
            label: USAGE[s].label,
            icon: <StatusDot color={USAGE[s].dot} />,
          }))}
        />
        <FilterMenu
          label="Template"
          icon={<StackGlyph size={12} stroke={t(0.5)} />}
          options={options.template}
          selected={filters.template}
          open={open === "template"}
          onOpen={(next) => setOpen(next ? "template" : null)}
          onToggle={(v) => toggle("template", v)}
          onClear={() => clear("template")}
        />
        <SortMenu value={sort} onPick={setSort} />

        <span style={{ fontSize: 12, color: t(0.4) }}>
          {shown} {shown === 1 ? "topic" : "topics"}
        </span>

        {/* Both used to live on a separate Topics page that showed these same
            rows from a different source. */}
        <Hov
          as="span"
          onClick={admin.openNewSeries}
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 13px",
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            color: t(0.75),
            background: w(0.06),
            border: `1px solid ${w(0.09)}`,
          }}
          hover={{ background: w(0.12), color: "#f0f0f4" }}
        >
          + New series
        </Hov>

        <Hov
          as="span"
          onClick={() => admin.openNewTopic()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 13px",
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            ...primary,
          }}
        >
          + New topic
        </Hov>
      </div>

      {/*
        The series, as a rail.

        They were a row of pills, one per shelf, on one line. Six shelves with
        real names already ran past the edge of the panel, and the answer to
        "what happens at twelve" was that you could not reach half of them. A
        column has room: every shelf visible at once, its own line for its
        name, and the count where the eye already looks for one.

        The rail is a filter, not a route — the list beside it stays grouped by
        TEMPLATE, and the shelf's own controls sit above it because they act on
        the one shelf that is selected.
      */}
      <div
        style={{
          display: "grid",
          /*
           * The work on the left, the places to stand on the right.
           *
           * The rails were first, so the topics — the thing you came to read —
           * started a third of the way across the screen behind two columns of
           * navigation. Reading goes left to right, and what you are reading
           * should be where reading starts.
           */
          gridTemplateColumns: admin.seriesList.length ? "1fr 212px" : "1fr",
          gap: 14,
          alignItems: "start",
        }}
      >

        <div style={{ minWidth: 0 }}>
          {activeSeries ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 650 }}>
                {activeSeries.name}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                {admin.controlsFor(activeSeries)}
              </span>
            </div>
          ) : null}

          {brief ? <div style={{ marginBottom: 12 }}>{brief}</div> : null}

          {anyFilter ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              {query.trim() ? (
                <ActiveChip
                  label={`“${query.trim()}”`}
                  onRemove={() => setQuery("")}
                />
              ) : null}
              {active.map((a) => (
                <ActiveChip
                  key={`${a.key}-${a.value}`}
                  label={a.label}
                  dot={a.dot}
                  onRemove={() => toggle(a.key, a.value)}
                />
              ))}
              <Hov
                as="span"
                onClick={clearAll}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: t(0.45),
                  cursor: "pointer",
                  padding: "0 4px",
                }}
                hover={{ color: "#f0f0f4" }}
              >
                Clear all
              </Hov>
            </div>
          ) : null}

          <div
            style={{
              ...panel(18),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 14,
                padding: "10px 18px",
                borderBottom: `1px solid ${w(0.07)}`,
                background: w(0.02),
                fontFamily: font.mono,
                fontSize: 9.5,
                letterSpacing: "0.13em",
                color: t(0.38),
              }}
            >
              <span>TOPIC</span>
              <span>OUTPUTS</span>
              <span>STATUS</span>
              <span>UPDATED</span>
              <span />
            </div>

            {groups.map((group) => {
              // Every topic in a pack runs the same sections, so the first one
              // says what shape this pack's content takes.
              const shape = outputsFor(group.docs[0]).filter(
                (o) => o.total > 0,
              );
              return (
                <div key={group.pack}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "11px 18px 8px",
                      background: w(0.015),
                    }}
                  >
                    <StackGlyph size={13} stroke={t(0.45)} />
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 9.5,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: t(0.5),
                      }}
                    >
                      {group.pack}
                    </span>
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        padding: "2px 7px",
                        borderRadius: 20,
                        background: w(0.06),
                        color: t(0.4),
                      }}
                    >
                      {shape.length} OUTPUTS
                    </span>
                    <span
                      style={{ flex: 1, height: 1, background: w(0.055) }}
                    />
                    <span style={{ fontSize: 11, color: t(0.32) }}>
                      {group.docs.length}{" "}
                      {group.docs.length === 1 ? "topic" : "topics"}
                    </span>
                  </div>

                  {group.docs.map((doc) => {
                    const status = statusOf(doc);
                    const u = USAGE[status];

                    return (
                      <Hov
                        key={doc.slug}
                        onClick={() => go(hrefFor(doc))}
                        href={hrefFor(doc)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: GRID,
                          gap: 14,
                          alignItems: "center",
                          padding: "12px 18px",
                          borderTop: `1px solid ${w(0.04)}`,
                          cursor: "pointer",
                          color: "inherit",
                          textDecoration: "none",
                          transition: "background 140ms",
                          opacity: status === "ignored" ? 0.62 : 1,
                        }}
                        hover={{ background: w(0.055), opacity: 1 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            minWidth: 0,
                          }}
                        >
                          <span
                            /* The whole phrase, so the bare digits in the tile
                               have somewhere to say what they are. */
                            title={doc.part || "No part number"}
                            aria-label={doc.part || "No part number"}
                            style={{
                              width: 34,
                              height: 34,
                              flex: "none",
                              borderRadius: 11,
                              display: "grid",
                              placeItems: "center",
                              background: u.bg,
                              border: `1px solid ${w(0.07)}`,
                            }}
                          >
                            {/*
                          The part number, where an identical glyph used to be.

                          Every row carried the same topic glyph, tinted by a
                          status the chip beside it already named — so the tile
                          was 34 square pixels of nothing. The number was a
                          separate grey pill wedged between the title and the
                          space it needed. Merged, the tile earns its place and
                          the title gets its line back.
                        */}
                            <span
                              style={{
                                fontFamily: font.mono,
                                fontSize: 12.5,
                                fontWeight: 500,
                                letterSpacing: "-0.01em",
                                color: doc.part ? u.fg : t(0.3),
                              }}
                            >
                              {partNumber(doc.part)}
                            </span>
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13.5,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {doc.topic}
                            </div>
                            <div
                              style={{
                                marginTop: 2,
                                fontSize: 11.5,
                                color: t(0.42),
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {/* The pack is the heading above; the line is what this topic is. */}
                              {doc.blurb}
                            </div>
                          </div>
                        </div>

                        <OutputsCell doc={doc} />

                        <StatusCell
                          doc={doc}
                          open={statusOpen === doc.slug}
                          onOpen={(next) =>
                            setStatusOpen(next ? doc.slug : null)
                          }
                        />

                        <span
                          style={{
                            fontFamily: font.mono,
                            fontSize: 10.5,
                            color: t(0.35),
                          }}
                        >
                          {doc.updated}
                        </span>

                        <span
                          style={{
                            justifySelf: "end",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <RunCell
                            doc={doc}
                            busy={starting === doc.slug}
                            onRun={() => void runRow(doc)}
                          />
                          <IconButton
                            label={`Edit ${doc.topic}`}
                            onClick={() =>
                              setEditing({
                                slug: doc.slug,
                                topicId: doc.topicId,
                                topic: doc.topic,
                              })
                            }
                            stopPropagation
                          >
                            <PencilIcon size={12} stroke="currentColor" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${doc.topic}`}
                            variant="danger"
                            onClick={() =>
                              askConfirm({
                                title: doc.runId
                                  ? `Delete the content for “${doc.topic}”?`
                                  : `Delete the topic “${doc.topic}”?`,
                                body: doc.runId
                                  ? "Every section written for it goes. The topic stays, so it can be run again."
                                  : "It has produced nothing yet, so nothing written is lost.",
                                confirmLabel: doc.runId
                                  ? "Delete content"
                                  : "Delete topic",
                                onConfirm: () => removeRow(doc),
                              })
                            }
                            stopPropagation
                          >
                            <TrashIcon size={12} stroke="currentColor" />
                          </IconButton>
                          <CaretRight size={13} stroke={t(0.3)} />
                        </span>
                      </Hov>
                    );
                  })}
                </div>
              );
            })}

            {shown === 0 ? (
              <div
                style={{
                  padding: "30px 18px",
                  fontSize: 13,
                  color: t(0.42),
                  textAlign: "center",
                }}
              >
                No topic matches these filters.{" "}
                <Hov
                  as="span"
                  onClick={clearAll}
                  style={{
                    color: "#0057fc",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear all
                </Hov>
              </div>
            ) : null}
          </div>
        </div>
        {admin.seriesList.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Templates first: the list below is grouped by template, so it
                is the coarser of the two places you can stand. */}
            {railTemplates.length > 1 ? (
              <Rail
                label="TEMPLATES"
                wrap
                count={railTemplates.length - 1}
                activeId={templateTab}
                onPick={pickTemplate}
                items={railTemplates}
              />
            ) : null}

            <Rail
              label="SERIES"
              wrap
              count={admin.seriesList.length}
              activeId={seriesTab}
              onPick={pickSeries}
              items={railSeries}
            />
          </div>
        ) : null}
      </div>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit topic"
        subtitle="What this topic is called on every screen it appears."
        icon={<PencilIcon size={15} stroke="currentColor" />}
        width={560}
        footer={
          <>
            <span style={{ fontSize: 11.5, color: t(0.4) }}>
              Its sections are edited on the topic page itself.
            </span>
            <Button
              onClick={() => setEditing(null)}
              style={{ marginLeft: "auto" }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!editing?.topic.trim()}
              onClick={() => {
                if (!editing || !editing.topic.trim()) return;
                // Renames the TOPIC, which is what the row is. A run's title
                // follows its topic, so both rows read the new name.
                if (editing.topicId) {
                  updateTopic(editing.topicId, { name: editing.topic.trim() });
                }
                setEditing(null);
              }}
            >
              Save topic
            </Button>
          </>
        }
      >
        {editing ? (
          <>
            <Field label="Topic">
              <TextInput
                autoFocus
                value={editing.topic}
                onChange={(e) =>
                  setEditing({ ...editing, topic: e.target.value })
                }
              />
            </Field>
          </>
        ) : null}
      </Modal>

      {admin.dialogs}
    </div>
  );
}
