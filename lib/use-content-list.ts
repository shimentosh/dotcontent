"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  USAGE,
  USAGE_ORDER,
  docsByPack,
  slugify,
  type ContentDoc,
  type UsageStatus,
} from "@/lib/content-docs";
import { statusOf, useDecisions } from "@/lib/decisions";
import { useStore } from "@/lib/store";
import { partName } from "@/lib/topics";
import { listRuns, startWriting, type Run } from "@/lib/runs-client";
import { runToDoc } from "@/lib/run-doc";

/**
 * Everything the Content list knows, minus how it looks.
 *
 * Lifted out of ContentGroupsView, which was eighteen hundred lines of data
 * logic and layout in one file. The split is on what can be reasoned about
 * without a screen: which rows exist, which are shown, in what order, what the
 * facets count, what is being written right now. The view keeps what only a
 * view has — which menu is open, which row is being edited, the rails made of
 * glyphs.
 *
 * The rules in here are the ones that went wrong quietly: a topic and its run
 * appearing twice, counts that lied when a filter was on, "most recent" that
 * returned 0 and leaned on build order. Each is commented where it lives.
 */

export type SortKey = "recent" | "topic" | "status";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Most recent" },
  { key: "topic", label: "Topic A–Z" },
  // "Least finished" went with the SECTIONS column: it ordered the list by a
  // number that is no longer on screen, so the rows moved and nothing visible
  // explained why. Content first, ideas last — the split "most recent" does
  // not make.
  { key: "status", label: "Finished first" },
];

export type FilterKey = "status" | "template" | "series";

/** One value a facet offers — the same shape the FilterMenu draws. */
export type FacetOption = {
  value: string;
  label: string;
  /** How many rows would still be here if this value were picked. */
  count: number;
  /** Optional swatch, used by the status filter. */
  dot?: string;
};

/**
 * The status switcher's fixed segments: the lifecycle stages a topic is
 * always in one of. Used and Ignored join the row only once a topic carries
 * one — a permanent tab for a status nothing has yet is a dead segment.
 *
 * Writing is not one of them. A run in flight is not a shelf you browse — it
 * is a thing happening right now, and it has its own strip at the top of the
 * page, always on, whichever status you are reading.
 */
export const STATUS_TABS: UsageStatus[] = ["idea", "ready"];

/** The "every one" value for the series and template tabs. */
export const ALL = "";

/** Where a row opens: the run that made it, or the document it is. */
export const hrefFor = (doc: ContentDoc) =>
  doc.runId ? `/runs/${doc.runId}` : `/content/${doc.slug}`;

export function useContentList() {
  const { seriesList, packs, reloadRuns } = useStore();

  /*
   * What has actually been written.
   *
   * Real runs off the server, with real text behind every section. Fetched
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
  const retry = useCallback(
    async (runId: string) => {
      try {
        await startWriting(runId);
      } catch {
        // The row keeps saying Failed, which is still true. Nothing else to say.
      }
      await listRuns()
        .then(setRuns)
        .catch(() => {});
      void reloadRuns();
    },
    [reloadRuns],
  );

  // Re-renders the list whenever a status is changed anywhere.
  const version = useDecisions();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
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

  /*
   * The series and template tabs run off the filters rather than a second
   * piece of state, so picking one narrows the list the same way the menu
   * used to and the counts on the other facets stay honest.
   */
  const seriesTab = filters.series[0] ?? ALL;
  const pickSeries = (id: string) =>
    setFilters((prev) => ({ ...prev, series: id === ALL ? [] : [id] }));

  const templateTab = filters.template[0] ?? ALL;
  const pickTemplate = (value: string) =>
    setFilters((prev) => ({
      ...prev,
      template: value === ALL ? [] : [value],
    }));

  /**
   * Every topic in this workspace, plus what has actually been written.
   *
   * A topic with no run gets a row with no sections, which `statusOf` reads
   * as "idea": the first step of the same lifecycle that ends in used or
   * ignored. Real runs go in front, newest first, because the thing you just
   * made is the thing you came to look at.
   */
  const DOCS = useMemo(() => {
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
          part:
            topic.part !== null ? partName(series.partLabel, topic.part) : "",
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
    ): FacetOption[] =>
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

    const packNames = [...new Set(DOCS.map((d) => d.pack))].sort();
    const seriesIds = [...new Set(DOCS.map((d) => d.seriesId ?? ""))];

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
          // Status first, then recency inside it. Without the second key, rows
          // sharing a status fell back to build order and moved for reasons
          // nothing on screen explained.
          return (
            rank[statusOf(a)] - rank[statusOf(b)] || b.at.localeCompare(a.at)
          );
        default:
          // Most recent, actually sorted. This used to return 0 and lean on
          // the order DOCS builds. `at` is an ISO instant and sorts as a
          // string; a tie falls back to the name so equal timestamps give a
          // stable order rather than one that reshuffles on every render.
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
        template: facet(forPack, (d) => d.pack, packNames, filters.template, (v) => v),
        series: facet(
          forSeries,
          (d) => d.seriesId ?? "",
          seriesIds,
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
   * The switcher's segments: the fixed stages, plus any end state a topic has
   * actually reached. Mark one Used and a USED segment appears — which is the
   * only way back to it, so it has to.
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
          // saying the same thing. It comes back only if it is the segment you
          // are standing on, because otherwise there would be no way off it.
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
        // Carried rather than rebuilt from the slug: a row that came from a
        // run has the RUN's id as its slug, and `/content/run_…` is a 404.
        href: hrefFor(d),
        written: d.sections.filter((x) => x.state === "written").length,
        total: d.sections.length,
      })),
    [DOCS],
  );

  const anyFilter = active.length > 0 || query.trim().length > 0;

  return {
    DOCS,
    groups,
    shown,
    options,
    active,
    anyFilter,
    statusTabs,
    writingNow,
    retry,

    query,
    setQuery,
    sort,
    setSort,
    filters,
    toggle,
    clear,
    clearAll,

    status,
    pickStatus,
    seriesTab,
    pickSeries,
    templateTab,
    pickTemplate,
  };
}
