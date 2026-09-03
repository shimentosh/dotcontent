"use client";

import { useEffect, useRef, useState } from "react";

import { QUALITIES } from "@/lib/data";
import { PACKS } from "@/lib/packs/enbn-website";
import { startTopicRun } from "@/lib/start-run";
import { fetchSource, frameUrl, type Source } from "@/lib/sources-client";
import { useStore } from "@/lib/store";
import { themesOf } from "@/lib/topics";
import { font, ghost, ghostHover, layer, primary, primaryActive, primaryHover, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Popover } from "@/components/ui/Popover";
import { ChevronDown, PlayIcon } from "@/components/ui/Icons";

export function RunSetupSheet() {
  const {
    runSetupOpen,
    closeRunSetup,
    quality,
    setQuality,
    go,
    project,
    projectsLoaded,
    seriesList,
    runTopicName,
    setRunTopicName,
  } = useStore();

  /*
   * The topic this run is for.
   *
   * It looked like a select — a bordered field with a chevron — and opened
   * nothing, so the one input that decides what the pack is about was the one
   * thing you could not set. The list is the workspace's real topics, flattened
   * out of their series.
   */
  /*
   * Which pack this run goes through.
   *
   * The sheet used to offer the pack's sections as eight toggle chips — Topic
   * Brief, Three Prompts, Bangla Script and so on — which quietly contradicts
   * what a pack is. A pack is "a reusable brief that produces everything": if
   * you are ticking its sections off one at a time before every run, the pack
   * is not the unit of work, and the next run's output is not comparable to the
   * last one's. Pick the pack; the pack decides what it writes.
   */
  const packRef = useRef<HTMLDivElement>(null);
  const [packOpen, setPackOpen] = useState(false);
  /*
   * The packs that can actually run.
   *
   * This listed the design canvas's pack names, which are labels with nothing
   * behind them — picking one and pressing Run reached the API with a slug it
   * had never heard of. A picker should only offer what exists.
   */
  const [pack, setPack] = useState(PACKS[0]?.slug ?? "");

  useEffect(() => {
    if (!packOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="run-template"]')) ||
        Boolean(packRef.current?.contains(target));
      if (!inside) setPackOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [packOpen]);

  const chosenPack = PACKS.find((x) => x.slug === pack);

  const topicRef = useRef<HTMLDivElement>(null);
  const [topicOpen, setTopicOpen] = useState(false);
  // Held in the store, not here: a run started from a topic row has to open on
  // that topic, and this sheet is the only place it can be changed.
  const setTopic = setRunTopicName;

  /*
   * A topic brings its series and its part number with it.
   *
   * Those are two of the pack's four required inputs, and they already exist —
   * asking for them again in this sheet would be asking you to retype what the
   * series counter has been tracking all along.
   */
  const allTopics = seriesList.flatMap((c) =>
    c.topics.map((x) => ({
      id: x.id,
      name: x.name,
      group: c.name,
      part: x.part,
      // The shelf's word for its numbers, carried down to the topic so the
      // run can be told "Episode 07" without looking the series up again.
      partLabel: c.partLabel,
      // The shelf's brief, whichever tab it is on — typed themes or the
      // headlines a feed was read for. Same shape either way.
      seriesContext: themesOf(c).join("\n"),
      context: x.context,
    })),
  );

  /*
   * What this run is for.
   *
   * Whatever opened the sheet said so, or — opened cold from the header —
   * the first topic there is. It used to fall back to the literal string
   * "AI Agents", a name out of the original sample data: on a workspace
   * without it the sheet opened on a topic that did not exist, and on one
   * with it, opening the sheet from any other topic silently ran the wrong
   * one.
   */
  const topic = runTopicName ?? allTopics[0]?.name ?? "";

  const chosenTopic = allTopics.find((x) => x.name === topic);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  /*
   * The source reel.
   *
   * The template's first two sections are written for someone who has watched the
   * video — they ask for on-screen text, an address bar, a domain said out
   * loud. Fetching it here means the run is handed a transcript and stills
   * instead of being asked to look at something that was never downloaded.
   */
  const [sourceUrl, setSourceUrl] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [fetching, setFetching] = useState(false);
  const [sourceError, setSourceError] = useState("");

  /*
   * Nothing is written against a workspace the server has not confirmed.
   *
   * The store opens on sample workspaces with empty ids until the first
   * request answers. A run or a download in that window would go out with
   * workspaceId "" and come back as a foreign-key error — reported as
   * "something went wrong", on a button that looked ready.
   */
  const ready = projectsLoaded && Boolean(project.id);

  const pullSource = async () => {
    const url = sourceUrl.trim();
    if (!url || fetching) return;
    if (!ready) {
      setSourceError("Still loading the workspace — try again in a second.");
      return;
    }
    setFetching(true);
    setSourceError("");
    try {
      setSource(await fetchSource({ url, workspaceId: project.id }));
    } catch (e) {
      setSource(null);
      setSourceError(
        e instanceof Error ? e.message : "Could not fetch that link",
      );
    } finally {
      setFetching(false);
    }
  };

  /**
   * Start a real run.
   *
   * The sheet used to call the simulation, which walked a fixed list on a
   * timer. This creates a run on the server and hands you to the page that
   * drives it; nothing is written until that page asks for the first section.
   */
  const start = async () => {
    if (starting) return;
    if (!ready) {
      setStartError("Still loading the workspace — try again in a second.");
      return;
    }
    setStarting(true);
    setStartError("");
    try {
      /*
       * Run means run.
       *
       * `startTopicRun` creates the run and sets the server writing in one
       * breath — this used to land on a page of twelve QUEUED rows waiting
       * for a second press, and nobody presses Run to make a list. It is the
       * same call the row on the content list makes, so a run started from
       * either place is told exactly the same things about its topic.
       */
      const run = await startTopicRun({
        workspaceId: project.id,
        workspaceName: project.name,
        packSlug: pack,
        sourceId: source?.id ?? null,
        topic: {
          // A run can be pointed at a URL with no topic behind it; the id is
          // what makes it one topic's content rather than a loose document.
          id: chosenTopic?.id ?? "",
          name: topic,
          part: chosenTopic?.part ?? null,
          partLabel: chosenTopic?.partLabel ?? "",
          context: chosenTopic?.context ?? "",
          seriesName: chosenTopic?.group ?? "",
          seriesContext: chosenTopic?.seriesContext ?? "",
        },
      });
      closeRunSetup();
      go(`/runs/${run.id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Could not start the run");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!topicOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="run-topic"]')) ||
        Boolean(topicRef.current?.contains(target));
      if (!inside) setTopicOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [topicOpen]);

  if (!runSetupOpen) return null;

  return (
    <Hov
      interactive={false}
      onClick={closeRunSetup}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: layer.sheet,
        background: "rgba(4,4,8,0.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "grid",
        placeItems: "center",
        padding: 30,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Run template"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 22,
          background: "rgba(26,26,32,0.72)",
          backdropFilter: "blur(50px) saturate(155%)",
          WebkitBackdropFilter: "blur(50px) saturate(155%)",
          border: `1px solid ${w(0.13)}`,
          boxShadow: `0 40px 90px rgba(0,0,0,0.6), inset 0 1px 0 ${w(0.12)}`,
          overflow: "hidden",
          animation: "os-pop 180ms ease-out",
        }}
      >
        <div style={{ padding: "20px 22px 0" }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: "0.14em",
              color: t(0.42),
            }}
          >
            RUN TEMPLATE
          </div>
          <h2
            style={{
              fontFamily: font.tight,
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: "-0.022em",
              margin: "6px 0 18px",
            }}
          >
            {/* The template that is about to run — it used to be the name of
                one from the sample data, printed regardless of what was
                selected two fields below it. */}
            {chosenPack?.name ?? "Pick a template"}
          </h2>
        </div>

        <div style={{ padding: "0 22px 18px" }}>
          <div style={{ fontSize: 11.5, color: t(0.42), marginBottom: 7 }}>
            Topic
          </div>
          <div
            ref={topicRef}
            style={{ position: "relative", marginBottom: 18 }}
          >
            <Hov
              aria-haspopup="listbox"
              aria-expanded={topicOpen}
              onClick={() => setTopicOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                height: 38,
                padding: "0 12px",
                borderRadius: 11,
                background: "rgba(0,0,0,0.32)",
                border: `1px solid ${topicOpen ? w(0.2) : w(0.1)}`,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
              hover={{ borderColor: w(0.2) }}
            >
              <span>{topic}</span>
              <ChevronDown
                size={12}
                stroke={t(0.5)}
                style={{
                  marginLeft: "auto",
                  transform: topicOpen ? "rotate(180deg)" : "none",
                  transition: "transform 160ms",
                }}
              />
            </Hov>

            <Popover
              anchorRef={topicRef}
              open={topicOpen}
              width="anchor"
              data-menu="run-topic"
              // Only what differs from the Popover's own panel: above the run
              // sheet rather than the page, and scrollable when the list is long.
              style={{ maxHeight: 260, overflowY: "auto" }}
            >
              {allTopics.length === 0 ? (
                <div
                  style={{ padding: "10px 10px", fontSize: 12, color: t(0.45) }}
                >
                  No topics in this workspace yet.
                </div>
              ) : (
                allTopics.map((x) => (
                  <Hov
                    key={`${x.group}-${x.name}`}
                    role="option"
                    aria-selected={x.name === topic}
                    onClick={() => {
                      setTopic(x.name);
                      setTopicOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 32,
                      padding: "5px 10px",
                      borderRadius: 9,
                      fontSize: 12.5,
                      cursor: "pointer",
                      color: x.name === topic ? "#f0f0f4" : t(0.75),
                      background: x.name === topic ? w(0.09) : "transparent",
                    }}
                    hover={{ background: w(0.09), color: "#f0f0f4" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>{x.name}</span>
                    {/* Which shelf it came off — two series can hold a
                        topic of the same name, and the list is flat. */}
                    <span
                      style={{ flex: "none", fontSize: 10.5, color: t(0.34) }}
                    >
                      {x.group}
                    </span>
                  </Hov>
                ))
              )}
            </Popover>
          </div>

          <div style={{ fontSize: 11.5, color: t(0.42), marginBottom: 7 }}>
            Template
          </div>
          <div ref={packRef} style={{ position: "relative", marginBottom: 18 }}>
            <Hov
              aria-haspopup="listbox"
              aria-expanded={packOpen}
              onClick={() => setPackOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                height: 38,
                padding: "0 12px",
                borderRadius: 11,
                background: "rgba(0,0,0,0.32)",
                border: `1px solid ${packOpen ? w(0.2) : w(0.1)}`,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
              hover={{ borderColor: w(0.2) }}
            >
              <span
                style={{
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {chosenPack?.name ?? pack}
              </span>
              {/* What the pack will write, as a count rather than a checklist —
                  the number is the useful part, the list was the problem. */}
              {chosenPack ? (
                <span
                  style={{
                    flex: "none",
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    color: t(0.4),
                  }}
                >
                  {chosenPack.sections.length} sections
                </span>
              ) : null}
              <ChevronDown
                size={12}
                stroke={t(0.5)}
                style={{
                  marginLeft: "auto",
                  transform: packOpen ? "rotate(180deg)" : "none",
                  transition: "transform 160ms",
                }}
              />
            </Hov>

            <Popover
              anchorRef={packRef}
              open={packOpen}
              width="anchor"
              data-menu="run-template"
              // Only what differs from the Popover's own panel: above the run
              // sheet rather than the page, and scrollable when the list is long.
              style={{ maxHeight: 260, overflowY: "auto" }}
            >
              {PACKS.map((x) => (
                <Hov
                  key={x.slug}
                  role="option"
                  aria-selected={x.slug === pack}
                  onClick={() => {
                    setPack(x.slug);
                    setPackOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    minHeight: 34,
                    padding: "6px 10px",
                    borderRadius: 9,
                    fontSize: 12.5,
                    cursor: "pointer",
                    color: x.slug === pack ? "#f0f0f4" : t(0.75),
                    background: x.slug === pack ? w(0.09) : "transparent",
                  }}
                  hover={{ background: w(0.09), color: "#f0f0f4" }}
                >
                  <span
                    style={{
                      flex: "none",
                      fontFamily: font.mono,
                      fontSize: 10.5,
                      color: t(0.4),
                    }}
                  >
                    {String(x.sections.length).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {x.name}
                  </span>
                  <span
                    style={{
                      flex: "none",
                      fontFamily: font.mono,
                      fontSize: 10.5,
                      color: t(0.34),
                    }}
                  >
                    {x.version ? `v${x.version}` : ""}
                  </span>
                </Hov>
              ))}
            </Popover>
          </div>

          {/*
            Optional, and said so. Most runs are a website URL typed as the
            topic; this is for the other kind, where the source is a reel and
            the site has to be worked out from what it shows.
          */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 7,
            }}
          >
            <span style={{ fontSize: 11.5, color: t(0.42) }}>Source video</span>
            <span style={{ fontSize: 11, color: t(0.3) }}>optional</span>
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 8 }}>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void pullSource();
              }}
              placeholder="Paste a reel or short — yt-dlp pulls it down"
              aria-label="Source video URL"
              style={{
                flex: 1,
                minWidth: 0,
                height: 36,
                padding: "0 12px",
                borderRadius: 11,
                background: "rgba(0,0,0,0.32)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: w(0.1),
                outline: "none",
                color: "#f0f0f4",
                fontSize: 12.5,
              }}
            />
            <Hov
              as="span"
              onClick={() => void pullSource()}
              style={{
                flex: "none",
                display: "grid",
                placeItems: "center",
                height: 36,
                padding: "0 14px",
                borderRadius: 11,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                opacity: sourceUrl.trim() && !fetching ? 1 : 0.45,
                background: w(0.08),
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: w(0.1),
              }}
              hover={{ background: w(0.14) }}
            >
              {fetching ? "Fetching…" : "Fetch"}
            </Hov>
          </div>

          {fetching ? (
            <div style={{ fontSize: 11.5, color: t(0.42), marginBottom: 16 }}>
              Downloading, cutting stills and transcribing. This takes a minute
              or two — leave the sheet open.
            </div>
          ) : null}

          {sourceError ? (
            <div
              role="alert"
              style={{
                marginBottom: 16,
                padding: "9px 11px",
                borderRadius: 10,
                fontSize: 11.5,
                background: "rgba(198,74,74,0.12)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "rgba(198,74,74,0.3)",
                color: "#e08585",
                textWrap: "pretty",
              }}
            >
              {sourceError}
            </div>
          ) : null}

          {source && !fetching ? (
            <div
              style={{
                marginBottom: 16,
                padding: "11px 12px",
                borderRadius: 12,
                background: w(0.05),
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: w(0.09),
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {source.title || source.url}
              </div>
              <div style={{ marginTop: 3, fontSize: 11.5, color: t(0.45) }}>
                {[
                  source.uploader,
                  source.duration ? `${source.duration}s` : "",
                  source.frames.length
                    ? `${source.frames.length} stills`
                    : "no stills",
                  source.transcript ? "transcript" : "no transcript",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {/* The stills, small. Seeing them is how you know the download
                  worked before spending ten minutes of model time on it. */}
              {source.frames.length ? (
                <div
                  style={{
                    marginTop: 9,
                    display: "flex",
                    gap: 5,
                    overflowX: "auto",
                  }}
                >
                  {source.frames.map((f) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={f.file}
                      src={frameUrl(source.id, f.file)}
                      alt={`Frame at ${f.at} seconds`}
                      style={{
                        flex: "none",
                        height: 54,
                        borderRadius: 6,
                        border: `1px solid ${w(0.1)}`,
                      }}
                    />
                  ))}
                </div>
              ) : null}
              {source.error ? (
                <div style={{ marginTop: 8, fontSize: 11, color: "#e0a83c" }}>
                  {source.error}
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ fontSize: 11.5, color: t(0.42), marginBottom: 7 }}>
            Quality
          </div>
          <div
            style={{
              display: "flex",
              gap: 3,
              padding: 3,
              borderRadius: 11,
              background: "rgba(0,0,0,0.32)",
              border: `1px solid ${w(0.08)}`,
            }}
          >
            {QUALITIES.map((q) => (
              <Hov
                key={q}
                onClick={() => setQuality(q)}
                aria-pressed={quality === q}
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: 7,
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: quality === q ? w(0.12) : "transparent",
                  color: quality === q ? "#f0f0f4" : t(0.5),
                }}
              >
                {q}
              </Hov>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              padding: "11px 13px",
              borderRadius: 11,
              background: w(0.04),
              border: `1px solid ${w(0.07)}`,
              fontSize: 11.5,
              color: t(0.48),
              lineHeight: 1.55,
            }}
          >
            Context: <strong style={{ color: t(0.8) }}>Workspace</strong> ·{" "}
            <strong style={{ color: t(0.8) }}>Topic</strong> ·{" "}
            <strong style={{ color: t(0.8) }}>Template</strong> — 12.4K tokens
          </div>
        </div>

        {/* Starting a run can fail before anything is written — no CLI, a
            missing input. Saying so here beats a button that does nothing. */}
        {startError ? (
          <div
            style={{
              margin: "0 22px 14px",
              padding: "9px 12px",
              borderRadius: 11,
              fontSize: 12,
              color: "#d1656b",
              background: "rgba(209,101,107,0.1)",
              border: "1px solid rgba(209,101,107,0.24)",
            }}
          >
            {startError}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "14px 22px",
            borderTop: `1px solid ${w(0.09)}`,
            background: "rgba(0,0,0,0.24)",
          }}
        >
          <Hov
            as="span"
            onClick={closeRunSetup}
            style={{
              height: 34,
              padding: "0 14px",
              display: "grid",
              placeItems: "center",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              ...ghost,
            }}
            hover={ghostHover}
          >
            Cancel
          </Hov>
          <Hov
            as="span"
            onClick={start}
            aria-disabled={!ready || undefined}
            style={{
              marginLeft: "auto",
              height: 34,
              padding: "0 20px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              opacity: ready ? 1 : 0.55,
              ...primary,
            }}
            hover={primaryHover}
            active={primaryActive}
          >
            <PlayIcon size={12} />
            <span>Run</span>
          </Hov>
        </div>
      </div>
    </Hov>
  );
}
