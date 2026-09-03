import { describe, expect, it } from "vitest";

import type { Pack } from "@/lib/packs";
import { TransferError, fileNameFor, fromFile, toFile } from "@/lib/packs-transfer";
import { slug } from "@/lib/slug";

/**
 * A template leaving one console and arriving at another.
 *
 * The failure this has to make impossible is a half-imported template: a name
 * and a description, no prompts, and no sign that anything was lost. So the
 * round trip is checked field by field, and every way a file can be wrong is
 * checked for a sentence rather than a silent success.
 */

const pack = (): Pack => ({
  id: "enbn-website-package",
  n: "01",
  name: "ENBN Website Content",
  desc: "A researched website becomes a short-form set",
  sections: "2",
  used: "never",
  status: "ACTIVE",
  inputs: [{ key: "series", label: "Series", required: true }],
  outputs: [{ key: "en", label: "English script", sections: ["script-en"] }],
  draft: {
    name: "ENBN Website Content",
    summary: "A researched website becomes a short-form set",
    status: "ACTIVE",
    purpose: "Earn a save and a comment",
    rules: "Never name the website.",
    sections: [
      {
        id: "research",
        name: "Website research",
        type: "Research",
        brief: "Read the landing page.",
      },
      {
        id: "script-en",
        name: "English script",
        type: "Script",
        brief: "Write ONE script.",
      },
    ],
  },
});

describe("toFile", () => {
  it("carries the whole brief, and leaves the slug behind", () => {
    const file = toFile(pack());
    expect(file.kind).toBe("contentos.template");
    expect(file.template.rules).toBe("Never name the website.");
    expect(file.template.sections).toHaveLength(2);
    expect(file.template.sections[1].instruction).toBe("Write ONE script.");
    // The importing console mints its own — carrying it would collide.
    expect(JSON.stringify(file)).not.toContain('"slug"');
  });

  it("exports the inputs a run asks for, which the builder never edits", () => {
    expect(toFile(pack()).template.inputs).toEqual([
      { key: "series", label: "Series", required: true },
    ]);
  });
});

describe("fromFile", () => {
  it("round-trips every prompt", () => {
    const body = fromFile(toFile(pack()));
    expect(body.name).toBe("ENBN Website Content");
    expect(body.sections.map((s) => s.instruction)).toEqual([
      "Read the landing page.",
      "Write ONE script.",
    ]);
    expect(body.inputs).toHaveLength(1);
    expect(body.outputs).toHaveLength(1);
  });

  it("arrives as a draft whatever it was at home", () => {
    expect(fromFile(toFile(pack())).status).toBe("DRAFT");
  });

  it("refuses anything that is not a template file", () => {
    expect(() => fromFile({ name: "looks like a pack" })).toThrow(TransferError);
    expect(() => fromFile(null)).toThrow(TransferError);
  });

  it("refuses a file from a newer version rather than half-reading it", () => {
    const file = { ...toFile(pack()), version: 99 };
    expect(() => fromFile(file)).toThrow(/newer version/);
  });

  it("refuses a template with no sections", () => {
    const file = toFile(pack());
    file.template.sections = [];
    expect(() => fromFile(file)).toThrow(/no sections/);
  });

  it("drops a dependency on a section that did not travel", () => {
    const file = toFile(pack());
    file.template.sections[1].dependsOn = ["research", "a-section-left-behind"];
    expect(fromFile(file).sections[1].dependsOn).toEqual(["research"]);
  });

  it("keeps an output only while the sections it names are here", () => {
    const file = toFile(pack());
    file.template.outputs = [
      { key: "en", label: "EN", sections: ["script-en"] },
      { key: "bn", label: "BN", sections: ["script-bn"] },
    ];
    expect(fromFile(file).outputs.map((o) => o.key)).toEqual(["en"]);
  });
});

describe("fileNameFor", () => {
  it("is the slug rule plus a suffix", () => {
    expect(fileNameFor("ENBN Website Content")).toBe(
      "enbn-website-content.template.json",
    );
  });

  it("still gives a usable name when the title slugs to nothing", () => {
    expect(slug("বাংলা")).toBe("");
    expect(fileNameFor("বাংলা")).toBe("template.template.json");
  });
});
