"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import {
  SETTABLE_STATUS,
  TOPIC_BATCHES,
  TOPIC_STATUS,
  parseTopicLines,
  sourceLines,
  themesOf,
  partName,
  type Series,
  type TopicStatus,
} from "@/lib/topics";
import { useStore } from "@/lib/store";
import { color, font, t, w } from "@/lib/theme";
import {
  Button,
  Chip,
  Field,
  IconButton,
  Modal,
  Segmented,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from "@/components/ui";
import {
  CaretDown,
  CheckGlyph,
  DocGlyph,
  StackGlyph,
  TopicGlyph,
} from "@/components/ui/DocIcons";
import { BoltIcon, PencilIcon, PlusIcon } from "@/components/ui/Icons";
import { findSame, nearMatches, partitionNew } from "@/lib/dedupe";

/**
 * Managing topics, wherever the topics are shown.
 *
 * This lived on a Topics page that showed the same rows as Content, grouped the
 * same way, from a different source. Rather than keep two lists of one thing,
 * the page went and its controls moved here: the series strip, the two
 * dialogs, and the state behind them, packaged so one screen can mount the lot.
 */

/**
 * A line under a field, in one of two temperatures.
 *
 * `stop` is a rule the form will not let past; `watch` is something worth
 * seeing that is nobody's business to refuse — two names can be close and
 * still be two things.
 */
function Note({
  tone,
  children,
}: {
  tone: "stop" | "watch";
  children: ReactNode;
}) {
  const fg = tone === "stop" ? "#d1656b" : "#c99a5c";
  return (
    <div
      style={{
        display: "flex",
        gap: 7,
        marginTop: 8,
        padding: "7px 10px",
        borderRadius: 9,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: fg,
        background:
          tone === "stop" ? "rgba(209,101,107,0.1)" : "rgba(201,154,92,0.1)",
        border: `1px solid ${tone === "stop" ? "rgba(209,101,107,0.24)" : "rgba(201,154,92,0.24)"}`,
      }}
    >
      <span aria-hidden style={{ flex: "none", fontWeight: 700 }}>
        {tone === "stop" ? "!" : "?"}
      </span>
      <span>{children}</span>
    </div>
  );
}

const NO_PACK = "";

/** Generation is instant and local, but a list nobody can read helps no one. */
const MAX_BATCH = 50;

/** The batch picker's last segment: type your own number instead. */
const CUSTOM = "custom";

const clampBatch = (raw: string) => {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, MAX_BATCH);
};

/**
 * The packs a shelf can be pointed at — the real library, not a fixed list.
 *
 * A pack whose name is already on a series stays offered even after it is
 * deleted: dropping it would blank the field the moment the picker opened,
 * which reads as the app losing the setting rather than the pack going.
 */
