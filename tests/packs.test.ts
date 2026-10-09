import { describe, expect, it } from "vitest";

import { PACKS, findPack } from "@/lib/packs/catalog";
import { RUN_INPUTS } from "@/lib/run-inputs";
import { runInputsFor } from "@/lib/start-run";
import { plan } from "@/lib/server/prompt";
import { EXAMPLE_SHELVES } from "@/lib/topics";

/**
 * The templates that ship, checked the way a run would use them.
 *
 * A shipped template is seeded into every console, so a broken one is broken
 * everywhere at once — and the failures are quiet. A dependency on a section
 * id that was renamed is skipped rather than reported, a placeholder nothing
 * fills reaches the model as literal braces, and an output naming a missing
 * section renders as an empty tab.
 */

const KNOWN_INPUTS = new Set(RUN_INPUTS.map((i) => i.key));

describe("every shipped template", () => {
  it("has a slug and a name of its own", () => {
    expect(new Set(PACKS.map((p) => p.slug)).size).toBe(PACKS.length);
    expect(new Set(PACKS.map((p) => p.name)).size).toBe(PACKS.length);
    for (const p of PACKS) expect(findPack(p.slug)).toBe(p);
  });

  for (const pack of PACKS) {
    describe(pack.name, () => {
      const ids = pack.sections.map((s) => s.id);

      it("has unique section ids", () => {
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("depends only on sections it has, and plans every one of them", () => {
        for (const s of pack.sections) {
          for (const d of s.dependsOn) expect(ids).toContain(d);
        }
        // A cycle leaves sections out of the plan rather than throwing.
        expect(plan(pack).flat().sort()).toEqual([...ids].sort());
      });

      it("groups only sections it has into its outputs", () => {
        for (const o of pack.outputs) {
          for (const id of o.sections) expect(ids).toContain(id);
        }
      });

      it("asks only for inputs a run fills", () => {
        for (const i of pack.inputs) expect(KNOWN_INPUTS).toContain(i.key);
      });

      it("uses only placeholders a run fills", () => {
        const text = [
          pack.rules,
          pack.purpose ?? "",
          ...pack.sections.map((s) => s.instruction),
        ].join("\n");
        for (const [, key] of text.matchAll(/\{\{(\w+)\}\}/g)) {
          expect(KNOWN_INPUTS).toContain(key);
        }
      });
    });
  }
});

describe("the example shelves", () => {
  it("each run a template that ships", () => {
    const names = new Set(PACKS.map((p) => p.name));
    for (const shelves of Object.values(EXAMPLE_SHELVES)) {
      for (const shelf of shelves) expect(names).toContain(shelf.pack);
    }
  });

  it("between them use every template", () => {
    const used = new Set(
      Object.values(EXAMPLE_SHELVES).flatMap((s) => s.map((x) => x.pack)),
    );
    // Website Shorts is on the design's own sample shelves.
    for (const p of PACKS.filter((x) => x.slug !== "enbn-website-package")) {
      expect(used).toContain(p.name);
    }
  });
});

describe("runInputsFor", () => {
  const topic = {
    id: "t1",
    name: "Kindle Paperwhite",
    part: null,
    partLabel: "",
    context: "",
    seriesName: "Honest reviews",
    seriesContext: "",
  };

  it("hands the template the topic itself", () => {
    // It used to send the series and the part, and never the subject: a
    // review template was asked to review nothing in particular.
    expect(runInputsFor(topic, "Affiliate Desk").topic).toBe("Kindle Paperwhite");
  });

  it("still treats a link as the website too", () => {
    const inputs = runInputsFor({ ...topic, name: " https://remove.bg " }, "w");
    expect(inputs.topic).toBe("https://remove.bg");
    expect(inputs.website_url).toBe("https://remove.bg");
  });
});
