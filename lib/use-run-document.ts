"use client";

import { useEffect, useMemo, useState } from "react";

import { useStore } from "@/lib/store";
import { latestRunFor, runToDoc, topicSlug } from "@/lib/run-doc";
import { getPack, type ApiPack } from "@/lib/packs-client";
import { getSource, type Source } from "@/lib/sources-client";
import { useRunWatch } from "@/lib/use-run-watch";
import type { RunJob } from "@/lib/runs-client";

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
  /**
   * On the queue behind a machine that has not been seen recently.
   *
   * `machine` is its name when the job names one, `message` the server's own
   * sentence about the wait. Either can be empty; between them there is
   * normally something to say, and the page falls back to "nobody has picked
   * this up yet" when there is not.
   */
  | { kind: "waiting"; machine: string; message: string }
  /** A machine is holding it, and `machine` is which — see the note below. */
  | { kind: "writing"; machine: string }
  /** No machine anywhere advertises the tool. `message` says which, and how. */
  | { kind: "unroutable"; message: string }
  | { kind: "failed"; message: string };

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
    jobs,
    serverWriting,
    setServerWriting,
    waitingForMachine,
  } = useRunWatch(watchId);

  /*
   * The queue, per section.
   *
   * `jobsForRun` comes back oldest first, so the last entry for a section
   * wins — and the last one is the live one whenever there is a live one,
   * because `enqueue` converges on the existing queued-or-claimed job for a
   * section rather than inserting a second. So a section retried after a
   * failure reads from its retry, not from the failure it replaced.
   *
   * This is what a routing report retained from `POST :id/start` used to
   * stand in for, badly: that answer belonged to one press of one button in
   * one tab, so a machine's name appeared only for whoever pressed "Write the
   * rest", never for a colleague opening the same run, and never at all for a
   * single-section write. The queue is the same for everybody looking.
   */
  const jobBySection = useMemo(() => {
    const out = new Map<string, RunJob>();
    for (const job of jobs) if (job.sectionId) out.set(job.sectionId, job);
    return out;
  }, [jobs]);

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
   * Two sources, and they answer different halves. `run_sections` says what
   * has been written and what failed; the queue says where the work IS — which
   * machine has it, whether anything can ever take it, and whether it is
   * parked behind a laptop that is shut. Neither half can be derived from the
   * other, which is why all three of the page's old workarounds were guesses.
   */
  const placements = useMemo(() => {
    const out = new Map<string, Placement>();
    if (!run) return out;

    const done = new Set(
      run.sections.filter((x) => x.state === "done").map((x) => x.id),
    );
    const ready = new Set(pending);
    const titleOf = (id: string) =>
      run.sections.find((x) => x.id === id)?.title ?? id;

    for (const row of run.sections) {
      const job = jobBySection.get(row.id);

      if (row.state === "done") {
        out.set(row.id, { kind: "done" });
        continue;
      }
      if (row.state === "failed") {
        /*
         * Unroutable is a state on the job, not a shape of sentence.
         *
         * This was `/^No machine here has /` tested against `row.error` — the
         * browser matching, by its first six words, a sentence written by
         * `advance()` on the server. Rewording it there turned a red NO
         * MACHINE chip into a plain FAILED one silently, and invited somebody
         * to press Retry at a tool nobody has installed until they gave up.
         * The job's `state` cannot be reworded into meaning something else.
         */
        out.set(
          row.id,
          job?.state === "unroutable"
            ? { kind: "unroutable", message: row.error || job.error }
            : { kind: "failed", message: row.error || "It did not say why." },
        );
        continue;
      }
      if (row.state === "writing" || job?.state === "claimed") {
        /*
         * Which machine is holding it — a thing the page could not say at all.
         *
         * `run_sections.wroteWith` is written on success, so while a section
         * is in flight the row knows nothing about where it is; the job has
         * named the machine since the moment it was claimed. Still "" for the
         * second between `advance` marking the row and a worker's long poll
         * claiming it, and the page says nothing rather than guessing.
         */
        out.set(row.id, {
          kind: "writing",
          machine: job?.state === "claimed" ? job.workerName : "",
        });
        continue;
      }

      // Queued, which is the word that hid four different situations.
      const deps = runtime?.sections.find((d) => d.id === row.id)?.dependsOn ?? [];
      const missing = deps.filter((d) => !done.has(d));
      if (missing.length) {
        out.set(row.id, { kind: "blocked", on: missing.map(titleOf) });
        continue;
      }
      if (job?.state === "queued") {
        /*
         * Queued behind a machine that was not awake when it was enqueued.
         *
         * `waitUntil` is the tell and it is a field: `advance` sets it in that
         * one case and nowhere else, so nothing here depends on how a sentence
         * is worded. The machine's NAME is in the job's `error`, which IS that
         * sentence — read only while the job has never been attempted, because
         * a retryable failure overwrites `error` and leaves `waitUntil` where
         * it was, and "waiting for Rifat's laptop" must not quietly become a
         * CLI stack trace under an amber WAITING chip.
         *
         * `workerName` is empty here today, because `advance` does not pin the
         * job to the machine it is waiting for. The day it does, this says the
         * name on its own and the sentence stops mattering.
         */
        out.set(
          row.id,
          job.waitUntil
            ? {
                kind: "waiting",
                machine: job.workerName,
                message: job.attempts === 0 ? job.error : "",
              }
            : { kind: "queued" },
        );
        continue;
      }
      /*
       * No job of its own, but the run has work on the queue and this section
       * is next in line — the gap between pressing the button and the poll
       * that sees what it enqueued.
       */
      if (serverWriting && ready.has(row.id)) {
        out.set(
          row.id,
          waitingForMachine
            ? { kind: "waiting", machine: "", message: "" }
            : { kind: "queued" },
        );
        continue;
      }
      out.set(row.id, { kind: "idle" });
    }
    return out;
  }, [run, runtime, pending, jobBySection, serverWriting, waitingForMachine]);

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
  };
}