function usePackOptions(current: string) {
  const { packs } = useStore();
  return useMemo(() => {
    const names = packs.map((p) => p.name);
    if (current && !names.includes(current)) names.push(current);
    return [
      { value: NO_PACK, label: "No template" },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [packs, current]);
}

const STATUS_OPTIONS = SETTABLE_STATUS.map((s) => ({
  value: s,
  label: TOPIC_STATUS[s].label,
}));

const THEME_PLACEHOLDER = [
  "dropshipping",
  "product research",
  "ad creative",
].join("\n");

const BRIEF_PLACEHOLDER = [
  "One theme per line — what this shelf is about.",
  "",
  "free photo tools",
  "no signup needed",
].join("\n");

const IMPORT_PLACEHOLDER = [
  "One topic per line:",
  "",
  "Hook banks that actually work",
  "What to send after they reply",
  "Pricing pages, torn apart",
].join("\n");

const kicker = {
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.14em",
  color: t(0.4),
} as const;

type TopicForm = {
  mode: "one" | "many";
  editing: string | null;
  seriesId: string;
  status: TopicStatus;
  name: string;
  context: string;
  text: string;
};

const blankForm = (seriesId: string): TopicForm => ({
  mode: "one",
  editing: null,
  seriesId,
  status: "idea",
  name: "",
  context: "",
  text: "",
});

/**
 * The controls that belong to a series: the pack its topics run through, a way
 * to add one by hand, the button that makes the next idea, and the toggle for
 * the brief behind it.
 *
 * A fragment rather than a row, so the screen decides the line they sit on —
 * the end of a tab row here, a group header band elsewhere.
 */
export function SeriesControls({
  series,
  open,
  onToggle,
  onGenerate,
  onAddTopic,
}: {
  series: Series;
  open: boolean;
  onToggle: () => void;
  onGenerate: (count: number) => void;
  onAddTopic: () => void;
}) {
  return (
    <>
      <Chip
        tone={series.pack ? "accent" : "mute"}
        icon={<StackGlyph size={10} stroke="currentColor" />}
      >
        {series.pack || "No template"}
      </Chip>
      {/* What the next thing written here will be called. The counter is the
          point of a NUMBERED series, so it sits on the shelf rather than inside
          a dialog you have to open to find out — and says nothing at all on a
          shelf that does not number, where a "next part" would be a promise
          about something that is never going to be written. */}
      {series.numbered ? (
        <Chip tone="mute" mono>
          next · {partName(series.partLabel, series.nextPart).toLowerCase()}
        </Chip>
      ) : (
        <Chip tone="mute" mono>
          no parts
        </Chip>
      )}
      <IconButton label={`Add a topic to ${series.name}`} onClick={onAddTopic}>
        <PlusIcon size={12} stroke="currentColor" />
      </IconButton>
      <Button
        variant="accent"
        icon={<BoltIcon size={11} stroke="currentColor" />}
        onClick={() => onGenerate(1)}
        label={`Generate the next topic in ${series.name}`}
        style={{ height: 26 }}
      >
        Generate next
      </Button>
      <Button
        onClick={onToggle}
        iconRight={
          <CaretDown
            size={10}
            stroke="currentColor"
            style={{ transform: open ? "rotate(180deg)" : "none" }}
          />
        }
        label={`Brief for ${series.name}`}
        style={{ height: 26 }}
      >
        Brief
      </Button>
    </>
  );
}

/**
 * A page or a feed, read and shown.
 *
 * Deliberately shows what came back rather than only that something did: a
 * source that silently swapped out the entire meaning of a shelf, with nothing
 * on screen but a green tick, is worse than no source at all. The headlines
 * ARE the brief now, so they are what you look at.
 */
function SourcePanel({
  series,
  kind,
}: {
  series: Series;
  kind: "link" | "feed";
}) {
  const { readSeriesSource, clearSeriesSource } = useStore();
  const [url, setUrl] = useState(series.source?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const read = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError("");
    setError(await readSeriesSource(series.id, url));
    setBusy(false);
  };

  const source = series.source;
  const lines = source ? sourceLines(source).split("\n").filter(Boolean) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <TextInput
          value={url}
          aria-label={kind === "feed" ? "Feed address" : "Page address"}
          placeholder={
            kind === "feed"
              ? "techcrunch.com/feed/"
              : "theverge.com/tech"
          }
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void read();
          }}
          style={{ height: 32 }}
        />
        <Button
          size="sm"
          variant="accent"
          onClick={() => void read()}
          disabled={busy || !url.trim()}
          style={{ flex: "none" }}
        >
          {busy ? "Reading…" : source ? "Refresh" : "Read it"}
        </Button>
      </div>

      {error ? (
        <div
          style={{
            fontSize: 11.5,
            color: color.bad,
            marginBottom: 8,
            textWrap: "pretty",
          }}
        >
          {error}
        </div>
      ) : null}

      {source ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 7,
              fontSize: 11.5,
              color: t(0.5),
            }}
          >
            <CheckGlyph size={12} stroke="#4bb07a" />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {source.title} — {lines.length}{" "}
              {source.items.length
                ? lines.length === 1
                  ? "headline"
                  : "headlines"
                : "passages"}
            </span>
            <Button size="sm" variant="quiet" onClick={() => clearSeriesSource(series.id)}>
              Detach
            </Button>
          </div>

          {/* Scrolls rather than growing: thirty headlines would otherwise
              push the topic list off the bottom of the page. */}
          <div
            style={{
              flex: 1,
              minHeight: 110,
              maxHeight: 300,
              overflowY: "auto",
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(0,0,0,0.3)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: w(0.08),
            }}
          >
            {lines.map((line, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: t(0.66),
                  padding: "3px 0",
                  borderTop: i ? `1px solid ${w(0.04)}` : undefined,
                  textWrap: "pretty",
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 110,
            display: "grid",
            placeItems: "center",
            padding: 14,
            borderRadius: 10,
            background: "rgba(0,0,0,0.22)",
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: w(0.09),
            fontSize: 11.5,
            color: t(0.35),
            textAlign: "center",
            textWrap: "pretty",
          }}
        >
          {kind === "feed"
            ? "Paste an RSS or Atom address. Its headlines become this shelf's themes."
            : "Paste a page. What it says becomes this shelf's themes."}
        </div>
      )}
    </div>
  );
}

/**
 * The brief itself, folded out: what the series is about, the pack every topic
 * on it runs through, and how many ideas one press should make.
 */
