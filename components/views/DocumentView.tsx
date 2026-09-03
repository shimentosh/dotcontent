"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";

import {
  looseSections,
  STATE_STYLE,
  outputsFor,
  writtenCount,
  type ContentDoc,
  type DocSection,
  type SectionState,
} from "@/lib/content-docs";
import { useStore } from "@/lib/store";
import { latestRunFor, runToDoc, topicSlug } from "@/lib/run-doc";
import { getPack, type ApiPack } from "@/lib/packs-client";
import { packForSeries } from "@/lib/packs";
import {
  editSection,
  getRun,
  isWriting,
  startWriting,
  type Run,
  writeSection,
} from "@/lib/runs-client";
import { frameUrl, getSource, type Source } from "@/lib/sources-client";
import { font, panel, primary, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Button, Rail, TextArea } from "@/components/ui";
import { PencilIcon } from "@/components/ui/Icons";
import { UnwrittenTopic } from "@/components/views/UnwrittenTopic";
import { ReadingMode } from "@/components/overlays/ReadingMode";
import {
  BackGlyph,
  CaretDown,
  CaretRight,
  CheckGlyph,
  ClapperGlyph,
  CopyGlyph,
  CtaGlyph,
  DownloadGlyph,
  ReadGlyph,
  GlobeGlyph,
  HashGlyph,
  ListGlyph,
  RedoGlyph,
  SeoGlyph,
  SocialGlyph,
  SpeechGlyph,
  TopicGlyph,
} from "@/components/ui/DocIcons";

type Glyph = ComponentType<{
  size?: number;
  stroke?: string;
  style?: CSSProperties;
}>;


const GROUP_GLYPH: Record<string, Glyph> = {
  research: GlobeGlyph,
  en: ClapperGlyph,
  bn: SpeechGlyph,
  social: SocialGlyph,
  seo: SeoGlyph,
  tags: HashGlyph,
  cta: CtaGlyph,
};

const toolButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  height: 32,
  padding: "0 12px",
  borderRadius: 9,
  fontSize: 12.5,
  fontWeight: 600,
  background: w(0.07),
  border: `1px solid ${w(0.1)}`,
  cursor: "pointer",
};

/**
 * The per-row actions are the same two verbs on every group and every section,
 * dozens of times down the page. Labelled once each they read as a list of
 * buttons rather than a list of content, so they are square icons with the
 * verb on the tooltip instead.
 */
const iconButton: CSSProperties = {
  width: 26,
  height: 26,
  display: "grid",
  placeItems: "center",
  borderRadius: 7,
  background: w(0.07),
  border: `1px solid ${w(0.09)}`,
  color: "rgba(240,240,244,0.72)",
  cursor: "pointer",
  flex: "none",
};

/** One block on the page: an output, or the steps that feed no output. */
type Group = {
  key: string;
  label: string;
  note: string;
  isOutput: boolean;
  sections: DocSection[];
};

function buildGroups(doc: ContentDoc): Group[] {
  /*
   * Deliverables, and everything that feeds them.
   *
   * A section belongs to an output group when the template says it does. The
   * rest — identify, research, the CTA keyword — feed all of them and are a
   * deliverable of none, so they get one group of their own, first, because
   * that is the order they are written in and read in.
   *
   * This used to pick them out by `kind === "research"` and `kind === "cta"`,
   * which a run never sets: every section arrives as "script". Both groups
   * came back empty, were filtered out as empty, and three sections of every
   * run — including the research the other nine are built on — were simply not
   * on the page. The sections rail listed twelve and the page showed nine.
   */
  const loose = looseSections(doc);

  return [
    ...(loose.length
      ? [
          {
            key: "groundwork",
            label: "Research & setup",
            note: "What every deliverable below is built on",
            isOutput: false,
            sections: loose,
          },
        ]
      : []),
    ...outputsFor(doc)
      .filter((o) => o.total > 0)
      .map((o) => ({
        key: o.key,
        label: o.label,
        note: `${o.total} ${o.total === 1 ? "section" : "sections"}`,
        isOutput: true,
        sections: o.sections,
      })),
  ];
}

function sectionText(s: DocSection) {
  return [`${s.n} ${s.name}`, ...s.body].join("\n");
}

function groupText(g: Group) {
  return [`## ${g.label}`, ...g.sections.map(sectionText)].join("\n\n");
}

function docText(doc: ContentDoc) {
  return [
    `# ${doc.topic}`,
    `${doc.pack} · ${doc.part}`,
    "",
    ...buildGroups(doc)
      .filter((g) => g.sections.some((s) => s.state === "written"))
      .map(groupText),
  ].join("\n\n");
}

/**
 * One page for reading content, whichever way you arrived at it.
 *
 * `/content/<topic>` names a topic and gets its newest run; `/runs/<id>` names
 * one run exactly. They used to be two screens — this one, and a flat list of
 * twelve rows — for the same twelve sections. The flat one is gone: watching a
 * run happen and reading it afterwards are the same page at two moments, and
 * keeping them apart meant the better layout was the one you could not watch.
 */
