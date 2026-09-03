"use client";

import type { ContentDoc, DocSection, OutputKey } from "@/lib/content-docs";
import type { Pack } from "@/lib/packs";
import type { Run } from "@/lib/runs-client";
import { partName } from "@/lib/topics";

/**
 * A run, in the shape the content screens read.
 *
 * One translation, used by the list and by the document page. It lived in the
 * list only, which is why the document page never showed a real run: the two
 * screens had one idea of a document and only one of them could build it.
 *
 * The design's `ContentDoc` is kept as the shared shape rather than replaced
 * because the layout around it is good — grouped outputs, a sections rail, a
 * topics rail — and it is the sample DATA that was the problem, not the form.
 */

/** A pack's output group, as one of the five the screens draw glyphs for. */
const OUTPUT_KEY: Record<string, OutputKey | undefined> = {
  script_en: "en",
  script_bn: "bn",
  social_caption: "social",
  youtube_seo: "seo",
  hashtags: "tags",
};

const when = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};

export function runToDoc(run: Run, pack?: Pack): ContentDoc {
  /*
   * Which deliverable each section feeds.
   *
   * The pack already says so — its output groups name the sections that roll
   * up into an English script, a Bangla script and so on. Read from there
   * rather than guessed, so a written pack with its own groups works too.
   */
  const outputOf = new Map<string, OutputKey>();
  for (const group of pack?.outputs ?? []) {
    const key = OUTPUT_KEY[group.key];
    if (!key) continue;
    for (const id of group.sections) outputOf.set(id, key);
  }

  const sections: DocSection[] = run.sections.map((sec, i) => {
    const output = outputOf.get(sec.id) ?? null;
    return {
      id: sec.id,
      n: String(i + 1).padStart(2, "0"),
      name: sec.title,
      purpose: "",
      kind: "script",
      output,
      lang: output === "bn" ? "BN" : output === "en" ? "EN" : null,
      state:
        sec.state === "done"
          ? "written"
          : sec.state === "writing"
            ? "writing"
            : sec.state === "failed"
              ? "failed"
              : "queued",
      body: sec.content ? sec.content.split("\n") : [],
      ms: sec.ms,
      error: sec.error,
      edited: Boolean(sec.editedAt),
    };
  });

  return {
    slug: run.id,
    runId: run.id,
    topicId: run.topicId ?? undefined,
    topic: run.title,
    series: run.inputs.series || "Runs",
    pack: pack?.name ?? run.packSlug,
    /*
     * What the run itself was told to call its number.
     *
     * `part_number` alone is kept as a fallback for runs written before a
     * shelf could name its count — every one of those was a Part, because
     * that was the only word the app knew.
     */
    part:
      run.inputs.part ||
      (run.inputs.part_number
        ? partName("Part", Number(run.inputs.part_number))
        : ""),
    blurb: run.inputs.website_url || "",
    // What the run row says, not a constant. The pill on the list writes this
    // through to the server, so it has to be read back from there too.
    decision: run.decision ?? "ready",
    created: when(run.createdAt),
    updated: when(run.updatedAt),
    at: run.updatedAt,
    sections,
  };
}

/** The newest run for a topic, or nothing if it has never been run. */
export function latestRunFor(runs: Run[], topicId: string) {
  return (
    runs
      .filter((r) => r.topicId === topicId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/** The slug a topic is reached by. Matches how the list builds its rows. */
export const topicSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
