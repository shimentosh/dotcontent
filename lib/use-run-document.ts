"use client";

import { useEffect, useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import { latestRunFor, runToDoc, topicSlug } from "@/lib/run-doc";
import { getPack, type ApiPack } from "@/lib/packs-client";
import { getSource, type Source } from "@/lib/sources-client";
import { useRunWatch } from "@/lib/use-run-watch";

/**
 * The run a document page is about, resolved from either kind of address.
 *
 * `/runs/<id>` names a run; `/content/<topic>` names a topic and means its
 * latest run. Both end up here as the same five things — the run, the
 * template as the engine executes it, the topic behind it, the document the
 * page reads, and the reel the run was given — plus what is still to write.
 *
 * Lifted out of DocumentView, where it was the first hundred lines of a
 * nineteen-hundred-line screen and where the page's one real bug lived: the
 * store's once-loaded list was consulted before the polled copy, so the poll
 * ran and nothing it fetched was ever drawn. That rule is now in one place,
 * with the reason beside it.
 */
export function useRunDocument({
  slug,
  runId,
}: {
  slug?: string;
  runId?: string;
}) {
  const { seriesList, runs, packs } = useStore();

  /*
   * Which run to follow.
   *
   * The URL when it names one; otherwise the topic's latest, worked out from
   * the store's list rather than from `run` below — `run` is built from what
   * the watcher fetches, so asking it here would be circular. A topic opened
   * by name has to be watched too: it sat perfectly still while its run was
   * being written until somebody noticed.
   */
  const watchId = useMemo(() => {
    if (runId) return runId;
    const mine = seriesList
      .flatMap((series) => series.topics)
      .find((x) => topicSlug(x.name) === slug);
    return mine ? (latestRunFor(runs, mine.id)?.id ?? null) : null;
  }, [runId, seriesList, slug, runs]);

  const { fetched, setFetched, serverWriting, setServerWriting } =
    useRunWatch(watchId);

  const run = useMemo(() => {
    /*
     * The polled copy wins.
     *
     * The store's list is loaded once and reloaded on navigation — never on a
     * timer. Reading it first rendered a snapshot taken when the page was
     * opened, while the poll kept a fresh copy in `fetched` that nothing
     * looked at: live updates that only arrived on a refresh. Whichever way
     * the page was addressed, if the fetched run IS this run, it is the truth.
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
        .find((t) =>
          runId ? t.id === run?.topicId : topicSlug(t.name) === slug,
        ),
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

  return {
    run,
    runtime,
    topic,
    doc,
    source,
    pending,
    unwritten,
    fetched,
    setFetched,
    serverWriting,
    setServerWriting,
  };
}
