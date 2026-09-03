"use client";

import { useSyncExternalStore } from "react";

import {
  writtenCount,
  type ContentDoc,
  type Decision,
  type UsageStatus,
} from "./content-docs";
import { setRunDecision } from "./runs-client";

/**
 * Used / Ready / Ignored, as changed from the UI.
 *
 * A module-level store rather than a context: it needs no provider, so it
 * stays out of the shared layout and store files, and it survives navigation
 * between the content screens.
 *
 * The map is a cache in front of the server, not the truth. It used to be the
 * truth, and the comment here said so — "nothing is persisted, a reload
 * returns every topic to its base decision" — which is a fair description of
 * a control that does not work: you mark six pieces used, refresh, and all six
 * say ready again. Now the pill writes through, and the map only holds the
 * answer between the click and the response so the row changes under your
 * cursor rather than a moment later.
 */

const overrides = new Map<string, Decision>();
const listeners = new Set<() => void>();

/** Bumped on every change so useSyncExternalStore sees a new snapshot. */
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** The server has no overrides, so it always renders the base decisions. */
const getServerVersion = () => 0;

function announce() {
  version += 1;
  listeners.forEach((l) => l());
}

/**
 * Set a decision, and keep it.
 *
 * Takes the document rather than its slug because where the decision lives
 * depends on what the row is: a run that produced content owns its own, and a
 * topic nothing has been run on yet owns one on the topic. The slug is only
 * how the row is addressed on screen.
 *
 * The row moves first and the request follows. If the request fails the
 * override is dropped, so the pill goes back to what the server still says
 * rather than showing a change that did not happen.
 */
export function setDecision(
  doc: Pick<ContentDoc, "slug" | "runId" | "topicId">,
  decision: Decision,
) {
  const previous = overrides.get(doc.slug);
  overrides.set(doc.slug, decision);
  announce();

  const revert = () => {
    if (previous === undefined) overrides.delete(doc.slug);
    else overrides.set(doc.slug, previous);
    announce();
  };

  if (doc.runId) {
    void setRunDecision(doc.runId, decision).catch(revert);
  } else if (doc.topicId) {
    void fetch(`/api/topics/${doc.topicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("PATCH failed");
      })
      .catch(revert);
  }
}

/**
 * The status to show. A topic that is still producing reads "Writing"
 * whatever the decision says, so status and progress can never disagree.
 */
export function statusOf(doc: ContentDoc): UsageStatus {
  // No sections at all is a topic nothing has been run on yet — an idea, not a
  // document that stalled on its first section.
  if (doc.sections.length === 0) return "idea";
  // Something is being written right now. This is the only state the page can
  // be sure of, so it is asked first.
  if (doc.sections.some((s) => s.state === "writing")) return "writing";
  /*
   * A section that failed makes the row say so.
   *
   * It used to read "Writing", because the count of written sections was short
   * and nothing else was consulted — so a run that died on section three sat
   * in the Writing tab for days, indistinguishable from one being written that
   * second. Failed is its own status: you can filter for it, and Retry is on
   * the row.
   */
  if (doc.sections.some((s) => s.state === "failed")) return "failed";
  /*
   * Nothing written, nothing writing, nothing failed — a run that was created
   * and never got going. That is an idea again, which is where it can be
   * started from, rather than a document permanently mid-write.
   */
  if (writtenCount(doc) === 0) return "idea";
  // Against its OWN section count, not the design's global one. A real run has
  // whatever number of sections its pack declares, and comparing twelve written
  // sections to a constant that happens to say something else reported a
  // finished run as still writing.
  if (writtenCount(doc) < doc.sections.length) return "writing";
  return overrides.get(doc.slug) ?? doc.decision;
}

/** True once a topic is finished and its status can be changed. */
export function isEditable(doc: ContentDoc) {
  return doc.sections.length > 0 && writtenCount(doc) === doc.sections.length;
}

/**
 * Subscribes the caller to decision changes and returns the current version,
 * which callers can put in a useMemo dependency list.
 */
export function useDecisions() {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}