export function SeriesBrief({
  series,
  batch,
  setBatch,
  customBatch,
  setCustomBatch,
  onPatch,
  onGenerate,
  renamable = false,
}: {
  series: Series;
  batch: string;
  setBatch: (n: string) => void;
  customBatch: string;
  setCustomBatch: (n: string) => void;
  onPatch: (patch: Partial<Omit<Series, "id" | "topics">>) => void;
  onGenerate: (count: number) => void;
  /**
   * Show the name field.
   *
   * On the Series page, where the row you opened is the thing being edited.
   * Not in the fold-out on Content, where the name is the tab you clicked to
   * get here and renaming it under your own cursor is disorienting.
   */
  renamable?: boolean;
}) {
  const themes = themesOf(series);
  const custom = batch === CUSTOM;
  const count = custom ? clampBatch(customBatch) : Number(batch);
  const packOptions = usePackOptions(series.pack);

  return (
    <div
      style={{
        /*
         * Three columns, not two.
         *
         * Two put the brief on the left and everything else in one narrow
         * stack on the right — and that stack kept growing, so the panel's
         * height came from it while the brief sat in half a screen of nothing.
         * Splitting the settings in two halves that height and gives the
         * remaining space back to the box you actually type into.
         *
         * The minmax floors are what make it work at both widths this appears
         * at: 300+240+250 plus gaps fits the Content fold-out, and the fr
         * shares hand the Series page's extra width to the brief.
         */
        display: "grid",
        gridTemplateColumns:
          "minmax(300px, 1.5fr) minmax(230px, 1fr) minmax(248px, 1fr)",
        gap: 14,
        padding: 14,
        borderRadius: 14,
        background: "rgba(0,0,0,0.26)",
        border: `1px solid ${w(0.07)}`,
      }}
    >
      {/*
        A column, so the box can take the height the one beside it sets.

        The right-hand column is a stack of four controls and is always the
        taller of the two. With a fixed four-row box the left column was a
        short field over a foot of nothing — barely noticeable in the fold-out
        on Content, and the first thing you see on the wider Series page. The
        brief is the field you actually type paragraphs into, so it is the one
        that should have the room.
      */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {renamable ? (
          <>
            <div style={{ ...kicker, marginBottom: 7 }}>NAME</div>
            <TextInput
              value={series.name}
              /* Stable, not `Name of ${series.name}`: that renamed the field
                 itself on every keystroke, which loses focus for anything
                 holding a reference to it — a screen reader included. */
              aria-label="Series name"
              onChange={(e) => onPatch({ name: e.target.value })}
              style={{ height: 32, marginBottom: 14 }}
            />
          </>
        ) : null}

        <div style={{ ...kicker, marginBottom: 7 }}>
          WHAT THIS SERIES IS ABOUT
        </div>

        {/*
          Where the brief comes from.

          Typing it is the original and still the default. The other two read
          it off the web, which is the difference between a shelf about four
          words you thought of once and a shelf about what was published this
          morning. Switching back never loses what you typed — the box and the
          source are stored separately, and the tab only says which is in use.
        */}
        <Segmented
          size="sm"
          options={[
            { value: "typed", label: "Write it" },
            { value: "link", label: "From a link" },
            { value: "feed", label: "From a feed" },
          ]}
          value={series.briefFrom}
          onChange={(briefFrom) => onPatch({ briefFrom })}
          style={{ marginBottom: 9 }}
        />

        {series.briefFrom === "typed" ? (
          <TextArea
            rows={4}
            value={series.context}
            onChange={(e) => onPatch({ context: e.target.value })}
            placeholder={BRIEF_PLACEHOLDER}
            // Takes whatever height the tallest column sets, within reason: a
            // brief of two lines does not want a box the height of a screen.
            style={{ flex: 1, minHeight: 110, maxHeight: 300 }}
          />
        ) : (
          <SourcePanel series={series} kind={series.briefFrom} />
        )}

        <div style={{ marginTop: 7, fontSize: 11.5, color: t(0.4) }}>
          {themes.length} {themes.length === 1 ? "theme" : "themes"}. New ideas
          are built out of these. Generating only ever adds topic names — never
          sections, never content.
        </div>
      </div>

      <div>
        <div style={{ ...kicker, marginBottom: 7 }}>WHAT WRITES IT</div>
        <Select
          size="sm"
          label={`Template for ${series.name}`}
          value={series.pack}
          onChange={(pack) => onPatch({ pack })}
          options={packOptions}
        />
        <div style={{ marginTop: 7, fontSize: 11.5, color: t(0.4) }}>
          The set of sections every topic here gets written with.
        </div>

        <div style={{ ...kicker, margin: "18px 0 7px" }}>
          MAKE ME SOME IDEAS
        </div>
        <Segmented
          full
          size="sm"
          tone="accent"
          options={[
            ...TOPIC_BATCHES.map((n) => ({
              value: String(n),
              label: String(n),
            })),
            {
              value: CUSTOM,
              label: "Custom",
              title: `Type any amount, up to ${MAX_BATCH}`,
            },
          ]}
          value={batch}
          onChange={setBatch}
          style={{ marginBottom: 10 }}
        />

        {custom ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <TextInput
              autoFocus
              type="number"
              min={1}
              max={MAX_BATCH}
              inputMode="numeric"
              aria-label={`How many topics to generate in ${series.name}`}
              value={customBatch}
              onChange={(e) => setCustomBatch(e.target.value)}
              onBlur={() =>
                setCustomBatch(String(clampBatch(customBatch) || 1))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && count > 0) onGenerate(count);
              }}
              style={{ height: 32, colorScheme: "dark" }}
            />
            <span
              style={{
                flex: "none",
                fontFamily: font.mono,
                fontSize: 10.5,
                color: t(0.35),
              }}
            >
              1&ndash;{MAX_BATCH}
            </span>
          </div>
        ) : null}

        <Button
          variant="primary"
          size="md"
          full
          disabled={count < 1}
          onClick={() => onGenerate(count)}
          label={`Generate ${count} topics in ${series.name}`}
        >
          {count < 1
            ? "Enter an amount"
            : `Generate ${count} ${count === 1 ? "topic" : "topics"}`}
        </Button>
      </div>

      {/* Its own column: it is the tallest control here, and stacked under the
          template picker it was what made the panel two screens deep. */}
      <div>
        <div style={{ ...kicker, marginBottom: 7 }}>NUMBERING</div>
        <NumberingRow
          on={series.numbered}
          onToggle={() => onPatch({ numbered: !series.numbered })}
          label={series.partLabel}
          onLabel={(partLabel) => onPatch({ partLabel })}
          nextPart={series.nextPart}
        />
      </div>
    </div>
  );
}

