"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findTool } from "@/lib/tools";
import { ago } from "@/lib/packs-client";
import {
  fetchSource,
  frameUrl,
  listSources,
  removeSource,
  type Source,
} from "@/lib/sources-client";
import {
  addFrame,
  addTopics,
  runResearch,
  type ResearchResult,
} from "@/lib/tools-client";
import { useStore } from "@/lib/store";
import {
  font,
  ghost,
  ghostHover,
  primary,
  rise,
  spring,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import {
  Button,
  Chip,
  Field,
  IconButton,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import { BackGlyph, ClockGlyph } from "@/components/ui/DocIcons";
import {
  AlertIcon,
  CheckIcon,
  PlayIcon,
  TrashIcon,
} from "@/components/ui/Icons";

/**
 * The researcher.
 *
 * A reel goes in — a link, or a file off this machine — and what comes back is
 * which website it is about, what it visibly does, and topics worth making
 * about it. The frames are the evidence: a transcript that says "go to this
 * website" names nothing, and the address bar in frame four names everything.
 *
 * Three steps down one column rather than a wizard: fetching, choosing what to
 * look at, and reading the answer are one sitting, and the middle step is the
 * one you go back to when the first answer is thin.
 */

const kicker = {
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.14em",
  color: t(0.38),
} as const;

const NO_SERIES = "none";

/** "72" or "1:12" — both are a number of seconds. */
function parseAt(text: string) {
  const clean = text.trim();
  if (!clean) return null;
  const parts = clean.split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  const seconds = parts.reduce((total, p) => total * 60 + p, 0);
  return seconds >= 0 ? seconds : null;
}

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * The video this browser had open, remembered across reloads.
 *
 * The history itself is on the server — every source row, with what the
 * researcher made of it. This is only the bookmark: which one you were looking
 * at, so coming back to the tool puts you back where you were rather than on
 * an empty form. Per browser, deliberately; it is a cursor, not a fact about
 * the workspace.
 */
const LAST = "contentos.researcher.last";

const remember = (id: string) => {
  try {
    window.localStorage.setItem(LAST, id);
  } catch {
    // A private window, or storage switched off. The history still lists
    // everything; only the "where you left off" convenience is lost.
  }
};

const rememberedId = () => {
  try {
    return window.localStorage.getItem(LAST) ?? "";
  } catch {
    return "";
  }
};

/** What a history row is called, whatever it came from. */
const nameOf = (row: Source) =>
  row.title.trim() || row.filename.trim() || row.url.replace(/^https?:\/\//, "");

export function ContentResearcherView() {
  const { go, project, seriesList, reloadSeries, askConfirm } = useStore();
  const tool = findTool("content-researcher");

  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [at, setAt] = useState("");

  const [fetching, setFetching] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResearchResult | null>(null);

  /** Said out loud when something worked but not the way you asked. */
  const [notice, setNotice] = useState("");
  const [series, setSeries] = useState(NO_SERIES);
  const [saved, setSaved] = useState<string[]>([]);
  const fileBox = useRef<HTMLInputElement>(null);

  /**
   * Everything this workspace has ever put through the tool.
   *
   * Off the server, not out of this tab: a source row is kept with what the
   * researcher made of it, so the list survives a reload, a different browser
   * and a machine that was turned off in between.
   */
  const [history, setHistory] = useState<Source[]>([]);

  const frames = source?.frames ?? [];
  const chosen = picked.length ? picked : frames.map((f) => f.file);

  const seriesOptions = useMemo(
    () => [
      { value: NO_SERIES, label: "Choose a shelf…" },
      ...seriesList.map((s) => ({ value: s.id, label: s.name })),
    ],
    [seriesList],
  );

  /** Re-read the list, after anything that adds to it or changes a row. */
  const refresh = useCallback(async () => {
    const rows = await listSources(project?.id).catch(() => null);
    // Fetching leaves a row behind whatever happens; a failed one is a record
    // of a link that did not work, not a video you can open.
    if (rows) setHistory(rows.filter((row) => row.state === "ready"));
  }, [project?.id]);

  /**
   * Open one from the history, with what it already found.
   *
   * The saved answer comes back with it — that is the point of keeping it —
   * and the frames that answer was read from are the ones ticked, so pressing
   * Watch again repeats the same reading rather than silently widening it.
   */
  const reopen = useCallback((next: Source) => {
    setSource(next);
    setResult(next.research ?? null);
    setSaved([]);
    setNotice("");
    setError("");
    const read = new Set(next.research?.readFrames ?? []);
    setPicked(
      read.size
        ? next.frames.filter((f) => read.has(f.at)).map((f) => f.file)
        : next.frames.map((f) => f.file),
    );
    remember(next.id);
  }, []);

  /*
   * The list, and where you left off.
   *
   * Arriving at the tool used to mean an empty form no matter how much had
   * been read through it. Now the history loads, and the video that was open
   * when you last closed the tab opens with it.
   */
  useEffect(() => {
    let cancelled = false;
    void listSources(project?.id)
      .then((rows) => {
        if (cancelled) return;
        const ready = rows.filter((row) => row.state === "ready");
        setHistory(ready);
        const last = rememberedId();
        const found = last ? ready.find((row) => row.id === last) : null;
        if (found) reopen(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, reopen]);

  /** Everything a new video invalidates, in one place. */
  const start = (next: Source) => {
    setSource(next);
    setPicked(next.frames.map((f) => f.file));
    setResult(next.research ?? null);
    setSaved([]);
    remember(next.id);
    void refresh();
  };

  /** Drop a video, its frames and its answer, from the history and the disk. */
  const forget = (row: Source) =>
    askConfirm({
      title: `Forget “${nameOf(row)}”?`,
      body: "The download, its frames and what the researcher found go with it. The topics you saved onto a shelf stay where they are.",
      confirmLabel: "Forget it",
      onConfirm: () => {
        void removeSource(row.id).catch(() => {});
        setHistory((list) => list.filter((x) => x.id !== row.id));
        if (source?.id === row.id) {
          setSource(null);
          setResult(null);
          setPicked([]);
        }
      },
    });

  const fetchUrl = async () => {
    if (!url.trim() || fetching) return;
    setFetching(true);
    setError("");
    try {
      start(await fetchSource({ url: url.trim(), workspaceId: project?.id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That link could not be fetched");
    } finally {
      setFetching(false);
    }
  };

  const upload = async (file: File) => {
    setFetching(true);
    setError("");
    try {
      const { uploadSource } = await import("@/lib/tools-client");
      start(await uploadSource(file, project?.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be read");
    } finally {
      setFetching(false);
    }
  };

  const cutFrame = async () => {
    const seconds = parseAt(at);
    if (seconds === null || !source) return;
    setError("");
    setNotice("");
    try {
      const before = source.frames.length;
      const next = await addFrame(source.id, seconds);
      setSource(next);

      /*
       * Ticked straight away: you asked for that moment, so it is one of the
       * ones you want read.
       *
       * A moment within half a second of a frame that already exists does not
       * make a second one — the picture would be the same — so the nearest is
       * ticked instead and the screen says so. Silently doing nothing to a
       * button you just pressed reads as broken.
       */
      const near = next.frames.find((f) => Math.abs(f.at - seconds) < 0.8);
      if (near) setPicked((list) => [...new Set([...list, near.file])]);
      if (next.frames.length === before && near) {
        setNotice(`There was already a frame at ${clock(near.at)} — ticked that one.`);
      }
      setAt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That moment could not be cut");
    }
  };

  const read = async () => {
    if (!source || reading) return;
    setReading(true);
    setError("");
    try {
      setResult(
        await runResearch({
          sourceId: source.id,
          frames: chosen,
          note: note.trim() || undefined,
        }),
      );
      // The row now carries this answer, and the list beneath says so.
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The model did not answer");
    } finally {
      setReading(false);
    }
  };

  /** One idea onto a shelf, as a topic with the angle as its context. */
  const saveIdea = async (idea: ResearchResult["ideas"][number]) => {
    if (series === NO_SERIES || !result) return;
    setError("");
    try {
      const context = [
        idea.angle,
        idea.why,
        result.site.url ? `Site: ${result.site.url}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const out = await addTopics(series, [{ name: idea.title, context }]);
      setSaved((list) => [...list, idea.title]);
      if (!out.added.length) {
        setError(`“${idea.title}” is already on that shelf.`);
      }
      void reloadSeries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved");
    }
  };

  const busy = fetching || reading;

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 940,
        margin: "0 auto",
        padding: "26px 30px 60px",
      }}
    >
      <Hov
        onClick={() => go("/tools")}
        href="/tools"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 14,
          fontSize: 12.5,
          fontWeight: 600,
          color: t(0.5),
          textDecoration: "none",
        }}
        hover={{ color: "#f0f0f4" }}
      >
        <BackGlyph size={13} stroke="currentColor" />
        Tools
      </Hov>

      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          margin: "0 0 5px",
        }}
      >
        {tool?.name ?? "Content Researcher"}
      </h1>
      <p style={{ margin: "0 0 22px", fontSize: 13.5, color: t(0.48) }}>
        {tool?.tagline}
      </p>

      {error ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            marginBottom: 16,
            padding: "11px 13px",
            borderRadius: 12,
            background: "rgba(209,101,107,0.12)",
            border: "1px solid rgba(209,101,107,0.25)",
            fontSize: 12.5,
            color: "#e0a3a7",
          }}
        >
          <AlertIcon size={14} stroke="currentColor" />
          <span style={{ textWrap: "pretty" }}>{error}</span>
        </div>
      ) : null}

      {/* ── 1. the video ─────────────────────────────────────────────── */}
      <section style={panel}>
        <div style={{ ...kicker, marginBottom: 10 }}>STEP 1 · THE VIDEO</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <Field label="Link" hint="YouTube, Reels, TikTok — anything yt-dlp reads">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchUrl();
              }}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 14 }}>
            <Button
              variant="primary"
              onClick={() => void fetchUrl()}
              disabled={busy || !url.trim()}
            >
              {fetching ? "Fetching…" : "Fetch"}
            </Button>
            <Button onClick={() => fileBox.current?.click()} disabled={busy}>
              Upload a file
            </Button>
          </div>
        </div>

        <input
          ref={fileBox}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so choosing the same file twice fires again — the second
            // time is usually after a failure, which is when you most want it.
            e.target.value = "";
            if (file) void upload(file);
          }}
        />

        {fetching ? (
          <div style={{ fontSize: 12.5, color: t(0.5) }}>
            Downloading, cutting stills and transcribing. Minutes, not seconds —
            most of it is the download.
          </div>
        ) : null}

        {source ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 4,
              fontSize: 12.5,
              color: t(0.6),
            }}
          >
            <Chip mono>{source.kind === "file" ? "FILE" : "LINK"}</Chip>
            <span style={{ fontWeight: 600 }}>
              {source.title || source.filename || source.url}
            </span>
            <span style={{ color: t(0.4) }}>
              {source.duration ? clock(source.duration) : ""}
              {source.transcript ? " · transcript" : " · no transcript"}
              {` · ${frames.length} frames`}
            </span>
          </div>
        ) : null}

        {source?.error ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#c99a3f" }}>
            {source.error}
          </div>
        ) : null}
      </section>

      {/* ── 2. what it looks at ──────────────────────────────────────── */}
      {source ? (
        <section style={panel}>
          <div style={{ ...kicker, marginBottom: 4 }}>
            STEP 2 · WHAT IT LOOKS AT
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: t(0.5) }}>
            Pick the moments worth reading — the address bar, the result on
            screen. Every picked frame is sent as a picture, so the right four
            beat all eight.
          </p>

          {/*
            The strip, and the toolbar that acts on it.

            The count comes first, because "how many am I sending" is the
            question the price of this run turns on. All and None sit beside it
            rather than under the grid: picking eight things one at a time is
            the work this screen exists to save.
          */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{ ...kicker, color: chosen.length ? "#6a9dff" : t(0.38) }}
            >
              {chosen.length} OF {frames.length} PICKED
            </span>

            <Button
              size="sm"
              variant="quiet"
              onClick={() => setPicked(frames.map((f) => f.file))}
              disabled={!frames.length || picked.length === frames.length}
            >
              All
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setPicked([])}
              disabled={!picked.length}
            >
              None
            </Button>

            {/*
              Adding a moment belongs here, not under the grid: it is the same
              job as picking one — deciding what gets looked at — and it was
              two rows away from the thing it adds to.
            */}
            <span
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 4px 0 10px",
                borderRadius: 10,
                background: w(0.05),
                border: "1px solid " + w(0.08),
              }}
            >
              <span style={{ ...kicker, color: t(0.35) }}>AT</span>
              <input
                value={at}
                onChange={(e) => setAt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void cutFrame();
                }}
                placeholder="1:12"
                aria-label="Cut a frame at this time"
                style={{
                  width: 54,
                  height: 24,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontFamily: font.mono,
                  fontSize: 12,
                  color: "#f0f0f4",
                }}
              />
              <Button
                size="sm"
                variant="accent"
                onClick={() => void cutFrame()}
                disabled={!at.trim()}
              >
                Cut frame
              </Button>
            </span>
          </div>

          {/*
            The video as a line, with a node per frame.

            Eight thumbnails say what was captured; they do not say WHEN, and
            "the bit where the address bar is up" is a question about time. The
            track is the video, each node sits where it was taken, and clicking
            one picks it — the same act as clicking its thumbnail, approached
            from the other side.
          */}
          {frames.length && source.duration ? (
            <div style={{ position: "relative", height: 24, margin: "2px 5px 14px" }}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 10,
                  height: 3,
                  borderRadius: 2,
                  background: w(0.09),
                }}
              />
              {frames.map((frame) => {
                const on = picked.includes(frame.file);
                const left = Math.min(
                  100,
                  Math.max(0, (frame.at / (source.duration || 1)) * 100),
                );
                return (
                  <Hov
                    key={"tick-" + frame.file}
                    as="span"
                    role="button"
                    aria-label={(on ? "Skip" : "Pick") + " the frame at " + clock(frame.at)}
                    title={clock(frame.at)}
                    onClick={() =>
                      setPicked((list) =>
                        on
                          ? list.filter((f) => f !== frame.file)
                          : [...list, frame.file],
                      )
                    }
                    style={{
                      position: "absolute",
                      left: left + "%",
                      top: on ? 5 : 7,
                      width: on ? 13 : 9,
                      height: on ? 13 : 9,
                      marginLeft: on ? -6.5 : -4.5,
                      borderRadius: "50%",
                      cursor: "pointer",
                      background: on ? "#0057fc" : w(0.22),
                      boxShadow: on ? "0 0 10px rgba(0,87,252,0.55)" : "none",
                      transition: "all 180ms " + spring,
                    }}
                    hover={{ background: on ? "#3b7bff" : w(0.4) }}
                  />
                );
              })}
            </div>
          ) : null}

          {frames.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {frames.map((frame) => {
                const on = picked.includes(frame.file);
                return (
                  <Hov
                    key={frame.file}
                    role="button"
                    aria-pressed={on}
                    aria-label={(on ? "Skip" : "Pick") + " the frame at " + clock(frame.at)}
                    onClick={() =>
                      setPicked((list) =>
                        on
                          ? list.filter((f) => f !== frame.file)
                          : [...list, frame.file],
                      )
                    }
                    style={{
                      position: "relative",
                      aspectRatio: "16 / 10",
                      borderRadius: 13,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "#0b0d12",
                      border: "1px solid " + (on ? "transparent" : w(0.08)),
                      /*
                       * A ring rather than a fat border: a 2px border on a
                       * 148px card reflows the picture inside it every time one
                       * is picked, and the whole grid twitches under the cursor.
                       */
                      boxShadow: on
                        ? "0 0 0 2px #0057fc, 0 10px 24px -12px rgba(0,87,252,0.8)"
                        : "0 1px 2px rgba(0,0,0,0.35)",
                      transition:
                        "transform 180ms " + spring + ", box-shadow 180ms " + spring,
                    }}
                    hover={{ transform: "translateY(-2px)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={frameUrl(source.id, frame.file)}
                      alt={"Frame at " + clock(frame.at)}
                      style={{
                        display: "block",
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        /*
                         * Picked reads as lit, skipped as set aside. Visible
                         * across eight cards at a glance, which a tick in the
                         * corner is not.
                         */
                        filter: on ? "none" : "grayscale(0.5) brightness(0.72)",
                        transition: "filter 180ms ease",
                      }}
                    />

                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.16) 38%, transparent 62%)",
                      }}
                    />

                    <span
                      style={{
                        position: "absolute",
                        left: 9,
                        bottom: 8,
                        fontFamily: font.mono,
                        fontSize: 10.5,
                        letterSpacing: "0.04em",
                        color: on ? "#dce8ff" : t(0.62),
                      }}
                    >
                      {clock(frame.at)}
                    </span>

                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        right: 8,
                        top: 8,
                        width: 20,
                        height: 20,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: "50%",
                        background: on ? "#0057fc" : "rgba(8,10,14,0.55)",
                        border:
                          "1.5px solid " +
                          (on ? "#0057fc" : "rgba(255,255,255,0.45)"),
                        backdropFilter: "blur(4px)",
                        transition: "background 180ms " + spring,
                      }}
                    >
                      {on ? <CheckIcon size={10} stroke="#fff" /> : null}
                    </span>
                  </Hov>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#c99a3f" }}>
              No frames were cut — the video itself was not downloaded, or
              ffmpeg is off in Integrations. It can still read the transcript.
            </p>
          )}

          {notice ? (
            <div style={{ margin: "-2px 0 10px", fontSize: 12, color: t(0.45) }}>
              {notice}
            </div>
          ) : null}

          <Field
            label="Anything it should know"
            hint="what the video does not show — optional"
          >
            <TextArea
              mono={false}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. the site is Bangladeshi, the offer changed last month"
            />
          </Field>

          <Hov
            onClick={() => void read()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 34,
              padding: "0 15px",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              opacity: reading ? 0.6 : 1,
              ...primary,
            }}
          >
            <PlayIcon size={12} fill="#fff" />
            {reading ? "Watching…" : "Watch it and give me ideas"}
          </Hov>
        </section>
      ) : null}

      {/* ── 3. the answer ────────────────────────────────────────────── */}
      {result ? (
        <section style={panel}>
          <div style={{ ...kicker, marginBottom: 10 }}>STEP 3 · WHAT IT FOUND</div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>
              {result.site.name || "Not identified"}
            </span>
            <Chip
              mono
              bg={
                result.site.confidence === "high"
                  ? "rgba(75,176,122,0.16)"
                  : result.site.confidence === "medium"
                    ? "rgba(0,87,252,0.16)"
                    : "rgba(201,154,63,0.16)"
              }
              fg={
                result.site.confidence === "high"
                  ? "#4bb07a"
                  : result.site.confidence === "medium"
                    ? "#6a9dff"
                    : "#c99a3f"
              }
            >
              {result.site.confidence.toUpperCase()} CONFIDENCE
            </Chip>
            {result.site.url ? (
              <a
                href={result.site.url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12.5, color: "#6a9dff" }}
              >
                {result.site.url}
              </a>
            ) : null}
          </div>

          {result.does ? (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: t(0.65) }}>
              {result.does}
            </p>
          ) : null}

          {result.shows.length ? (
            <>
              <div style={{ ...kicker, margin: "16px 0 6px" }}>ON SCREEN</div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: t(0.6) }}>
                {result.shows.map((line) => (
                  <li key={line} style={{ marginBottom: 3 }}>
                    {line}
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {result.verify.length ? (
            <>
              <div style={{ ...kicker, margin: "16px 0 6px" }}>CHECK BEFORE WRITING</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: t(0.6) }}>
                {result.verify.map((line) => (
                  <li key={line} style={{ marginBottom: 3 }}>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {/*
            What it said, when what it said did not fit.

            The answer is asked for as JSON and parsed as JSON, and a model
            that writes a report instead leaves every field empty — which drew
            a panel saying "Not identified" over several minutes of perfectly
            good reading, with the reading itself thrown away. The parse is not
            the answer; it is a convenience on top of one.
          */}
          {!result.site.name && !result.ideas.length && result.raw.trim() ? (
            <>
              <div style={{ ...kicker, margin: "16px 0 6px" }}>
                UNPARSED · IT ANSWERED, BUT NOT IN THE SHAPE THIS TOOL READS
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  maxHeight: 320,
                  overflow: "auto",
                  borderRadius: 11,
                  background: "rgba(0,0,0,0.4)",
                  border: `1px solid ${w(0.08)}`,
                  fontFamily: font.mono,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: t(0.62),
                  whiteSpace: "pre-wrap",
                }}
              >
                {result.raw.trim()}
              </pre>
            </>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 10,
              margin: "20px 0 12px",
            }}
          >
            <div style={{ ...kicker, paddingBottom: 14 }}>
              IDEAS · {result.ideas.length}
            </div>
            <div style={{ width: 240, marginLeft: "auto" }}>
              <Field label="Save onto" hint="the shelf a saved idea lands on">
                <Select
                  label="Series"
                  value={series}
                  onChange={setSeries}
                  options={seriesOptions}
                />
              </Field>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {result.ideas.map((idea) => {
              const done = saved.includes(idea.title);
              return (
                <div
                  key={idea.title}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 13px",
                    borderRadius: 12,
                    background: w(0.04),
                    border: `1px solid ${w(0.08)}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650 }}>
                      {idea.title}
                    </div>
                    <div style={{ marginTop: 3, fontSize: 12.5, color: t(0.55) }}>
                      {idea.angle}
                    </div>
                    {idea.why ? (
                      <div style={{ marginTop: 3, fontSize: 12, color: t(0.4) }}>
                        {idea.why}
                      </div>
                    ) : null}
                  </div>
                  <Hov
                    onClick={() => void saveIdea(idea)}
                    style={{
                      flex: "none",
                      height: 30,
                      padding: "0 12px",
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 9,
                      fontSize: 12,
                      fontWeight: 600,
                      opacity: series === NO_SERIES || done ? 0.5 : 1,
                      ...(done
                        ? {
                            background: "rgba(75,176,122,0.16)",
                            border: "1px solid rgba(75,176,122,0.3)",
                            color: "#4bb07a",
                          }
                        : ghost),
                    }}
                    hover={done ? undefined : ghostHover}
                  >
                    {done ? "Saved" : "Save as topic"}
                  </Hov>
                </div>
              );
            })}
          </div>

          {series === NO_SERIES && result.ideas.length ? (
            <div style={{ marginTop: 10, fontSize: 12, color: t(0.4) }}>
              Choose a shelf above and every Save puts the idea on it, with the
              angle as the topic&rsquo;s context.
            </div>
          ) : null}
        </section>
      ) : null}

      {/*
        ── everything it has read ──────────────────────────────────────

        The answer used to live in the tab that asked for it: reload, and
        several minutes of watching and every idea it produced were gone, with
        nothing on screen to say they had ever existed. The reading is kept on
        the video now, so this is simply that list — click one and it opens
        with what it found, at no cost at all.
      */}
      {history.length ? (
        <section style={panel}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <ClockGlyph size={12} stroke={t(0.38)} />
            <span style={kicker}>HISTORY · {history.length}</span>
            <span
              style={{ marginLeft: "auto", fontSize: 11.5, color: t(0.38) }}
            >
              Everything put through this tool. Click one to open it again.
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {history.map((row) => {
              const open = source?.id === row.id;
              const found = row.research?.site;
              const shot = row.frames[0]
                ? frameUrl(row.id, row.frames[0].file)
                : "";
              return (
                <Hov
                  key={row.id}
                  onClick={() => reopen(row)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 11px",
                    borderRadius: 12,
                    cursor: "pointer",
                    background: open ? w(0.08) : w(0.035),
                    border: `1px solid ${open ? "rgba(0,87,252,0.4)" : w(0.07)}`,
                  }}
                  hover={{ background: w(0.08), borderColor: w(0.14) }}
                >
                  {shot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shot}
                      alt=""
                      style={{
                        display: "block",
                        width: 38,
                        height: 52,
                        flex: "none",
                        objectFit: "cover",
                        borderRadius: 8,
                        border: `1px solid ${w(0.08)}`,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 38,
                        height: 52,
                        flex: "none",
                        borderRadius: 8,
                        background: w(0.05),
                        border: `1px solid ${w(0.08)}`,
                      }}
                    />
                  )}

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      title={nameOf(row)}
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {nameOf(row)}
                    </span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 2,
                        fontSize: 11.5,
                        color: found?.name ? t(0.55) : t(0.35),
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {/* What it found, which is the only reason to come back
                          to a row — the title is the video, not the answer. */}
                      {found?.name
                        ? `${found.name}${
                            found.url
                              ? ` · ${found.url.replace(/^https?:\/\//, "")}`
                              : ""
                          }`
                        : "Fetched, not read yet"}
                    </span>
                  </span>

                  {row.research?.ideas.length ? (
                    <Chip mono>{row.research.ideas.length} IDEAS</Chip>
                  ) : null}

                  <span
                    style={{
                      flex: "none",
                      fontFamily: font.mono,
                      fontSize: 10.5,
                      color: t(0.32),
                    }}
                  >
                    {ago(row.researchedAt || row.createdAt)}
                  </span>

                  <IconButton
                    label={`Forget ${nameOf(row)}`}
                    variant="danger"
                    stopPropagation
                    onClick={() => forget(row)}
                  >
                    <TrashIcon size={12} stroke="currentColor" />
                  </IconButton>
                </Hov>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const panel = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  marginBottom: 14,
  padding: 18,
  borderRadius: 16,
  background: w(0.045),
  border: `1px solid ${w(0.08)}`,
  backdropFilter: "blur(30px) saturate(155%)",
};
