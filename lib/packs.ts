/**
 * What a pack looks like to the screens.
 *
 * The shapes and the status palette only. There was a `SEED_PACKS` here that
 * built a library out of constants — nine packs whose prompts were mostly
 * blank — and a `draftFor` that invented a brief for each. Packs are rows now,
 * seeded from the ones that ship, so there is nothing left to fabricate.
 */

import type { PackDraft } from "./data";

export type PackStatus = "ACTIVE" | "READY" | "DRAFT";

export const PACK_STATUS: Record<PackStatus, { bg: string; fg: string }> = {
  ACTIVE: { bg: "rgba(75,176,122,0.16)", fg: "#4bb07a" },
  READY: { bg: "rgba(0,87,252,0.16)", fg: "#6a9dff" },
  DRAFT: { bg: "rgba(255,255,255,0.07)", fg: "rgba(240,240,244,0.5)" },
};

export const PACK_STATUSES: PackStatus[] = ["ACTIVE", "READY", "DRAFT"];

export type Pack = {
  id: string;
  /** The two-digit number the cards and rows show. */
  n: string;
  name: string;
  desc: string;
  sections: string;
  used: string;
  status: PackStatus;
  /**
   * A version of this pack ships with the app, so it can be restored.
   *
   * Not a lock — the row is editable like any other. It is what lets the
   * screens offer "Restore the shipped version" after an edit goes wrong.
   */
  shipped?: boolean;
  /** Bumped on every save, so a run can be read against what it ran under. */
  version?: number;
  /** How many runs have chosen it. */
  runs?: number;
  /** What the run sheet will ask for before it can start. */
  inputs?: { key: string; label: string; required: boolean }[];
  /** Which sections roll up into one deliverable. */
  outputs?: { key: string; label: string; sections: string[] }[];
  /**
   * The brief behind the pack — the thing the builder edits. A pack is not a
   * card with a description on it; it is these sections and the rules above
   * them, which is why Edit opens the builder rather than a name field.
   */
  draft: PackDraft;
};

/**
 * The template a shelf runs with.
 *
 * A series names its template, and most do. When one does not, "which
 * template" is only a question if there is more than one answer: a workspace
 * with a single template in the library has already answered it, and making
 * someone confirm it before every run is asking them to agree with themselves.
 * With two or more, this returns nothing and the caller asks.
 *
 * By name because that is what the series stores — the name a person picked in
 * its Brief, not an id.
 */
export function packForSeries(packs: Pack[], seriesPack: string) {
  return (
    packs.find((x) => x.name === seriesPack) ??
    (packs.length === 1 ? packs[0] : undefined)
  );
}

/** A pack with nothing in it yet — what Create Pack starts from. */
export function emptyDraft(): PackDraft {
  return {
    name: "",
    summary: "",
    status: "DRAFT",
    purpose: "",
    rules: "",
    sections: [],
  };
}
