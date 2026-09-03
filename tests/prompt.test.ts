import { describe, expect, it } from "vitest";

import { interpolate } from "@/lib/server/prompt";
import { slug } from "@/lib/slug";

/**
 * The two rules a prompt and a URL are built out of.
 *
 * `interpolate` decides what a section is actually sent — a placeholder that
 * silently resolves to the empty string is how a script gets written for
 * "Part " with no number. `slug` decides whether `/content/<name>` finds its
 * topic at all, and it is now one function precisely so that two copies cannot
 * drift into 404ing a page that worked yesterday.
 */

describe("interpolate", () => {
  it("replaces what it was given", () => {
    expect(interpolate("{{series}} — Part {{part_number}}.", {
      series: "Powerful website you should know",
      part_number: "18",
    })).toBe("Powerful website you should know — Part 18.");
  });

  it("leaves a placeholder it has no value for alone", () => {
    // Visible in the output, which is the point: a braced key that survives
    // into a script is a missing input somebody can see and fix. Blanking it
    // would produce "Part ." and look like the model's mistake.
    expect(interpolate("Part {{part_number}}.", {})).toBe("Part {{part_number}}.");
  });

  it("blanks a key that exists and is empty, rather than printing braces", () => {
    expect(interpolate("Part {{part_number}}.", { part_number: "" })).toBe("Part .");
  });

  it("trims what it drops in", () => {
    expect(interpolate("{{series}}!", { series: "  Shelf  " })).toBe("Shelf!");
  });

  it("ignores anything that is not a plain key", () => {
    expect(interpolate("{{ series }} {{a-b}}", { series: "x" })).toBe(
      "{{ series }} {{a-b}}",
    );
  });
});

describe("slug", () => {
  it("lowercases and hyphenates", () => {
    expect(slug("ENBN Website Content")).toBe("enbn-website-content");
  });

  it("survives a URL as a name — the common case on this console", () => {
    expect(slug("https://www.swishy.ai/")).toBe("https-www-swishy-ai");
  });

  it("has no hyphens on the ends", () => {
    expect(slug("  ¿What now?  ")).toBe("what-now");
  });

  it("collapses to nothing for a name with no latin letters", () => {
    // Callers that need something must supply a fallback — see `fileNameFor`
    // and the packs repo's `freeSlug`.
    expect(slug("বাংলা স্ক্রিপ্ট")).toBe("");
  });
});