/** The four things a run can be, and the colour each one wears. */
const STATUS_TONE = {
  busy: {
    bg: "rgba(0,87,252,0.14)",
    border: "rgba(0,87,252,0.3)",
    fg: "#6a9dff",
  },
  idle: {
    bg: "rgba(201,154,63,0.12)",
    border: "rgba(201,154,63,0.26)",
    fg: "#c99a3f",
  },
  bad: {
    bg: "rgba(209,101,107,0.12)",
    border: "rgba(209,101,107,0.28)",
    fg: "#d1656b",
  },
  good: {
    bg: "rgba(75,176,122,0.12)",
    border: "rgba(75,176,122,0.26)",
    fg: "#4bb07a",
  },
} as const;

export function DocumentView({
  slug,
  runId,
}: {
  slug?: string;
  runId?: string;
}) {
  const {
    go,
    seriesList,
    runs,
    packs,
    reloadRuns,
    settings,
    runTopicNow,
  } = useStore();

  /*
   * The run this page is about.
   *
   * Fetched directly when the URL names one, because a run started seconds ago
   * is not in the store's list yet and waiting for a reload to notice it is
   * the difference between watching your run and watching an empty page.
   */
  const [fetched, setFetched] = useState<Run | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void getRun(runId)
      .then((r) => {
        if (!cancelled) setFetched(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const run = useMemo(() => {
    /*
     * The polled copy wins here too.
     *
     * This read the store's list first, and that list is loaded once and
     * reloaded on navigation — never on a timer. So /runs/<id> rendered a
     * snapshot taken when the page was opened, the poll below kept a fresh
     * copy in `fetched` that nothing looked at, and the only way to see any
     * progress was to reload the page. Which is exactly what it looked like:
     * live updates that only arrive on a refresh.
     */
    if (runId) {
      return fetched?.id === runId
        ? fetched
        : (runs.find((r) => r.id === runId) ?? fetched);
    }
    const topic = seriesList
      .flatMap((series) => series.topics)
      .find((t) => topicSlug(t.name) === slug);
    const latest = topic ? latestRunFor(runs, topic.id) : null;
    /*
     * The polled copy wins, when it is the same run.
     *
     * /content/<topic> reads the store's list, which is reloaded on navigation
     * and not on a timer — so a run started from this page wrote twelve
     * sections while the page it was started from showed twelve queued ones.
     * The poll below keeps `fetched` current for whichever run is on screen;
     * this is where that gets used.
     */
    return latest && fetched?.id === latest.id ? fetched : latest;
  }, [runId, fetched, runs, seriesList, slug]);

  /*
   * The template as the engine runs it.
   *
   * The store's copy is the builder's shape and carries no dependency arrows,
   * and those are what decide which section may go next. Fetched by slug so a
   * template written in the builder works here too.
   */
  const [runtime, setRuntime] = useState<ApiPack | null>(null);

  useEffect(() => {
    const packSlug = run?.packSlug;
    if (!packSlug) return;
    let cancelled = false;
    void getPack(packSlug)
      .then((p) => {
        if (!cancelled) setRuntime(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [run?.packSlug]);

  /** The topic behind it, for the rail and for the empty states. */
  const topic = useMemo(
    () =>
      seriesList
        .flatMap((series) => series.topics.map((t) => ({ ...t, series })))
        .find((t) => (runId ? t.id === run?.topicId : topicSlug(t.name) === slug)),
    [seriesList, slug, runId, run],
  );

  const doc = useMemo(
    () =>
      run ? runToDoc(run, packs.find((p) => p.id === run.packSlug)) : null,
    [run, packs],
  );

  /** The reel this run was given, when it was given one. */
  const [source, setSource] = useState<Source | null>(null);

  useEffect(() => {
    const sid = run?.sourceId;
    if (!sid) return;
    let cancelled = false;
    void getSource(sid)
      .then((x) => {
        if (!cancelled) setSource(x);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [run?.sourceId]);

  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["03"]),
  );
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  /*
   * Editing one section by hand.
   *
   * A section's number rather than its id, because that is what every other
   * piece of per-section state on this page is keyed by, and two keys for one
   * row is how they drift. One at a time: this is a document you are reading,
   * and six open textareas is a form.
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  /** Between pressing Run on an unwritten topic and the run existing. */
  const [starting, setStarting] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const later = (fn: () => void, ms: number) =>
    timers.current.push(setTimeout(fn, ms));

  const groups = useMemo(() => (doc ? buildGroups(doc) : []), [doc]);
  const [reading, setReading] = useState(false);

  /*
   * Sections that have not been written yet, in the template's own order.
   *
   * A dependency is satisfied when the section it names is done, so this is
   * recomputed from the run every time rather than held as a queue: a section
   * rewritten by hand changes what is ready next, and a queue built once would
   * not notice.
   */
  const pending = useMemo(() => {
    if (!run || !runtime) return [];
    const done = new Set(
      run.sections.filter((x) => x.state === "done").map((x) => x.id),
    );
    return runtime.sections
      .filter((def) => {
        const row = run.sections.find((x) => x.id === def.id);
        return (
          row && row.state !== "done" && def.dependsOn.every((d) => done.has(d))
        );
      })
      .map((def) => def.id);
  }, [run, runtime]);

  const unwritten = run
    ? run.sections.filter((x) => x.state !== "done").length
    : 0;

  /** Set while the server is writing this run — see the polling effect. */
  const [serverWriting, setServerWriting] = useState(false);

  /**
   * Is it writing, waiting, or stopped?
   *
   * The page showed "0/12 written" and twelve QUEUED chips whether the run was
   * mid-flight, finished with nothing, or had never been started — three very
   * different situations that all look identical while you watch them. With
   * auto-approve off a new run does not start on its own, so the honest answer
   * for most of them is "waiting for you", and that was the one thing nothing
   * on the page said.
   */
  const status = useMemo(() => {
    if (!run) return null;

    /*
     * In flight here, or in flight anywhere.
     *
     * `busy` is this tab's own loop; the row's state is what the server
     * recorded. A run driven from another tab moves the second and not the
     * first, and reading only the local set would report "not running" while
     * the machine was busy writing.
     */
    const serverBusy = run.sections.find((x) => x.state === "writing");
    if (busy.size || serverBusy || serverWriting) {
      const now =
        doc?.sections.find((x) => busy.has(x.n)) ??
        doc?.sections.find((x) => x.id === serverBusy?.id);
      /*
       * Between two sections there is nothing being written, and the honest
       * word for that is not "Writing…" with no object. The one about to go is
       * the next queued, which is what the server picks the moment the last one
       * lands — so the pill names it rather than going vague for a second and a
       * half every time a section finishes.
       */
      const next = doc?.sections.find((x) => x.state === "queued");
      return {
        tone: "busy" as const,
        text: now
          ? `Writing ${now.n} · ${now.name}…`
          : next
            ? `Starting ${next.n} · ${next.name}…`
            : "Writing…",
        // It runs from whichever tab started it: the browser asks for one
        // section, waits, then asks for the next. Closing that tab stops it
        // between sections.
        note: busy.size ? "Keep this tab open" : "Running on the server",
      };
    }

    const failed = run.sections.filter((x) => x.state === "failed");
    if (failed.length) {
      return {
        tone: "bad" as const,
        text: `Stopped — ${failed.length} section${failed.length === 1 ? "" : "s"} failed`,
        note: failed[0]?.error?.slice(0, 90) || "Open the section to see why",
      };
    }

    if (!unwritten) return { tone: "good" as const, text: "All written", note: "" };

    return {
      tone: "idle" as const,
      text: `Not running — ${unwritten} queued`,
      note: 'Press "Write the rest"',
    };
  }, [run, busy, doc, unwritten, serverWriting]);

  /*
   * Whether it carries on by itself.
   *
   * From the preference, once: "approve finished sections automatically — off
   * means every section waits for you" is exactly this. Armed only for a run
   * that still has work, so opening a finished one never starts anything.
   */
  const [auto, setAuto] = useState(false);
  const armed = useRef(false);

  useEffect(() => {
    if (!settings || armed.current || !unwritten) return;
    armed.current = true;
    setAuto(settings.autoApprove);
  }, [settings, unwritten]);

  /**
   * Write these sections, by id, in order.
   *
   * One request each, because the model behind them is a single local process
   * and parallel requests raced it into returning an error page instead of
   * JSON. Slower, and it finishes.
   */
  const writeIds = useCallback(async (ids: string[]) => {
    if (!run || !ids.length) return;
    const ns = ids
      .map((id) => doc?.sections.find((x) => x.id === id)?.n)
      .filter((n): n is string => Boolean(n));

    setBusy((prev) => new Set([...prev, ...ns]));
    for (const id of ids) {
      try {
        const after = await writeSection(run.id, id);
        // The server's copy, straight away: the driver reads `run` to decide
        // what is ready next, and waiting for a list reload to tell it would
        // stall between every section.
        if (runId) setFetched(after);
      } catch {
        // The row shows what the server recorded on the next read; a failed
        // one must not stop the sections queued behind it.
      }
      setBusy((prev) => {
        const next = new Set(prev);
        const n = doc?.sections.find((x) => x.id === id)?.n;
        if (n) next.delete(n);
        return next;
      });
    }
    await reloadRuns();
  }, [run, doc, runId, reloadRuns]);

  // The local driver, for "Write next" and for the auto-approve preference.
  // The whole-run case is the server's job now — see `serverWriting` below.
  useEffect(() => {
    if (!auto || !run || busy.size || !pending.length) return;
    const timer = setTimeout(() => void writeIds([pending[0]]), 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, run, pending, busy.size]);

  /**
   * Whether the server is writing this run, and following it while it does.
   *
   * The page used to BE the driver: a loop in the tab asking for one section
   * at a time. A run therefore stopped when the tab did — on a navigation, a
   * hot reload, or a closed window — mid-way, with no sign of why. The server
   * drives now, so this only watches: poll the run while anything is moving,
   * stop when it settles.
   *
   * Whichever way the page was addressed. It watched only /runs/<id>, so a
   * topic opened by name — which is how the list opens one — sat perfectly
   * still while its run was being written, and only a refresh showed any of
   * it. The run is the run either way.
   */
  const watchId = runId ?? run?.id ?? null;
  useEffect(() => {
    if (!watchId) return;
    let stop = false;

    const tick = async () => {
      try {
        const [state, fresh] = await Promise.all([
          isWriting(watchId),
          getRun(watchId),
        ]);
        if (stop) return;
        setServerWriting(state.running);
        if (fresh) setFetched(fresh);
        // Slower once nothing is in flight: the answer stops changing, and a
        // page left open overnight should not be asking twice a second.
        return state.running ? 1500 : 6000;
      } catch {
        return 6000;
      }
    };

    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const wait = (await tick()) ?? 6000;
      if (!stop) timer = setTimeout(() => void loop(), wait);
    };
    void loop();

    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [watchId]);

  /** Write the lot, on the server, and start watching straight away. */
  const writeEverything = useCallback(async () => {
    if (!run) return;
    setServerWriting(true);
    try {
      await startWriting(run.id);
    } catch {
      setServerWriting(false);
    }
  }, [run]);

  /*
   * Two ways to have nothing to show, and they are different problems.
   *
   * A slug that matches no topic is a bad link. A topic with no run is a topic
   * nobody has written for yet, and the answer to that is a button, not an
   * apology. Rendering null for either — which is what this did — leaves an
   * empty page with a sidebar on it and no clue which one happened.
   */
  /*
   * The rail: every real topic in this workspace, with what it has written.
   *
   * It listed the twenty-four sample documents, so the topic you were reading
   * was not necessarily in it, and none of the others opened anything real.
   */
  const query = filter.trim().toLowerCase();
  const railTopics = seriesList
    .flatMap((series) => series.topics.map((x) => ({ ...x, series })))
    .filter((x) => `${x.name} ${x.series.name}`.toLowerCase().includes(query))
    .map((x) => {
      const theirs = latestRunFor(runs, x.id);
      return {
        id: x.id,
        name: x.name,
        slug: topicSlug(x.name),
        written: theirs
          ? theirs.sections.filter((sec) => sec.state === "done").length
          : 0,
        total: theirs ? theirs.sections.length : 0,
      };
    });

  /*
   * A run addressed by id does not need a topic.
   *
   * Runs can be started from the Run sheet without one — the template is
   * pointed at a URL rather than at an idea on a shelf — and `runs.topic_id`
   * is nulled when a topic is deleted, deliberately, so the content outlives
   * it. Requiring a topic here turned both of those into "No topic by that
   * name" over a run that was sitting right there.
   */
  if (!runId && !topic) {
    return (
      <Empty
        go={go}
        title="No topic by that name"
        body="It may have been renamed or deleted. Everything that exists is on the Content list."
      />
    );
  }

  if (runId && !run) {
    return (
      <Empty
        go={go}
        title="No run by that id"
        body="It may have been deleted. Everything that exists is on the Content list."
      />
    );
  }

  /*
   * A topic nobody has written for yet.
   *
   * This was a centred box saying "nothing written" with a button back to the
   * list — a dead end at the exact moment you had arrived somewhere wanting to
   * do something. It is the same page now: the rail so you can move, what the
   * template will write so you know what you are asking for, and the button
   * that asks for it.
   */
  if (!doc || !run) {
    return (
      <UnwrittenTopic
        topic={topic!}
        template={packForSeries(packs, topic!.series.pack)}
        rail={railTopics}
        filter={filter}
        setFilter={setFilter}
        go={go}
        starting={starting}
        onRun={async () => {
          if (starting) return;
          setStarting(true);
          try {
            /*
             * Run, here, without leaving.
             *
             * Everything the run needs is on the topic, so there is nothing to
             * ask: it creates the run, sets the server writing, and reloads —
             * at which point this screen gives way to the document itself and
             * the sections fill in where they already are. Null means the
             * shelf has no template, the one thing that IS a question, and the
             * sheet has opened on this topic to ask it.
             */
            await runTopicNow(topic!.id);
          } finally {
            setStarting(false);
          }
        }}
      />
    );
  }

  const written = writtenCount(doc);
  const stateOf = (s: DocSection): SectionState =>
    busy.has(s.n) ? "writing" : s.state;

  /** The one being written this second, if any, and how many gave up. */
  const nowWriting = doc.sections.find((s) => stateOf(s) === "writing") ?? null;
  const failedCount = doc.sections.filter((s) => stateOf(s) === "failed").length;

  const rollUp = (sections: DocSection[]): SectionState => {
    const states = sections.map(stateOf);
    if (states.every((s) => s === "written")) return "written";
    if (states.some((s) => s === "writing")) return "writing";
    return "queued";
  };

  // Every group, always. The language tabs that narrowed this went with the
  // outputs panel; "all" was their default and is now the only state.
  const visible = groups.filter((g) => g.sections.length > 0);

  const allOpen =
    visible.length > 0 &&
    visible.every((g) => g.sections.every((s) => openSections.has(s.n)));

  const toggleSection = (n: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const toggleAll = () =>
    setOpenSections(
      allOpen
        ? new Set()
        : new Set(visible.flatMap((g) => g.sections.map((s) => s.n))),
    );

  /**
   * Re-write these sections, for real.
   *
   * One request each, in order, because the model behind them is a single
   * local process and parallel requests raced it into returning an error page
   * instead of JSON. Slower, and it finishes.
   */
  /** The same, addressed the way the rows are numbered. */
  const redo = (ns: string[]) =>
    writeIds(
      ns
        .map((n) => doc?.sections.find((x) => x.n === n)?.id)
        .filter((id): id is string => Boolean(id)),
    );

  const startEdit = (section: DocSection) => {
    setEditing(section.n);
    setDraft(section.body.join("\n"));
  };

  /**
   * Save what was typed.
   *
   * The server's copy of the run is taken back rather than the draft being
   * patched into the local one: saving also marks the section edited and can
   * move it out of "failed", and rebuilding that here would be a second
   * implementation of what the server just did.
   */
  const saveEdit = async (section: DocSection) => {
    // No id means the document did not come from a run, so there is no row on
    // the server to save into. The Edit button is not offered in that case.
    if (!run || !section.id || saving) return;
    setSaving(true);
    try {
      const after = await editSection(run.id, section.id, draft);
      if (runId) setFetched(after);
      await reloadRuns();
      setEditing(null);
    } catch {
      // The box stays open with the text still in it — losing what someone
      // typed because a request failed is the worst thing this could do.
    } finally {
      setSaving(false);
    }
  };

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    later(() => setCopied(null), 1400);
  };

  const download = () => {
    const blob = new Blob([docText(doc)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };


  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1320,
        margin: "0 auto",
        padding: "26px 30px 60px",
      }}
    >
      <Hov
        onClick={() => go("/content")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: t(0.5),
          cursor: "pointer",
          marginBottom: 14,
        }}
        hover={{ color: "#f0f0f4" }}
      >
        <BackGlyph size={13} />
        <span>Content</span>
      </Hov>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 11 }}
          >
            <h1
              style={{
                fontFamily: font.tight,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: "-0.028em",
                margin: 0,
              }}
            >
              {doc.topic}
            </h1>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 10,
                letterSpacing: "0.1em",
                padding: "3px 8px",
                borderRadius: 20,
                background: w(0.07),
                color: t(0.55),
              }}
            >
              {doc.part}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: t(0.46) }}>
            {doc.pack} · {doc.blurb}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          {/*
            While a run still has sections to write, the header is about
            finishing it, not about redoing what is already there. Redo all
            comes back once it is done.
          */}
          {unwritten ? (
            auto ? (
              <Hov
                onClick={() => setAuto(false)}
                style={toolButton}
                hover={{ background: w(0.12) }}
              >
                Pause
              </Hov>
            ) : (
              <>
                <Hov
                  onClick={() => void writeIds(pending.slice(0, 1))}
                  style={toolButton}
                  hover={{ background: w(0.12) }}
                >
                  <RedoGlyph size={13} />
                  Write next
                </Hov>
                <Hov
                  onClick={() => void writeEverything()}
                  style={toolButton}
                  hover={{ background: w(0.12) }}
                >
                  Write the rest
                </Hov>
              </>
            )
          ) : (
            <Hov
              onClick={() => redo(doc.sections.map((s) => s.n))}
              style={toolButton}
              hover={{ background: w(0.12) }}
            >
              <RedoGlyph size={13} />
              Redo all
            </Hov>
          )}
          <Hov
            onClick={download}
            style={toolButton}
            hover={{ background: w(0.12) }}
          >
            <DownloadGlyph size={13} />
            Download
          </Hov>
          <Hov
            onClick={() => copy("all", docText(doc))}
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
            <CopyGlyph size={13} stroke="#fff" />
            {copied === "all" ? "Copied" : "Copy all"}
          </Hov>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            padding: "6px 11px",
            borderRadius: 9,
            fontSize: 12,
            fontFamily: font.mono,
            background: w(0.06),
            border: `1px solid ${w(0.09)}`,
            color: t(0.62),
          }}
        >
          {/* Against this document's OWN section count. SECTION_TOTAL was the
              design's fifteen, so a real twelve-section run read "12/15
              written" and looked three short forever. */}
          {written}/{doc.sections.length} written
        </span>

        {/* Beside the count, because the count is the thing it explains. */}
        {status ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 11px",
              borderRadius: 9,
              fontSize: 12,
              background: STATUS_TONE[status.tone].bg,
              border: `1px solid ${STATUS_TONE[status.tone].border}`,
              color: STATUS_TONE[status.tone].fg,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "currentColor",
                animation:
                  status.tone === "busy"
                    ? "os-pulse 1.1s ease-in-out infinite"
                    : undefined,
              }}
            />
            <span style={{ fontWeight: 600 }}>{status.text}</span>
            {status.note ? (
              <span style={{ color: t(0.42), fontWeight: 500 }}>
                · {status.note}
              </span>
            ) : null}
          </span>
        ) : null}
        <Hov
          onClick={toggleAll}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 11px",
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            color: t(0.6),
            cursor: "pointer",
          }}
          hover={{ color: "#f0f0f4", background: w(0.06) }}
        >
          <ListGlyph size={12} />
          {allOpen ? "Collapse all" : "Expand all"}
        </Hov>

        {/*
          Reading mode.

          Kept beside Expand all rather than up with Redo all and Download:
          those act on the document, this only changes how you are looking at
          it, and grouping it with them would read as a fourth thing that
          changes something.
        */}
        <Hov
          onClick={() => setReading(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 11px",
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            color: t(0.6),
            cursor: "pointer",
          }}
          hover={{ color: "#f0f0f4", background: w(0.06) }}
        >
          <ReadGlyph size={12} />
          Read
        </Hov>
      </div>

      {/*
        The run as one line.

        "0/12 written" and twelve QUEUED chips is a number you have to hold in
        your head against another number, and it does not move while you watch
        it. A bar moves: the green is done, the red is what failed, and the
        pulsing blue is the section being written this second — the one thing
        the page could not say at a glance while it was the only thing anybody
        was watching for.
      */}
      {doc.sections.length ? (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              height: 4,
              borderRadius: 3,
              overflow: "hidden",
              background: w(0.07),
            }}
          >
            <span
              style={{
                width: `${(written / doc.sections.length) * 100}%`,
                background: "#4bb07a",
                transition: "width 300ms ease",
              }}
            />
            {failedCount ? (
              <span
                style={{
                  width: `${(failedCount / doc.sections.length) * 100}%`,
                  background: "#d1656b",
                }}
              />
            ) : null}
            {nowWriting ? (
              <span
                style={{
                  width: `${(1 / doc.sections.length) * 100}%`,
                  background: "#6a9dff",
                  animation: "os-pulse 1.1s ease-in-out infinite",
                }}
              />
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 7,
              fontSize: 11.5,
              color: t(0.45),
            }}
          >
            <span style={{ fontFamily: font.mono, color: t(0.6) }}>
              {written}/{doc.sections.length}
            </span>
            {nowWriting ? (
              <span style={{ color: "#6a9dff", fontWeight: 600 }}>
                writing {nowWriting.n} · {nowWriting.name}
              </span>
            ) : serverWriting || busy.size ? (
              <span style={{ color: "#6a9dff", fontWeight: 600 }}>
                picking the next section…
              </span>
            ) : failedCount ? (
              <span style={{ color: "#d1656b", fontWeight: 600 }}>
                {failedCount} failed — Write the rest tries {failedCount === 1 ? "it" : "them"} again
              </span>
            ) : written === doc.sections.length ? (
              <span>every section written</span>
            ) : (
              <span>{doc.sections.length - written} still to write</span>
            )}
          </div>
        </div>
      ) : null}

      {doc ? (
        <ReadingMode
          open={reading}
          onClose={() => setReading(false)}
          doc={doc}
          groups={groups}
        />
      ) : null}

      {/* What the run was told to watch, when it was given one. */}
      {source ? <SourceStrip source={source} /> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "208px 1fr 300px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <Rail
          label="TOPICS"
          filter={filter}
          onFilter={setFilter}
          filterLabel="Filter topics"
          activeId={topic?.id}
          items={railTopics.map((d) => ({
            id: d.id,
            label: d.name,
            count: d.written,
            href: `/content/${d.slug}`,
            icon: (
              /* Green only when the whole run landed — against ITS OWN total,
                 not a global constant, because two templates do not have the
                 same number of sections. */
              <TopicGlyph
                size={12}
                stroke={
                  d.total > 0 && d.written === d.total
                    ? "#4bb07a"
                    : d.written > 0
                      ? "#6a9dff"
                      : t(0.3)
                }
              />
            ),
          }))}
          onPick={(id) => {
            const picked = railTopics.find((d) => d.id === id);
            if (picked) go(`/content/${picked.slug}`);
          }}
        />

        {/* output groups */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visible.map((g) => {
            const state = rollUp(g.sections);
            const st = STATE_STYLE[state];
            const done = g.sections.filter(
              (s) => stateOf(s) === "written",
            ).length;
            const Glyph = GROUP_GLYPH[g.key] ?? GlobeGlyph;

            return (
              <div
                key={g.key}
                id={`group-${g.key}`}
                style={{
                  ...panel(16),
                  // Output groups carry a brighter rim so they read as the
                  // deliverables among the working steps.
                  borderColor: g.isOutput ? w(0.12) : w(0.06),
                  overflow: "hidden",
                  scrollMarginTop: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "12px 14px",
                    background: g.isOutput ? w(0.03) : "transparent",
                    borderBottom: `1px solid ${w(0.055)}`,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 9,
                      background: st.bg,
                    }}
                  >
                    <Glyph size={14} stroke={st.fg} />
                  </span>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                        {g.label}
                      </span>
                      {g.isOutput ? (
                        <span
                          style={{
                            fontFamily: font.mono,
                            fontSize: 9,
                            letterSpacing: "0.11em",
                            padding: "2px 7px",
                            borderRadius: 20,
                            background: st.bg,
                            color: st.fg,
                            animation:
                              state === "writing"
                                ? "os-pulse 1.1s ease-in-out infinite"
                                : "none",
                          }}
                        >
                          {st.label}
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{ marginTop: 2, fontSize: 11.5, color: t(0.42) }}
                    >
                      {g.note}
                    </div>
                  </div>

                  <span
                    style={{
                      marginLeft: "auto",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      flex: "none",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 10.5,
                        color: t(0.45),
                      }}
                    >
                      {done}/{g.sections.length}
                    </span>
                    <Hov
                      as="span"
                      onClick={() => redo(g.sections.map((s) => s.n))}
                      aria-label={`Redo every section in ${g.label}`}
                      title={`Redo every section in ${g.label}`}
                      style={iconButton}
                      hover={{ background: w(0.13), color: "#f0f0f4" }}
                    >
                      <RedoGlyph size={12} />
                    </Hov>
                    <Hov
                      as="span"
                      onClick={() => copy(g.key, groupText(g))}
                      aria-label={`Copy ${g.label}`}
                      title={copied === g.key ? "Copied" : `Copy ${g.label}`}
                      style={iconButton}
                      hover={{ background: w(0.13), color: "#f0f0f4" }}
                    >
                      {copied === g.key ? (
                        <CheckGlyph size={12} stroke="#4bb07a" />
                      ) : (
                        <CopyGlyph size={12} />
                      )}
                    </Hov>
                  </span>
                </div>

                {g.sections.map((s) => {
                  const sState = stateOf(s);
                  const sSt = STATE_STYLE[sState];
                  const open = openSections.has(s.n) && s.body.length > 0;
                  return (
                    <div key={s.n}>
                      {/*
                        The whole row opens the section, not just the caret.
                        A 20px target beside a full-width row that looks
                        clickable is a row people click and nothing happens —
                        which is exactly what it was.
                      */}
                      <Hov
                        onClick={
                          s.body.length ? () => toggleSection(s.n) : undefined
                        }
                        aria-expanded={s.body.length ? open : undefined}
                        aria-label={
                          s.body.length
                            ? `${open ? "Collapse" : "Expand"} ${s.name}`
                            : undefined
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 14px",
                          cursor: s.body.length ? "pointer" : "default",
                          transition: "background 140ms",
                        }}
                        hover={s.body.length ? { background: w(0.035) } : undefined}
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            flex: "none",
                            display: "grid",
                            placeItems: "center",
                            opacity: s.body.length ? 1 : 0.25,
                          }}
                        >
                          {open ? (
                            <CaretDown size={12} stroke={t(0.5)} />
                          ) : (
                            <CaretRight size={12} stroke={t(0.5)} />
                          )}
                        </span>

                        <span
                          style={{
                            fontFamily: font.mono,
                            fontSize: 11,
                            color: t(0.3),
                            flex: "none",
                          }}
                        >
                          {s.n}
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                            }}
                          >
                            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                              {s.name}
                            </span>
                            {s.lang ? (
                              <span
                                style={{
                                  fontFamily: font.mono,
                                  fontSize: 8.5,
                                  letterSpacing: "0.1em",
                                  padding: "2px 5px",
                                  borderRadius: 5,
                                  background: w(0.07),
                                  color: t(0.5),
                                }}
                              >
                                {s.lang}
                              </span>
                            ) : null}
                            {sState !== "written" ? (
                              <span
                                style={{
                                  fontFamily: font.mono,
                                  fontSize: 8.5,
                                  letterSpacing: "0.1em",
                                  padding: "2px 6px",
                                  borderRadius: 20,
                                  background: sSt.bg,
                                  color: sSt.fg,
                                  animation:
                                    sState === "writing"
                                      ? "os-pulse 1.1s ease-in-out infinite"
                                      : "none",
                                }}
                              >
                                {sSt.label}
                              </span>
                            ) : null}
                            {/* Quiet, because it is a note about provenance
                                rather than a state you have to act on. */}
                            {s.edited ? (
                              <span
                                title="Changed by hand. Running this section again replaces it."
                                style={{
                                  fontFamily: font.mono,
                                  fontSize: 8.5,
                                  letterSpacing: "0.1em",
                                  padding: "2px 6px",
                                  borderRadius: 20,
                                  background: w(0.07),
                                  color: t(0.5),
                                }}
                              >
                                EDITED
                              </span>
                            ) : null}
                          </div>
                          <div
                            style={{
                              marginTop: 1,
                              fontSize: 11,
                              color: t(0.4),
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {s.purpose}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 6, flex: "none" }}>
                          {/* Only where there is a row on the server to save
                              into, and only once something has been written —
                              there is nothing to edit in an empty section. */}
                          {s.id && s.body.length ? (
                            <Hov
                              as="span"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (editing === s.n) {
                                  setEditing(null);
                                } else {
                                  startEdit(s);
                                  // Opening the editor on a folded row would
                                  // put a textarea where nothing is showing.
                                  if (!openSections.has(s.n)) toggleSection(s.n);
                                }
                              }}
                              aria-label={`Edit ${s.name}`}
                              title={`Edit ${s.name}`}
                              style={{
                                ...iconButton,
                                ...(editing === s.n
                                  ? { background: w(0.16), color: "#f0f0f4" }
                                  : null),
                              }}
                              hover={{ background: w(0.13), color: "#f0f0f4" }}
                            >
                              <PencilIcon size={12} stroke="currentColor" />
                            </Hov>
                          ) : null}
                          <Hov
                            as="span"
                            onClick={(e) => {
                              // The row toggles; these do their own thing.
                              e.stopPropagation();
                              void redo([s.n]);
                            }}
                            aria-label={`Redo ${s.name}`}
                            title={`Redo ${s.name}`}
                            style={iconButton}
                            hover={{ background: w(0.13), color: "#f0f0f4" }}
                          >
                            <RedoGlyph size={12} />
                          </Hov>
                          <Hov
                            as="span"
                            onClick={(e) => {
                              e.stopPropagation();
                              copy(s.n, sectionText(s));
                            }}
                            aria-label={`Copy ${s.name}`}
                            title={copied === s.n ? "Copied" : `Copy ${s.name}`}
                            style={iconButton}
                            hover={{ background: w(0.13), color: "#f0f0f4" }}
                          >
                            {copied === s.n ? (
                              <CheckGlyph size={12} stroke="#4bb07a" />
                            ) : (
                              <CopyGlyph size={12} />
                            )}
                          </Hov>
                        </div>
                      </Hov>

                      {open ? (
                        <div
                          style={{
                            margin: "0 14px 12px 44px",
                            padding: "12px 14px",
                            borderRadius: 12,
                            background: "rgba(0,0,0,0.26)",
                            border: `1px solid ${w(0.06)}`,
                            display: "flex",
                            flexDirection: "column",
                            gap: 9,
                          }}
                        >
                          {/*
                            Keyed by position, not by the line itself.
                            Generated text has blank lines and repeated ones,
                            so the text is not an identity: two empty lines
                            both key to "" and React drops one. Position is the
                            real identity here — the list is the whole body
                            re-split on every change, never reordered.
                          */}
                          {editing === s.n ? (
                            <>
                              <TextArea
                                autoFocus
                                mono={false}
                                rows={Math.min(24, Math.max(6, s.body.length + 2))}
                                value={draft}
                                aria-label={`${s.name} text`}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") setEditing(null);
                                  // The shortcut everything else uses for
                                  // "done with this box".
                                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    void saveEdit(s);
                                  }
                                }}
                                style={{ lineHeight: 1.6 }}
                              />
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span style={{ fontSize: 11, color: t(0.35) }}>
                                  Running this section again replaces whatever
                                  you write here.
                                </span>
                                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                                  <Button
                                    size="sm"
                                    onClick={() => setEditing(null)}
                                    disabled={saving}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => void saveEdit(s)}
                                    disabled={saving}
                                  >
                                    {saving ? "Saving…" : "Save"}
                                  </Button>
                                </span>
                              </div>
                            </>
                          ) : (
                            s.body.map((line, i) => (
                              <div
                                key={i}
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.6,
                                  color: t(0.82),
                                  textWrap: "pretty",
                                }}
                              >
                                {line}
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {visible.length === 0 ? (
            <div
              style={{
                padding: "22px 16px",
                ...panel(16, false),
                fontSize: 13,
                color: t(0.4),
              }}
            >
              Nothing in this language yet.
            </div>
          ) : null}
        </div>

        {/*
          The section index. An OUTPUTS panel sat above it — five rows naming
          each deliverable with a READY chip and an n/n bar.

          Every one of those five facts is already on the page twice: each
          output is a titled block in the document body carrying the same chip
          and the same count, and the index below lists all twelve sections with
          their own state dots. A third telling is not a summary, it is the same
          column read out loud again — and it was pushing the index, the one
          thing here you actually navigate with, below the fold.
        */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "sticky",
            top: 0,
          }}
        >
          <div
            style={{
              padding: 14,
              ...panel(17),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <ListGlyph size={12} stroke={t(0.45)} />
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: t(0.45),
                }}
              >
                SECTIONS
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  color: t(0.3),
                }}
              >
                {written}/{doc.sections.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {doc.sections.map((s) => {
                const st = STATE_STYLE[stateOf(s)];
                return (
                  <Hov
                    key={s.n}
                    onClick={() => {
                      setOpenSections((prev) => new Set(prev).add(s.n));
                      document
                        .getElementById(`group-${s.output ?? s.kind}`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "6px 7px",
                      borderRadius: 9,
                      cursor: "pointer",
                    }}
                    hover={{ background: w(0.06) }}
                  >
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 10,
                        color: t(0.28),
                      }}
                    >
                      {s.n}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        color: t(0.72),
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.name}
                    </span>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        flex: "none",
                        borderRadius: "50%",
                        background: st.dot,
                      }}
                    />
                  </Hov>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * The page with nothing on it, saying which kind of nothing.
 *
 * Its own component because both cases want the same shape and neither wants
 * the reader's chrome — a topics rail beside an empty page is furniture around
 * an absence.
 */
function Empty({
  go,
  title,
  body,
}: {
  go: (href: string) => void;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 640,
        margin: "0 auto",
        padding: "80px 30px",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {title}
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 13.5, color: t(0.5), textWrap: "pretty" }}>
        {body}
      </p>
      <Hov
        onClick={() => go("/content")}
        style={{
          display: "inline-grid",
          placeItems: "center",
          height: 34,
          padding: "0 16px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          ...primary,
        }}
      >
        Back to Content
      </Hov>
    </div>
  );
}

