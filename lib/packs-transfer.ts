"use client";

import type { Pack } from "@/lib/packs";
import { slug } from "@/lib/slug";
import { fromDraft } from "@/lib/packs-client";

/**
 * A template as a file, so one console can hand it to another.
 *
 * The whole brief travels: the rules, every section and its prompt, the inputs
 * a run asks for and the output groups. A file with the name and description
 * alone would import as an empty template with a familiar title, which is the
 * worst kind of half-working.
 *
 * The wrapper is deliberate. A bare pack object is indistinguishable from any
 * other JSON somebody drops on the screen, and "kind" plus "version" is what
 * lets the import say "that is not a template" instead of creating one with no
 * sections in it.
 */

export const TRANSFER_KIND = "contentos.template";
export const TRANSFER_VERSION = 1;

export type TemplateFile = {
  kind: typeof TRANSFER_KIND;
  version: number;
  /** When it left, for a person reading the file rather than for the code. */
  exportedAt: string;
  /** What it was called where it came from — the slug is NOT carried. */
  from?: string;
  template: {
    name: string;
    description: string;
    purpose: string;
    rules: string;
    status?: string;
    inputs: { key: string; label: string; required?: boolean }[];
    outputs: { key: string; label: string; sections: string[] }[];
    sections: {
      id: string;
      title: string;
      summary: string;
      dependsOn: string[];
      tier: string;
      instruction: string;
      type?: string;
    }[];
  };
};

/**
 * A pack, as a file.
 *
 * The slug is left behind on purpose: it is this console's id for the row, and
 * carrying it would either collide with a template already here or quietly
 * overwrite one. The importing side mints its own.
 */
export function toFile(pack: Pack): TemplateFile {
  const body = fromDraft(pack.draft);
  return {
    kind: TRANSFER_KIND,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    from: pack.name,
    template: {
      name: body.name,
      description: body.description,
      purpose: body.purpose,
      rules: body.rules,
      status: pack.status,
      // Straight off the row rather than out of the draft: the builder does not
      // edit these two, so `fromDraft` has nothing to say about them and would
      // export every template as one that asks for nothing.
      inputs: pack.inputs ?? [],
      outputs: pack.outputs ?? [],
      sections: body.sections,
    },
  };
}

/** `ENBN Website Content` → `enbn-website-content.template.json` */
export const fileNameFor = (name: string) =>
  `${slug(name) || "template"}.template.json`;

export class TransferError extends Error {}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * A file, back into the body `POST /api/packs` takes.
 *
 * Every field is read defensively. This is a file that came from somewhere
 * else — another console, a chat message, a colleague's export from a version
 * that has since moved on — and the failure it must never have is importing
 * half a template silently. Anything missing that matters throws with a
 * sentence a person can act on.
 */
export function fromFile(raw: unknown) {
  const file = (raw ?? {}) as Partial<TemplateFile>;

  if (file.kind !== TRANSFER_KIND) {
    throw new TransferError(
      "That file is not a Content OS template — it should start with a “kind” of contentos.template.",
    );
  }
  if (Number(file.version) > TRANSFER_VERSION) {
    throw new TransferError(
      `That file was written by a newer version of Content OS (v${file.version}). Update this one first.`,
    );
  }

  const t = (file.template ?? {}) as Partial<TemplateFile["template"]>;
  const name = str(t.name).trim();
  if (!name) throw new TransferError("That template has no name.");

  const sections = arr<Record<string, unknown>>(t.sections)
    .map((s, i) => ({
      id: str(s.id).trim() || `section-${i + 1}`,
      title: str(s.title).trim() || `Section ${i + 1}`,
      summary: str(s.summary),
      dependsOn: arr<string>(s.dependsOn).filter((d) => typeof d === "string"),
      tier: str(s.tier) || "standard",
      instruction: str(s.instruction),
      type: str(s.type) || undefined,
    }))
    .filter((s) => s.title);

  if (!sections.length) {
    throw new TransferError(
      "That template has no sections, so there would be nothing for it to write.",
    );
  }

  /*
   * A dependency on a section that did not travel is dropped.
   *
   * It would otherwise be a section that can never run: the engine waits for a
   * name nothing on this template will ever produce, and the run ends with it
   * still queued and no explanation on the page.
   */
  const known = new Set(sections.map((s) => s.id));
  for (const s of sections) s.dependsOn = s.dependsOn.filter((d) => known.has(d));

  return {
    name,
    description: str(t.description),
    purpose: str(t.purpose),
    rules: str(t.rules),
    // Imported as a draft whatever it was at home: it has not run here yet, and
    // a template that arrives marked ACTIVE claims a standing it has not earned.
    status: "DRAFT",
    inputs: arr<Record<string, unknown>>(t.inputs)
      .map((i) => ({
        key: str(i.key).trim(),
        label: str(i.label).trim() || str(i.key).trim(),
        required: Boolean(i.required),
        type: str(i.type) || undefined,
        placeholder: str(i.placeholder) || undefined,
        hint: str(i.hint) || undefined,
        defaultValue: str(i.defaultValue) || undefined,
      }))
      .filter((i) => i.key),
    outputs: arr<Record<string, unknown>>(t.outputs)
      .map((o) => ({
        key: str(o.key).trim(),
        label: str(o.label).trim() || str(o.key).trim(),
        sections: arr<string>(o.sections).filter((id) => known.has(id)),
      }))
      .filter((o) => o.key && o.sections.length),
    sections,
  };
}

/**
 * Hand the file to the browser.
 *
 * A blob and a click rather than a route: the file is built from a pack the
 * screen already has, so a round trip to the server would only be a slower way
 * to get the same bytes.
 */
export function download(name: string, body: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoked on the next tick: Chrome cancels the download if the URL dies
  // before it has read it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
