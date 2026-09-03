import { describe, expect, it } from "vitest";

import type { ContentDoc, DocSection, SectionState } from "@/lib/content-docs";
import { usageOf } from "@/lib/content-docs";
import { statusOf } from "@/lib/decisions";

/**
 * What a row says about itself.
 *
 * This is the logic that had a run sitting in "Writing" for five days: the
 * status was derived from a count of written sections and nothing else, so a
 * run that died and a run that never started were both indistinguishable from
 * one being written that second. The cases below are exactly those, and they
 * are cheap to keep honest.
 */

const section = (n: string, state: SectionState): DocSection => ({
  id: n,
  n,
  name: `Section ${n}`,
  purpose: "",
  kind: "script",
  output: null,
  lang: null,
  state,
  body: state === "written" ? ["some text"] : [],
});

const doc = (states: SectionState[]): ContentDoc => ({
  slug: "run_test",
  topic: "A topic",
  series: "A shelf",
  pack: "A template",
  part: "",
  blurb: "",
  decision: "ready",
  created: "",
  updated: "",
  at: new Date().toISOString(),
  sections: states.map((s, i) => section(String(i + 1).padStart(2, "0"), s)),
});

describe("statusOf", () => {
  it("is an idea when nothing has been run", () => {
    expect(statusOf(doc([]))).toBe("idea");
  });

  it("is writing while a section is being written", () => {
    expect(statusOf(doc(["written", "writing", "queued"]))).toBe("writing");
  });

  it("is failed when a section gave up, even mid-run", () => {
    expect(statusOf(doc(["written", "failed", "queued"]))).toBe("failed");
  });

  it("prefers writing over failed — something is still moving", () => {
    expect(statusOf(doc(["failed", "writing"]))).toBe("writing");
  });

  it("is an idea again when a run was created and never got going", () => {
    // The two Squoosh rows that read "Writing" for five days: twelve queued
    // sections, nothing written, nothing failed, nothing in flight.
    expect(statusOf(doc(["queued", "queued", "queued"]))).toBe("idea");
  });

  it("is writing when it is part-way through", () => {
    expect(statusOf(doc(["written", "queued"]))).toBe("writing");
  });

  it("falls through to the decision once every section landed", () => {
    expect(statusOf(doc(["written", "written"]))).toBe("ready");
  });
});

describe("usageOf", () => {
  it("agrees with statusOf about failure", () => {
    expect(usageOf(doc(["written", "failed"]))).toBe("failed");
  });
});
