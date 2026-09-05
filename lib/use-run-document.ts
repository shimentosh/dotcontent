"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import { latestRunFor, runToDoc, topicSlug } from "@/lib/run-doc";
import { getPack, type ApiPack } from "@/lib/packs-client";
import { getSource, type Source } from "@/lib/sources-client";
import { useRunWatch } from "@/lib/use-run-watch";
import type { AdvanceReport } from "@/lib/runs-client";

/**
 * Where one section's work actually is.
 *
 * Since the writing moved off the API process, "queued" covers four situations
 * a person would act on completely differently: nobody has asked for it yet;
 * it is on the queue and a machine is about to take it; it is on the queue
 * behind a machine that is switched off; or it can never run because nothing
 * on this estate has the tool. The row said QUEUED for all four.
 *
 * The two that matter most are the last two, and they are opposite answers:
 * "whisper is not installed on that machine" is an install command, and "that
 * machine has not been seen since Tuesday" is somebody opening their laptop.
 */
export type Placement =
  | { kind: "done" }
  /** Nothing has been asked for. The answer is a button. */
  | { kind: "idle" }
  /** Waiting on a section that has to be written first. */
  | { kind: "blocked"; on: string[] }
  /** On the queue, with machines awake to take it. */
  | { kind: "queued" }
  /** On the queue behind a machine that has not been seen recently. */
  | { kind: "waiting"; machine: string }
  /** A machine is holding it. `machine` is "" — see the note below. */
  | { kind: "writing"; machine: string }
  /** No machine anywhere advertises the tool. `message` says which, and how. */
  | { kind: "unroutable"; message: string }
  | { kind: "failed"; message: string };

/**
 * The sentence `advance` writes for a section nothing can run.
 *
 * Matched on rather than carried as a flag because the section row has no
 * field for it: the job knows it is `unroutable`, and `run_sections` only has
 * `failed` plus this text. `jobsForRun` holds the distinction properly, and
 * nothing exposes it over HTTP — see the note in DocumentView.
 */
const NO_MACHINE = /^No machine here has /;

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

  const {
    fetched,
    setFetched,
    serverWriting,
    setServerWriting,
    waitingForMachine,
  } = useRunWatch(watchId);

  /*
   * The last thing the server said about routing, kept.
   *
   * `POST /runs/:id/start` answers with which sections were queued, which are
   * waiting on a named machine, and which nothing can run. That is the ONLY
   * place a machine's name reaches the browser — the run row records
   * `wroteWith` when a section finishes and nothing at all while it is being
   * written — so the answer is held here until the sections it describes move
   * on, rather than being read once and dropped.
   */
  /*
   * Kept WITH the run it describes, rather than cleared when that changes.
   *
   * A routing answer belongs to the run it was asked about — carrying one
   * across a navigation would name a machine at the wrong document — but
   * clearing it in an effect keyed on `watchId` means one render where the old
   * report is still on screen under the new run's sections. Storing the id
   * alongside makes the answer simply not match, which is true from the first
   * render rather than the second.
   */
  const [held, setHeld] = useState<{ runId: string; report: AdvanceReport } | null>(null);
  const noteAdvance = useCallback(
    (r: AdvanceReport | null) => setHeld(r && watchId ? { runId: watchId, report: r } : null),
    [watchId],
  );
  const report = held?.runId === watchId ? held.report : null;

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

  /*
   * Where each section's work is, as one lookup the page can read per row.
   *
   * Built from three sources because no single one has the whole picture: the
   * run's own rows (state and error), whether the queue holds anything for
   * this run at all, and the routing report from the last start. A section is
   * `writing` on the row from the moment its job exists, so "a machine is
   * holding it" is really "a job exists and something is moving" — the run
   * having live jobs with NO section writing is the tell for a queue nothing
   * has claimed.
   */
  const placements = useMemo(() => {
    const out = new Map<string, Placement>();
    if (!run) return out;

    const done = new Set(
      run.sections.filter((x) => x.state === "done").map((x) => x.id),
    );
    const ready = new Set(pending);
    const asleep = new Map(
      (report?.waiting ?? []).map((x) => [x.sectionId, x.machine]),
    );
    const titleOf = (id: string) =>
      run.sections.find((x) => x.id === id)?.title ?? id;

    for (const row of run.sections) {
      if (row.state === "done") {
        out.set(row.id, { kind: "done" });
        continue;
      }
      if (row.state === "failed") {
        out.set(
          row.id,
          NO_MACHINE.test(row.error)
            ? { kind: "unroutable", message: row.error }
            : { kind: "failed", message: row.error || "It did not say why." },
        );
        continue;
      }
      if (row.state === "writing") {
        // No name available: the machine is on the job, and the job is not
        // exposed. `wroteWith` fills this in once the text lands.
        out.set(row.id, { kind: "writing", machine: "" });
        continue;
      }

      // Queued, which is the word that hid four different situations.
      const deps = runtime?.sections.find((d) => d.id === row.id)?.dependsOn ?? [];
      const missing = deps.filter((d) => !done.has(d));
      if (missing.length) {
        out.set(row.id, { kind: "blocked", on: missing.map(titleOf) });
        continue;
      }
      const machine = asleep.get(row.id);
      if (machine) {
        out.set(row.id, { kind: "waiting", machine });
        continue;
      }
      if (serverWriting && ready.has(row.id)) {
        out.set(
          row.id,
          waitingForMachine ? { kind: "waiting", machine: "" } : { kind: "queued" },
        );
        continue;
      }
      out.set(row.id, { kind: "idle" });
    }
    return out;
  }, [run, runtime, pending, report, serverWriting, waitingForMachine]);

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
    waitingForMachine,
    placements,
    noteAdvance,
  };
}