/**
 * All of the topic-admin state, and the pieces that render it.
 *
 * Returned rather than rendered so the host screen decides where each part
 * goes: the strip belongs in a group header, the buttons in a toolbar, and the
 * dialogs at the end of the page.
 */
export function useTopicAdmin(onCreated?: (ids: string[]) => void) {
  const {
    seriesList,
    addSeries,
    updateSeries,
    generateTopicsIn,
    addTopic,
    importTopics,
    updateTopic,
  } = useStore();

  const [batch, setBatch] = useState("3");
  /** What the custom segment holds, kept while other presets are picked. */
  const [customBatch, setCustomBatch] = useState("8");
  const [briefOpen, setBriefOpen] = useState<string | null>(null);
  const [form, setForm] = useState<TopicForm | null>(null);
  const [newSeriesOpen, setNewSeriesOpen] = useState(false);
  const [newSeries, setNewSeries] = useState({
    name: "",
    context: "",
    pack: "",
    partLabel: "Part",
    // On by default: most shelves here are a run of parts, and the counter is
    // the thing a series is for.
    numbered: true,
  });
  const newSeriesPackOptions = usePackOptions(newSeries.pack);
  const [fileError, setFileError] = useState("");
  /** The per-topic context box, folded away until it is asked for. */
  const [contextOpen, setContextOpen] = useState(false);
  const topicFileRef = useRef<HTMLInputElement>(null);

  const flash = (ids: string[]) => onCreated?.(ids);

  const firstSeries = seriesList[0]?.id ?? "";

  const openNewTopic = (seriesId?: string) => {
    setContextOpen(false);
    setForm(blankForm(seriesId ?? firstSeries));
  };

  const openEditTopic = (
    topic: { id: string; name: string; status: TopicStatus; context: string },
    seriesId: string,
  ) => {
    setContextOpen(Boolean(topic.context.trim()));
    setForm({
      mode: "one",
      editing: topic.id,
      seriesId,
      status: topic.status,
      name: topic.name,
      context: topic.context,
      text: "",
    });
  };

  const openNewSeries = () => setNewSeriesOpen(true);

  /**
   * The shelf that already has this name.
   *
   * Three series called "Powerful websites you know" exist because this check
   * did not. The server refuses one now as well — this is so you find out
   * while typing rather than after pressing Create.
   */
  const seriesClash = useMemo(
    () =>
      newSeries.name.trim() ? findSame(newSeries.name, seriesList) ?? null : null,
    [newSeries.name, seriesList],
  );
  const seriesNear = useMemo(
    () =>
      seriesClash || newSeries.name.trim().length < 4
        ? []
        : nearMatches(newSeries.name, seriesList).slice(0, 2),
    [newSeries.name, seriesList, seriesClash],
  );

  const createSeries = () => {
    const name = newSeries.name.trim();
    if (!name) return;
    addSeries(
      name,
      newSeries.context,
      newSeries.pack,
      newSeries.numbered,
      newSeries.partLabel,
    );
    setNewSeries({
      name: "",
      context: "",
      pack: "",
      partLabel: "Part",
      numbered: true,
    });
    setNewSeriesOpen(false);
  };

  /**
   * A dropped or picked text file, appended to the box.
   *
   * Appended rather than assigned: dropping a second file should add to what is
   * already there. Read as text and left as text — the same parser handles it,
   * so a file and a paste cannot disagree about what a line means.
   */
  const readTopicFile = async (file?: File | null) => {
    if (!file) return;
    setFileError("");
    if (file.size > 512_000) {
      setFileError("That file is too big — 500KB is plenty for a topic list.");
      return;
    }
    try {
      const text = (await file.text()).trim();
      if (!text) {
        setFileError("That file is empty.");
        return;
      }
      setForm((f) =>
        f
          ? { ...f, text: f.text.trim() ? `${f.text.trim()}\n${text}` : text }
          : f,
      );
    } catch {
      setFileError("That file could not be read as text.");
    }
  };

  /**
   * Every topic in the workspace, and which shelf it is on.
   *
   * The check that matters is "has this been covered", and coverage is not
   * per-shelf: a topic written under one series is written. Held here so the
   * dialogs, the counter and the warnings all read the same list.
   */
  const covered = useMemo(
    () =>
      seriesList.flatMap((series) =>
        series.topics.map((topic) => ({
          id: topic.id,
          name: topic.name,
          series: series.name,
        })),
      ),
    [seriesList],
  );

  /** Everything the sheet needs to know about what it is about to do. */
  const parsed = useMemo(() => {
    if (!form || form.mode !== "many") {
      return { fresh: [], skipped: 0, alreadyHere: [] as string[] };
    }
    const lines = parseTopicLines(form.text);
    const split = partitionNew(
      lines.map((l) => l.name),
      covered,
    );
    const byName = new Map(lines.map((l) => [l.name, l]));
    return {
      fresh: split.fresh.map((name) => byName.get(name)!).filter(Boolean),
      skipped: split.covered.length,
      alreadyHere: split.covered.map((c) =>
        c.by && "series" in c.by
          ? `${c.name} — already in ${(c.by as { series: string }).series}`
          : `${c.name} — already here`,
      ),
    };
  }, [form, covered]);

  /**
   * The topic this name would duplicate, while it is still being typed.
   *
   * Editing excludes the row being edited, or renaming a topic to fix its
   * capitalisation would report it as a duplicate of itself.
   */
  const clash = useMemo(() => {
    if (!form || form.mode === "many" || !form.name.trim()) return null;
    const pool = form.editing
      ? covered.filter((c) => c.id !== form.editing)
      : covered;
    return findSame(form.name, pool) ?? null;
  }, [form, covered]);

  /** Not the same name, but close enough to be worth showing. */
  const near = useMemo(() => {
    if (!form || form.mode === "many" || clash || form.name.trim().length < 4) {
      return [];
    }
    const pool = form.editing
      ? covered.filter((c) => c.id !== form.editing)
      : covered;
    return nearMatches(form.name, pool).slice(0, 2);
  }, [form, covered, clash]);

  const canSubmit = form
    ? form.mode === "many"
      ? parsed.fresh.length > 0
      : form.name.trim().length > 0 && !clash
    : false;

  const submitForm = () => {
    if (!form || !canSubmit) return;
    if (form.editing) {
      updateTopic(form.editing, {
        name: form.name.trim(),
        status: form.status,
        context: form.context.trim(),
      });
      flash([form.editing]);
    } else if (form.mode === "many") {
      flash(importTopics(form.seriesId, form.text, form.status));
    } else {
      flash([
        addTopic(
          form.seriesId,
          form.name.trim(),
          form.status,
          form.context.trim(),
        ),
      ]);
    }
    setForm(null);
  };

  const seriesOptions = seriesList.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  /** Whether the brief behind a series is folded out. */
  const briefIsOpen = (series: Series) => briefOpen === series.id;

  /** A series's own controls, for the end of whatever row names it. */
  const controlsFor = (series: Series): ReactNode => (
    <SeriesControls
      series={series}
      open={briefIsOpen(series)}
      onToggle={() => setBriefOpen(briefOpen === series.id ? null : series.id)}
      onGenerate={(count) => flash(generateTopicsIn(series.id, count))}
      onAddTopic={() => openNewTopic(series.id)}
    />
  );

  /** The brief that folds out of those controls — null while it is closed. */
  const briefFor = (series: Series): ReactNode =>
    briefIsOpen(series) ? (
      <SeriesBrief
        series={series}
        batch={batch}
        setBatch={setBatch}
        customBatch={customBatch}
        setCustomBatch={setCustomBatch}
        onPatch={(patch) => updateSeries(series.id, patch)}
        onGenerate={(count) => flash(generateTopicsIn(series.id, count))}
      />
    ) : null;

  const dialogs = (
    <>
      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={
          form?.editing
            ? "Edit topic"
            : form?.mode === "many"
              ? "Import topics"
              : "New topic"
        }
        icon={
          form?.editing ? (
            <PencilIcon size={15} stroke="currentColor" />
          ) : form?.mode === "many" ? (
            <DocGlyph size={15} stroke="currentColor" />
          ) : (
            <TopicGlyph size={15} stroke="currentColor" />
          )
        }
        subtitle={
          form?.editing
            ? "Rename it, or move where it stands."
            : "A topic is a name. Everything under it — the template, the content — comes later."
        }
        width={620}
        footer={
          <>
            <span style={{ fontSize: 11.5, color: t(0.4) }}>
              {form?.mode === "many" && !form.editing
                ? `${parsed.fresh.length} ready${
                    parsed.skipped ? ` · ${parsed.skipped} already here` : ""
                  }`
                : form?.editing
                  ? "Status becomes Generating on its own while a template runs."
                  : "Added as an Idea — status follows the templates from there."}
            </span>
            <Button
              onClick={() => setForm(null)}
              style={{ marginLeft: "auto" }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitForm}
              disabled={!canSubmit}
            >
              {form?.editing
                ? "Save topic"
                : form?.mode === "many"
                  ? `Import ${parsed.fresh.length || ""} ${
                      parsed.fresh.length === 1 ? "topic" : "topics"
                    }`
                  : "Add topic"}
            </Button>
          </>
        }
      >
        {form ? (
          <>
            {!form.editing ? (
              <Segmented
                style={{ marginBottom: 16 }}
                options={[
                  { value: "one", label: "One topic" },
                  { value: "many", label: "Import many" },
                ]}
                value={form.mode}
                onChange={(mode) =>
                  setForm({ ...form, mode: mode as "one" | "many" })
                }
              />
            ) : null}

            {form.mode === "one" || form.editing ? (
              <>
                <Field label="Name">
                  {/* The glyph sits inside the field rather than beside the label,
                    the way Goal does on the workspace sheet — a lone text box in
                    a dialog reads as a form; a marked one reads as the thing it
                    holds. */}
                  <span style={{ position: "relative", display: "block" }}>
                    <TopicGlyph
                      size={14}
                      stroke={t(0.45)}
                      style={{
                        position: "absolute",
                        left: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                      }}
                    />
                    <TextInput
                      autoFocus
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitForm();
                      }}
                      placeholder="e.g. Hook banks that actually work"
                      style={{ paddingLeft: 34 }}
                    />
                  </span>

                  {/*
                    Said while it is being typed, not after the save.
                    A duplicate refused on submit is a wasted trip; a
                    duplicate named as you type is a question answered —
                    and it names the shelf, because "already covered"
                    without saying where sends you looking.
                  */}
                  {clash ? (
                    <Note tone="stop">
                      Already covered — “{clash.name}” is in {clash.series}.
                    </Note>
                  ) : near.length ? (
                    <Note tone="watch">
                      Close to {near.map((n) => `“${n.name}”`).join(", ")} — a
                      different angle, or the same one twice?
                    </Note>
                  ) : null}
                </Field>

                {/*
                Context, folded away.

                Capturing an idea should still cost one field — that is why the
                description went. But some topics carry something the packs
                genuinely need: an angle, a source, a thing to avoid. Empty is
                the normal case, so it is a toggle rather than a box that sits
                there asking to be filled.
              */}
                {contextOpen || form.context.trim() ? (
                  <Field
                    label="Context for the templates"
                    hint="what is different about this one"
                    counter={
                      form.context.trim()
                        ? `${form.context.trim().length} chars`
                        : undefined
                    }
                  >
                    <TextArea
                      rows={4}
                      mono={false}
                      value={form.context}
                      onChange={(e) =>
                        setForm({ ...form, context: e.target.value })
                      }
                      placeholder={`Angle to take, a source to lean on, something to avoid.
The series brief already covers what the shelf is about.`}
                    />
                  </Field>
                ) : (
                  <div style={{ marginBottom: 16 }}>
                    <Button
                      onClick={() => setContextOpen(true)}
                      icon={<PlusIcon size={11} stroke="currentColor" />}
                    >
                      Add context for the templates
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <Field
                label="Paste your topics"
                hint="one per line — the line is the topic"
                counter={
                  parsed.skipped
                    ? `${parsed.fresh.length} new · ${parsed.skipped} already covered`
                    : `${parsed.fresh.length} ready`
                }
              >
                <TextArea
                  autoFocus
                  rows={9}
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void readTopicFile(e.dataTransfer.files?.[0]);
                  }}
                  placeholder={IMPORT_PLACEHOLDER}
                />

                {/* Which ones, not just how many: a count says the paste was
                    trimmed, the names say whether it was trimmed correctly. */}
                {parsed.alreadyHere.length ? (
                  <Note tone="watch">
                    Skipping {parsed.alreadyHere.length}:{" "}
                    {parsed.alreadyHere.slice(0, 3).join("; ")}
                    {parsed.alreadyHere.length > 3
                      ? ` and ${parsed.alreadyHere.length - 3} more`
                      : ""}
                  </Note>
                ) : null}
                {/* A list of topics usually already exists somewhere — a notes
                    file, an export, something a phone dumped out. Pasting works;
                    so does dropping the file on the box, or picking it here. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    marginTop: 8,
                  }}
                >
                  <Button
                    onClick={() => topicFileRef.current?.click()}
                    icon={<DocGlyph size={12} stroke="currentColor" />}
                  >
                    Load a .txt file
                  </Button>
                  <span
                    style={{
                      fontSize: 11,
                      color: fileError ? "#c99a3f" : t(0.34),
                    }}
                  >
                    {fileError || "or drop one on the box above"}
                  </span>
                  <input
                    ref={topicFileRef}
                    type="file"
                    accept=".txt,.md,.csv,text/plain"
                    hidden
                    onChange={(e) => {
                      void readTopicFile(e.target.files?.[0]);
                      // Cleared so the same file can be picked twice.
                      e.target.value = "";
                    }}
                  />
                </div>
              </Field>
            )}

            <div
              style={{
                display: "grid",
                // Status is only in this row while editing; on the way in there
                // is nothing to put beside Series, so it takes the width.
                gridTemplateColumns: form.editing ? "1fr 200px" : "1fr",
                gap: 12,
              }}
            >
              <Field label="Series">
                <Select
                  label="Series"
                  value={form.seriesId}
                  onChange={(seriesId) => setForm({ ...form, seriesId })}
                  options={seriesOptions}
                />
              </Field>
              {form.editing ? (
                <Field label="Status">
                  <Segmented
                    full
                    tone="accent"
                    options={STATUS_OPTIONS}
                    value={form.status === "generating" ? "idea" : form.status}
                    onChange={(status) =>
                      setForm({ ...form, status: status as TopicStatus })
                    }
                    style={{ height: 38 }}
                  />
                </Field>
              ) : null}
            </div>

            {form.mode === "many" && !form.editing && parsed.fresh.length ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ ...kicker, marginBottom: 8 }}>WHAT WILL LAND</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {parsed.fresh.slice(0, 8).map((line) => (
                    <Chip key={line.name}>{line.name}</Chip>
                  ))}
                  {parsed.fresh.length > 8 ? (
                    <Chip tone="accent">+{parsed.fresh.length - 8} more</Chip>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={newSeriesOpen}
        onClose={() => setNewSeriesOpen(false)}
        title="New series"
        subtitle="A shelf with a brief on it. Topics generated here are framed from what you write."
        icon={<StackGlyph size={15} stroke="currentColor" />}
        width={580}
        footer={
          <>
            <span style={{ fontSize: 11.5, color: t(0.4) }}>
              You can change any of this later from the series&rsquo;s Brief.
            </span>
            <Button
              onClick={() => setNewSeriesOpen(false)}
              style={{ marginLeft: "auto" }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={createSeries}
              disabled={!newSeries.name.trim() || Boolean(seriesClash)}
            >
              Create series
            </Button>
          </>
        }
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}
        >
          <Field label="Name">
            <TextInput
              autoFocus
              value={newSeries.name}
              onChange={(e) =>
                setNewSeries({ ...newSeries, name: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") createSeries();
              }}
              placeholder="e.g. Ecommerce"
            />
            {seriesClash ? (
              <Note tone="stop">
                “{seriesClash.name}” is already a series — put the topic there
                rather than starting a second shelf for it.
              </Note>
            ) : seriesNear.length ? (
              <Note tone="watch">
                Close to {seriesNear.map((n) => `“${n.name}”`).join(", ")}.
              </Note>
            ) : null}
          </Field>
          <Field label="Template for its topics">
            <Select
              label="Template for its topics"
              value={newSeries.pack}
              onChange={(pack) => setNewSeries({ ...newSeries, pack })}
              options={newSeriesPackOptions}
              placeholder="No template yet"
            />
          </Field>
        </div>

        {/*
          The part counter, on or off.
          
          Above the brief rather than below it because it changes what every
          topic on this shelf will be CALLED, which is a bigger decision than
          what they are about — and one that is tedious to undo once there are
          twenty of them.
        */}
        <NumberingRow
          on={newSeries.numbered}
          onToggle={() =>
            setNewSeries({ ...newSeries, numbered: !newSeries.numbered })
          }
          label={newSeries.partLabel}
          onLabel={(partLabel) => setNewSeries({ ...newSeries, partLabel })}
          nextPart={1}
        />

        <Field
          label="What it is about"
          hint="one theme per line, this is what ideas get generated from"
        >
          <TextArea
            rows={5}
            value={newSeries.context}
            onChange={(e) =>
              setNewSeries({ ...newSeries, context: e.target.value })
            }
            placeholder={THEME_PLACEHOLDER}
          />
        </Field>
      </Modal>
    </>
  );

  return {
    controlsFor,
    briefFor,
    dialogs,
    openNewTopic,
    openEditTopic,
    openNewSeries,
    seriesList,
  };
}

/** A placeholder, written the way it is typed into a prompt. */
function Code({ children }: { children: string }) {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 10.5,
        padding: "1px 5px",
        borderRadius: 5,
        background: w(0.08),
        color: t(0.72),
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * The words a shelf is likely to count in.
 *
 * Offered rather than typed, because the answer is one of half a dozen words
 * nine times out of ten and typing it is the slow way to pick from six. The
 * tenth time there is Custom, and there is "Just the number" for a shelf that
 * counts without naming what it is counting.
 */
const PART_LABELS = ["Part", "Episode", "Day", "Week", "Tip", "Chapter"];

/** The picker's two special rows, which are not words. */
const LABEL_BARE = "__just_the_number__";
const LABEL_OTHER = "__something_else__";

/**
 * How a shelf counts, and what it calls the count.
 *
 * The switch used to say "Number the parts" and mean it literally: every
 * screen printed the word "Part" in front of whatever the counter said,
 * because that is the word the one shipped template uses. A shelf of daily
 * posts is on Day 7 and a podcast is on Episode 7 — the count was never the
 * thing they disagreed about.
 *
 * So the switch turns counting on, and a picker names it. The line underneath
 * shows the result rather than describing it: "Episode 07" answers what this
 * does in less space than a sentence explaining that it puts a word in front
 * of a zero-padded number.
 */
function NumberingRow({
  on,
  onToggle,
  label,
  onLabel,
  nextPart,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  onLabel: (value: string) => void;
  nextPart: number;
}) {
  const known = PART_LABELS.includes(label.trim());
  const [custom, setCustom] = useState(!known && label.trim() !== "");
  const choice = custom ? LABEL_OTHER : label.trim() === "" ? LABEL_BARE : label.trim();

  return (
    <div
      style={{
        margin: "14px 0",
        padding: "11px 13px",
        borderRadius: 12,
        background: w(0.04),
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: w(0.07),
      }}
    >
      {/* The switch beside the heading, everything else under both: side by
          side, a paragraph in a 260px column gets about twenty characters a
          line. A heading can share a row with a switch; prose cannot. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>
          Number the topics
        </div>
        <Toggle on={on} onToggle={onToggle} label="Number the topics" />
      </div>

      {on ? (
        <>
          <div
            style={{
              marginTop: 5,
              fontSize: 11.5,
              color: t(0.45),
              lineHeight: 1.55,
              textWrap: "pretty",
            }}
          >
            Each new topic takes the next number on its own. Numbers are never
            reused, so deleting one retires it.
          </div>

          <div style={{ ...kicker, margin: "12px 0 6px" }}>CALL EACH ONE</div>
          <Select
            size="sm"
            label="What to call each numbered topic"
            value={choice}
            onChange={(value) => {
              if (value === LABEL_OTHER) {
                setCustom(true);
                return;
              }
              setCustom(false);
              onLabel(value === LABEL_BARE ? "" : value);
            }}
            options={[
              ...PART_LABELS.map((x) => ({ value: x, label: x })),
              { value: LABEL_BARE, label: "Just the number" },
              { value: LABEL_OTHER, label: "Something else…" },
            ]}
          />

          {custom ? (
            <TextInput
              autoFocus
              value={label}
              aria-label="What to call each numbered topic"
              placeholder="Lesson, Round, Issue…"
              onChange={(e) => onLabel(e.target.value)}
              style={{ height: 32, marginTop: 7 }}
            />
          ) : null}

          {/*
            The result, not a description of it.

            "Puts the word in front of a zero-padded number" takes a line and a
            half to say and is still less clear than showing the next one.
          */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
            }}
          >
            <span style={{ flex: "none", fontSize: 11.5, color: t(0.4) }}>
              Next one:
            </span>
            <Code>{partName(label, nextPart) || "—"}</Code>
          </div>

          <div
            style={{
              marginTop: 9,
              fontSize: 11.5,
              color: t(0.45),
              lineHeight: 1.55,
              textWrap: "pretty",
            }}
          >
            In a template, <Code>{"{{part}}"}</Code> writes that whole line.{" "}
            <Code>{"{{part_number}}"}</Code> writes just the number.
          </div>
        </>
      ) : (
        <div
          style={{
            marginTop: 5,
            fontSize: 11.5,
            color: t(0.45),
            lineHeight: 1.55,
            textWrap: "pretty",
          }}
        >
          Topics arrive unnumbered, so <Code>{"{{part}}"}</Code> comes out empty
          in your templates. Turn it on whenever you like — counting carries on
          from where it stopped.
        </div>
      )}
    </div>
  );
}