/**
 * The reel behind a run, as it was actually fetched.
 *
 * Stills and a transcript length rather than a link: the point is to show what
 * the model was handed, and "8 stills, 1,240 characters of transcript" answers
 * that where a URL only says where it came from.
 */
function SourceStrip({ source }: { source: Source }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 14px",
        borderRadius: 14,
        background: w(0.04),
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: w(0.08),
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            color: t(0.42),
          }}
        >
          SOURCE
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {source.title || source.url}
        </span>
      </div>
      <div style={{ marginTop: 3, fontSize: 11.5, color: t(0.45) }}>
        {[
          source.uploader,
          source.duration ? `${source.duration}s` : "",
          source.frames.length ? `${source.frames.length} stills` : "no stills",
          source.transcript
            ? `${source.transcript.length.toLocaleString()} characters of transcript`
            : "no transcript",
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {source.frames.length ? (
        <div style={{ marginTop: 9, display: "flex", gap: 5, overflowX: "auto" }}>
          {source.frames.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={f.file}
              src={frameUrl(source.id, f.file)}
              alt={`Frame at ${f.at} seconds`}
              style={{
                flex: "none",
                height: 58,
                borderRadius: 7,
                border: `1px solid ${w(0.1)}`,
              }}
            />
          ))}
        </div>
      ) : null}
      {source.error ? (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#e0a83c" }}>
          {source.error}
        </div>
      ) : null}
    </div>
  );
}
