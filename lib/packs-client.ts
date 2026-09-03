"use client";

import { apiFetch } from "@/lib/api-base";
import type { PackDraft } from "@/lib/data";
import type { Pack as UiPack, PackStatus } from "@/lib/packs";
import { json } from "@/lib/api-json";

/**
 * The browser's half of the pack API.
 *
 * The server stores a pack in the shape a run executes; the builder edits a
 * brief. The translation lives here, in one place, so the two shapes cannot
 * drift apart in four screens independently.
 */

type ApiSection = {
  id: string;
  title: string;
  summary: string;
  dependsOn: string[];
  tier: string;
  instruction: string;
  /** The builder's kind ("Script", "Hook", …). Absent on shipped packs. */
  type?: string;
};

export type ApiPack = {
  slug: string;
  name: string;
  description: string;
  version: number;
  shipped: boolean;
  status: string;
  purpose: string;
  rules: string;
  inputs: { key: string; label: string; required?: boolean }[];
  outputs: { key: string; label: string; sections: string[] }[];
  sections: ApiSection[];
  usedAt: string;
  runs: number;
};

/** "2h ago" — what the packs list has always shown, now from a real time. */
export function ago(iso: string) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

const KNOWN: PackStatus[] = ["ACTIVE", "READY", "DRAFT"];

export function toUiPack(p: ApiPack, index: number): UiPack {
  return {
    id: p.slug,
    n: String(index + 1).padStart(2, "0"),
    name: p.name,
    desc: p.description,
    sections: String(p.sections.length),
    used: ago(p.usedAt),
    status: (KNOWN as string[]).includes(p.status)
      ? (p.status as PackStatus)
      : "DRAFT",
    shipped: p.shipped,
    version: p.version,
    runs: p.runs,
    inputs: (p.inputs ?? []).map((i) => ({
      key: i.key,
      label: i.label,
      required: Boolean(i.required),
    })),
    outputs: p.outputs ?? [],
    draft: {
      name: p.name,
      summary: p.description,
      status: (KNOWN as string[]).includes(p.status)
        ? (p.status as PackStatus)
        : "DRAFT",
      purpose: p.purpose,
      rules: p.rules,
      sections: p.sections.map((s) => ({
        id: s.id,
        name: s.title,
        // A shipped section has no builder kind — it has a tier, which is the
        // more useful label anyway: it says how much thinking the section gets.
        type: s.type || s.tier || "Custom Text",
        brief: s.instruction,
        summary: s.summary,
        tier: s.tier,
        dependsOn: s.dependsOn,
      })),
    },
  };
}

/**
 * What POST and PATCH take.
 *
 * Named rather than inferred from `fromDraft`, because a template that arrives
 * as a file carries two things the builder does not edit — the inputs a run
 * asks for and the output groups — and inferring the type from the builder's
 * half made the import a type error rather than a feature.
 */
export type PackBody = {
  name: string;
  description: string;
  status?: string;
  purpose: string;
  rules: string;
  inputs?: {
    key: string;
    label: string;
    required?: boolean;
    type?: string;
    placeholder?: string;
    hint?: string;
    defaultValue?: string;
  }[];
  sections: {
    id: string;
    title: string;
    summary: string;
    dependsOn: string[];
    tier: string;
    instruction: string;
    type?: string;
  }[];
  outputs: { key: string; label: string; sections: string[] }[];
};

/** The brief, back in the shape the run engine executes. */
export function fromDraft(draft: PackDraft): PackBody {
  return {
    name: draft.name.trim() || "Untitled pack",
    description: draft.summary.trim(),
    status: draft.status,
    purpose: draft.purpose,
    rules: draft.rules,
    sections: draft.sections.map((s) => ({
      id: s.id,
      title: s.name,
      summary: "",
      // The builder draws no dependency arrows and sets no tier, so a section
      // written there gets the defaults. A section that ARRIVED with them —
      // from a shipped template, or an import — keeps them: saving from the
      // builder used to cut every chain a template had.
      dependsOn: s.dependsOn ?? [],
      tier: s.tier ?? "standard",
      instruction: s.brief,
      type: s.type,
    })),
    outputs: [] as { key: string; label: string; sections: string[] }[],
  };
}

export const listPacks = () =>
  apiFetch("/api/packs", { cache: "no-store" }).then((r) => json<ApiPack[]>(r));

/** One pack in the shape a run executes — sections, tiers, dependency arrows. */
export const getPack = (slug: string) =>
  apiFetch(`/api/packs/${slug}`, { cache: "no-store" }).then((r) => json<ApiPack>(r));

export const createPack = (body: PackBody) =>
  apiFetch("/api/packs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<ApiPack>(r));

/** Put a pack back the way it shipped. Only for one that ships. */
export const restorePack = (slug: string) =>
  apiFetch(`/api/packs/${slug}`, { method: "POST" }).then((r) => json<ApiPack>(r));

export const patchPack = (slug: string, body: unknown) =>
  apiFetch(`/api/packs/${slug}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<ApiPack>(r));

export const removePack = (slug: string) =>
  apiFetch(`/api/packs/${slug}`, { method: "DELETE" }).then((r) =>
    json<{ ok: boolean }>(r),
  );
