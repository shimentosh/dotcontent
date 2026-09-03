"use client";

import { useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import { topicSlug } from "@/lib/run-doc";
import { partName } from "@/lib/topics";
import { font, t, w } from "@/lib/theme";
import { SeriesBrief, useTopicAdmin } from "@/components/topics/TopicAdmin";
import { CONTENT_TABS } from "@/components/views/content-tabs";
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  ListCell,
  ListHeader,
  ListPanel,
  ListRow,
  ListStat,
  Page,
  PageHeader,
  RowTile,
  TabNav,
  Toolbar,
} from "@/components/ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import {
  CaretDown,
  HashGlyph,
  MergeGlyph,
  StackGlyph,
  TopicGlyph,
} from "@/components/ui/DocIcons";
import { normalizeName } from "@/lib/dedupe";

/**
 * The series themselves, as rows you can edit.
 *
 * The content list treats a series as a tab — a way of narrowing what is on
 * screen — which is right for reading and wrong for everything else: it can
 * only ever show you the one you are standing on, so there was nowhere to
 * compare two shelves, reorder them, or take one down. Three store actions
 * existed for exactly that and had no caller.
 *
 * A row per shelf, and the row opens into what a shelf actually is: a name, a
 * brief, the template every topic on it runs through, and whether it numbers
 * its parts.
 */

const COLUMNS = "26px 1fr 156px 66px 74px 108px 100px";

/** "Powerful websites you know" → PW; "Business" → B. */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    // A short one-word name is more itself whole than cut to a letter.
    return words[0].length <= 2
      ? words[0].toUpperCase()
      : words[0][0].toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

const LABELS = ["", "SERIES", "TEMPLATE", "TOPICS", "WRITTEN", "NUMBERING", ""];

