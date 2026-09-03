"use client";

import { createRun, startWriting, type Run } from "@/lib/runs-client";
import { partName } from "@/lib/topics";

/**
 * Starting a run, in one place.
 *
 * The run sheet built these inputs inline, which was fine while the sheet was
 * the only way in. It is not: a topic with nothing written now runs from its
 * row on the list and from its own page, and three copies of "what a run is
 * told about a topic" is three chances for one of them to forget the part
 * number and put "Part 1" on everything.
 */

/** What a run needs to know about the topic it is for. */
export type RunTopic = {
  id: string;
  name: string;
  /** The number on the shelf, when the shelf counts. */
  part: number | null;
  /** The shelf's word for its numbers — "Part", "Episode". */
  partLabel: string;
  /** This topic's own note, sent as the run's extra instruction. */
  context: string;
  seriesName: string;
  /** The shelf's brief, one theme per line. */
  seriesContext: string;
};

/**
 * The inputs a pack is given for a topic.
 *
 * A topic whose name is a URL is the website itself; anything else is an idea
 * to research, which the pack's Identify step is written to handle.
 */
export function runInputsFor(topic: RunTopic, workspaceName: string) {
  /*
   * A pasted address, cleaned before it is judged.
   *
   * Topic names arrive from a paste as often as from typing, and a paste
   * brings its wrapper: quotes, angle brackets, a trailing comma. This tested
   * the raw string, so a topic named `"https://coursera.org/...` did not look
   * like a URL — `website_url` went out empty and the template's first section
   * had nothing to identify. That is what "NAME: UNKNOWN" was reporting: not a
   * model failure, a stray quote character.
   */
  const cleaned = topic.name.trim().replace(/^["'<\s]+|["'>,\s]+$/g, "");
  const isUrl = /^https?:\/\//i.test(cleaned);
  return {
    series: topic.seriesName || workspaceName,
    website_url: isUrl ? cleaned : "",
    /*
     * The topic's part, or nothing.
     *
     * Never a fallback of 1: a shelf with numbering switched off would then
     * put "Part 1" into every script it wrote, the same wrong number on all of
     * them, asserted confidently.
     */
    part_number: topic.part != null ? String(topic.part) : "",
    part_label: topic.part != null ? topic.partLabel : "",
    part: partName(topic.partLabel, topic.part),
    series_context: topic.seriesContext,
    extra_instruction: topic.context,
  };
}

/**
 * Create the run and set it writing.
 *
 * Run means run: it returns as soon as the server has taken the job, so the
 * caller can go and watch it rather than landing on a list of queued rows
 * waiting for a second press.
 */
export async function startTopicRun({
  workspaceId,
  workspaceName,
  packSlug,
  topic,
  sourceId,
}: {
  workspaceId: string;
  workspaceName: string;
  packSlug: string;
  topic: RunTopic;
  /** A downloaded reel for the pack to work from, when there is one. */
  sourceId?: string | null;
}): Promise<Run> {
  const run = await createRun({
    workspaceId,
    topicId: topic.id || null,
    sourceId: sourceId ?? null,
    packSlug,
    title: topic.name,
    inputs: runInputsFor(topic, workspaceName),
  });
  // Not awaited: the drive is minutes long and answers as soon as it starts,
  // but a slow answer must not hold up the page that is about to show it.
  void startWriting(run.id).catch(() => {});
  return run;
}