export function ManageSeriesView() {
  const {
    seriesList,
    runs,
    updateSeries,
    removeTopicSeries,
    mergeSeriesInto,
    moveTopicSeries,
    generateTopicsIn,
    deleteTopic,
    askConfirm,
    go,
  } = useStore();

  /** The series folded open. One at a time — this is a list, not a form. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [batch, setBatch] = useState("3");
  /** What the last merge did, said once, above the list. */
  const [mergeReport, setMergeReport] = useState("");
  const [customBatch, setCustomBatch] = useState("8");

  const admin = useTopicAdmin();

  /*
   * Which topics have produced something.
   *
   * From the runs rather than from a column on the topic: a run is the thing
   * that wrote the content, so counting runs is counting content. A topic
   * written twice still counts once — the question is "has this been done",
   * not "how many times".
   */
  const writtenTopics = useMemo(
    () => new Set(runs.map((r) => r.topicId).filter(Boolean) as string[]),
    [runs],
  );

  const totals = useMemo(() => {
    const topics = seriesList.reduce((n, s) => n + s.topics.length, 0);
    const written = seriesList.reduce(
      (n, s) => n + s.topics.filter((tp) => writtenTopics.has(tp.id)).length,
      0,
    );
    return { topics, written };
  }, [seriesList, writtenTopics]);

  /**
   * The other shelf each duplicate should fold into.
   *
   * The first one with a given name keeps it; the rest are offered a merge
   * into that one. Nothing merges on its own — this is somebody's content,
   * and which copy is the real one is theirs to say.
   */
  const mergeTarget = useMemo(() => {
    const first = new Map<string, { id: string; name: string }>();
    const into = new Map<string, { id: string; name: string }>();
    for (const series of seriesList) {
      const key = normalizeName(series.name);
      const held = first.get(key);
      if (held) into.set(series.id, held);
      else first.set(key, { id: series.id, name: series.name });
    }
    return into;
  }, [seriesList]);

  const askMerge = (from: { id: string; name: string; topics: number }) => {
    const target = mergeTarget.get(from.id);
    if (!target) return;
    askConfirm({
      title: `Merge into the other “${target.name}”?`,
      body:
        `Its ${from.topics} ${from.topics === 1 ? "topic moves" : "topics move"} across and this shelf goes. ` +
        "A topic whose subject is already there, with nothing written under it, is dropped; " +
        "one that has content moves anyway, so no written work is lost.",
      confirmLabel: "Merge",
      onConfirm: () => {
        void mergeSeriesInto(from.id, target.id)
          .then((r) => {
            setMergeReport(
              `${r.moved} moved into ${target.name}` +
                (r.dropped.length
                  ? ` · ${r.dropped.length} dropped as already covered`
                  : "") +
                (r.duplicatedWithContent.length
                  ? ` · ${r.duplicatedWithContent.length} moved with content despite the same name`
                  : ""),
            );
          })
          .catch((e: unknown) =>
            setMergeReport(e instanceof Error ? e.message : "The merge failed"),
          );
      },
    });
  };

  const askDelete = (id: string, name: string, count: number) => {
    const close = () => setOpenId((current) => (current === id ? null : current));

    /*
     * A shelf and the ideas on it are two different things to lose.
     *
     * With topics on it there are two honest answers, so the dialog offers
     * both rather than picking one: the shelf goes and the topics move to
     * Misc, or the whole lot goes. Empty, there is nothing to decide and
     * it stays the plain yes/no it was.
     */
    askConfirm({
      title: `Delete ${name}?`,
      body: count
        ? `Its ${count} ${count === 1 ? "topic" : "topics"} can move to Misc, or go with it. Content already written stays either way — runs outlive the topic that started them.`
        : "It has no topics on it, so nothing else goes with it.",
      confirmLabel: count ? "Delete topics too" : "Delete series",
      onConfirm: () => {
        removeTopicSeries(id);
        close();
      },
      alternative: count
        ? {
            label: "Keep the topics",
            onChoose: () => {
              removeTopicSeries(id, true);
              close();
            },
          }
        : undefined,
    });
  };

  const askDeleteTopic = (id: string, name: string) =>
    askConfirm({
      title: `Delete ${name}?`,
      body: "The topic goes. Anything already written from it stays on Content.",
      confirmLabel: "Delete topic",
      onConfirm: () => deleteTopic(id),
    });

  return (
    <Page>
      <PageHeader
        title="Series"
        blurb="A series is a shelf: a brief, the template its topics run through, and how it numbers its parts."
        actions={
          <Button
            variant="primary"
            size="md"
            icon={<PlusIcon size={12} stroke="currentColor" />}
            onClick={admin.openNewSeries}
          >
            New series
          </Button>
        }
      />

      <TabNav tabs={CONTENT_TABS} />

      <Toolbar>
        <span style={{ fontSize: 12, color: t(0.4) }}>
          {seriesList.length} {seriesList.length === 1 ? "series" : "series"} ·{" "}
          {totals.topics} {totals.topics === 1 ? "topic" : "topics"} ·{" "}
          {totals.written} written
          {mergeTarget.size ? (
            <>
              {" · "}
              <span style={{ color: "#c99a3f" }}>
                {mergeTarget.size} duplicate{mergeTarget.size === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
        </span>

        {/* Said once, after the fact, where the counts it changed are. */}
        {mergeReport ? (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#4bb07a" }}>
            {mergeReport}
          </span>
        ) : null}
      </Toolbar>

      <ListPanel>
        <ListHeader columns={COLUMNS} labels={LABELS} />

        {seriesList.map((series, i) => {
          const open = openId === series.id;
          const written = series.topics.filter((tp) =>
            writtenTopics.has(tp.id),
          ).length;

          return (
            <div key={series.id}>
              <ListRow
                columns={COLUMNS}
                onClick={() => setOpenId(open ? null : series.id)}
              >
                <CaretDown
                  size={11}
                  stroke={t(open ? 0.7 : 0.32)}
                  style={{
                    transform: open ? "none" : "rotate(-90deg)",
                    transition: "transform 180ms ease",
                  }}
                />

                <ListCell
                  icon={
                    <RowTile bg={series.pack ? "rgba(0,87,252,0.16)" : undefined}>
                      {/*
                        The shelf's initials, not a shelf glyph.

                        Every row carried the same StackGlyph, tinted by
                        whether a template was attached — which the TEMPLATE
                        column says in words two columns later. Six identical
                        tiles give the eye nothing to come back to; the
                        initials do, and the tint keeps saying what it said.
                      */}
                      <span
                        style={{
                          color: series.pack ? "#8ab4ff" : t(0.45),
                          fontWeight: 600,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {initials(series.name)}
                      </span>
                    </RowTile>
                  }
                  title={series.name}
                  after={
                    mergeTarget.has(series.id) ? (
                      <Chip tone="warn">Duplicate name</Chip>
                    ) : null
                  }
                  subtitle={
                    series.context.trim()
                      ? series.context.trim().split("\n")[0]
                      : "No brief yet — open it to say what this shelf is about"
                  }
                />

                <Chip
                  tone={series.pack ? "accent" : "mute"}
                  icon={<StackGlyph size={11} stroke="currentColor" />}
                >
                  {series.pack || "No template"}
                </Chip>

                <ListStat>{series.topics.length}</ListStat>
                <ListStat>{written}</ListStat>

                {series.numbered ? (
                  <Chip
                    tone="mute"
                    mono
                    icon={<HashGlyph size={11} stroke="currentColor" />}
                  >
                    next · {partName(series.partLabel, series.nextPart).toLowerCase()}
                  </Chip>
                ) : (
                  <span style={{ fontSize: 11.5, color: t(0.3) }}>
                    Not numbered
                  </span>
                )}

                <span
                  style={{ display: "flex", gap: 4, justifySelf: "end" }}
                >
                  {mergeTarget.has(series.id) ? (
                    <IconButton
                      label={`Merge ${series.name} into the other one`}
                      stopPropagation
                      onClick={() =>
                        askMerge({
                          id: series.id,
                          name: series.name,
                          topics: series.topics.length,
                        })
                      }
                    >
                      <MergeGlyph size={12} stroke="currentColor" />
                    </IconButton>
                  ) : null}
                  <IconButton
                    label={`Move ${series.name} up`}
                    stopPropagation
                    disabled={i === 0}
                    onClick={() => moveTopicSeries(series.id, -1)}
                  >
                    <ArrowUpIcon size={12} stroke="currentColor" />
                  </IconButton>
                  <IconButton
                    label={`Move ${series.name} down`}
                    stopPropagation
                    disabled={i === seriesList.length - 1}
                    onClick={() => moveTopicSeries(series.id, 1)}
                  >
                    <ArrowDownIcon size={12} stroke="currentColor" />
                  </IconButton>
                  <IconButton
                    label={`Delete ${series.name}`}
                    variant="danger"
                    stopPropagation
                    onClick={() =>
                      askDelete(series.id, series.name, series.topics.length)
                    }
                  >
                    <TrashIcon size={12} stroke="currentColor" />
                  </IconButton>
                </span>
              </ListRow>

              {open ? (
                <div
                  style={{
                    padding: "14px 18px 20px",
                    borderTop: `1px solid ${w(0.04)}`,
                    background: "rgba(0,0,0,0.14)",
                  }}
                >
                  {/* The name is the first field of the brief now. On its own
                      row it took a whole row to hold one 420px box, and every
                      screen of this panel already had space to spare. */}
                  <SeriesBrief
                    renamable
                    series={series}
                    batch={batch}
                    setBatch={setBatch}
                    customBatch={customBatch}
                    setCustomBatch={setCustomBatch}
                    onPatch={(patch) => updateSeries(series.id, patch)}
                    onGenerate={(count) => generateTopicsIn(series.id, count)}
                  />

                  <TopicList
                    series={series}
                    written={writtenTopics}
                    onOpen={(slug) => go(`/content/${slug}`)}
                    onEdit={(topic) =>
                      admin.openEditTopic(
                        {
                          id: topic.id,
                          name: topic.name,
                          status: topic.status,
                          context: topic.context,
                        },
                        series.id,
                      )
                    }
                    onDelete={askDeleteTopic}
                    onAdd={() => admin.openNewTopic(series.id)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}

        {seriesList.length === 0 ? (
          <EmptyState
            icon={<StackGlyph size={20} stroke={t(0.4)} />}
            title="No series yet"
            line="A series is where topics live. Make one, give it a brief, and point it at a template."
            action={
              <Button variant="primary" size="md" onClick={admin.openNewSeries}>
                New series
              </Button>
            }
          />
        ) : null}
      </ListPanel>

      {admin.dialogs}
    </Page>
  );
}

/**
 * The topics standing on one shelf.
 *
 * Here rather than on Content because this is the only screen that shows a
 * series as a thing rather than as a filter — and because renaming a topic had
 * no way in at all: the dialog for it was built, returned by the hook, and
 * never opened by anything.
 */
function TopicList({
  series,
  written,
  onOpen,
  onEdit,
  onDelete,
  onAdd,
}: {
  series: {
    id: string;
    name: string;
    partLabel: string;
    topics: {
      id: string;
      name: string;
      part: number | null;
      context: string;
      status: "idea" | "generating" | "done";
    }[];
  };
  written: Set<string>;
  onOpen: (slug: string) => void;
  onEdit: (topic: {
    id: string;
    name: string;
    part: number | null;
    context: string;
    status: "idea" | "generating" | "done";
  }) => void;
  onDelete: (id: string, name: string) => void;
  onAdd: () => void;
}) {
  return (
    <div style={{ marginTop: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 9,
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            color: t(0.42),
          }}
        >
          TOPICS ON THIS SHELF
        </span>
        <span style={{ flex: 1, height: 1, background: w(0.055) }} />
        <Button
          size="sm"
          icon={<PlusIcon size={11} stroke="currentColor" />}
          onClick={onAdd}
        >
          Add topic
        </Button>
      </div>

      {series.topics.length === 0 ? (
        <div style={{ fontSize: 12, color: t(0.35), padding: "4px 2px" }}>
          Nothing on it yet. Add one by hand, or generate from the brief above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {series.topics.map((topic, i) => (
            <div
              key={topic.id}
              style={{
                display: "grid",
                gridTemplateColumns: "20px 1fr 72px 66px",
                alignItems: "center",
                gap: 10,
                padding: "6px 8px",
                borderRadius: 8,
                background: i % 2 ? "transparent" : w(0.025),
              }}
            >
              <TopicGlyph
                size={12}
                stroke={written.has(topic.id) ? "#4bb07a" : t(0.3)}
              />

              <button
                type="button"
                onClick={() => onOpen(topicSlug(topic.name))}
                style={{
                  justifySelf: "start",
                  maxWidth: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                  fontSize: 12.5,
                  color: t(0.78),
                  cursor: "pointer",
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {topic.name}
              </button>

              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  color: t(0.3),
                }}
              >
                {partName(series.partLabel, topic.part).toLowerCase()}
              </span>

              <span style={{ display: "flex", gap: 4, justifySelf: "end" }}>
                <IconButton
                  label={`Rename ${topic.name}`}
                  size={24}
                  onClick={() => onEdit(topic)}
                >
                  <PencilIcon size={11} stroke="currentColor" />
                </IconButton>
                <IconButton
                  label={`Delete ${topic.name}`}
                  size={24}
                  variant="danger"
                  onClick={() => onDelete(topic.id, topic.name)}
                >
                  <TrashIcon size={11} stroke="currentColor" />
                </IconButton>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
