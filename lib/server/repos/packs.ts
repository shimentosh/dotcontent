import { id, iso, one, q } from "@/lib/server/db/client";
import { slug } from "@/lib/slug";
import { getRaw, setRaw } from "@/lib/server/repos/settings";
import {
  PACKS as BUILTIN,
  type Pack as RuntimePack,
  type PackInput,
  type PackSectionDef,
} from "@/lib/packs/website-shorts";

/**
 * The pack library — the shipped packs and the ones written in the builder,
 * behind one lookup.
 *
 * A caller asking for a pack to run must not care where it came from:
 * `resolve()` returns the same runtime shape either way. The shipped ones are
 * seeded into the table on first run, so from then on they are rows like any
 * other — editable, deletable, and restorable from the code they came from.
 */

export type StoredPack = RuntimePack & {
  /**
   * A version of this pack ships with the app, so it can be restored.
   *
   * It is NOT a lock. The row is yours: rename it, rewrite a section, delete
   * it. This only says there is a copy to fall back to if an edit goes wrong,
   * which is what makes editing a tuned prompt a reasonable thing to offer at
   * all.
   */
  shipped: boolean;
  status: string;
  purpose: string;
  /** ISO time a run last chose it, or "" if none has. */
  usedAt: string;
  runs: number;
};

type Row = Record<string, unknown>;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const map = (r: Row, usage?: { usedAt: string; runs: number }): StoredPack => ({
  slug: String(r.slug),
  name: String(r.name),
  description: String(r.description ?? ""),
  version: Number(r.version ?? 1),
  rules: String(r.rules ?? ""),
  inputs: arr<PackInput>(r.inputs),
  sections: arr<PackSectionDef>(r.sections),
  outputs: arr<RuntimePack["outputs"][number]>(r.outputs),
  shipped: BUILTIN.some((p) => p.slug === String(r.slug)),
  status: String(r.status ?? "DRAFT"),
  purpose: String(r.purpose ?? ""),
  usedAt: usage?.usedAt ?? "",
  runs: usage?.runs ?? 0,
});

const fromCode = (p: RuntimePack, usage?: { usedAt: string; runs: number }): StoredPack => ({
  ...p,
  shipped: true,
  // A shipped pack is always runnable; there is no half-written state for it.
  status: "ACTIVE",
  purpose: "",
  usedAt: usage?.usedAt ?? "",
  runs: usage?.runs ?? 0,
});

async function usageMap() {
  const rows = await q<Row>("SELECT slug, used_at, runs FROM pack_usage");
  const by = new Map<string, { usedAt: string; runs: number }>();
  for (const r of rows) {
    by.set(String(r.slug), { usedAt: iso(r.used_at), runs: Number(r.runs ?? 0) });
  }
  return by;
}

/**
 * The library — rows, and only rows.
 *
 * The shipped packs are seeded INTO the table, so there is nothing to merge in
 * from code here. That matters for deletion: listing code packs as a fallback
 * meant deleting the shipped one made it reappear on the next read, which is
 * not a library, it is an argument. `seedPacks` remembers which slugs it has
 * already introduced, so a pack you delete stays gone and a pack added in a
 * future release still arrives.
 */
export async function listPacks(): Promise<StoredPack[]> {
  const [rows, usage] = await Promise.all([
    q<Row>("SELECT * FROM packs ORDER BY position, created_at"),
    usageMap(),
  ]);
  return rows.map((r) => map(r, usage.get(String(r.slug))));
}

export async function getPack(slug: string): Promise<StoredPack | null> {
  const usage = await usageMap();
  const row = await one<Row>("SELECT * FROM packs WHERE slug = $1", [slug]);
  if (row) return map(row, usage.get(slug));
  const code = BUILTIN.find((p) => p.slug === slug);
  return code ? fromCode(code, usage.get(slug)) : null;
}

/**
 * The pack a run should execute.
 *
 * The row wins. Editing a pack has to change what it writes next — a lookup
 * that preferred the shipped copy would let you rewrite a section, save it,
 * run it, and get the old prompt back with no way to tell.
 *
 * The code definition is the fallback for a slug with no row: a run recorded
 * before the pack was deleted still resolves to something rather than failing
 * with "no such pack" on a rewrite.
 */
export async function resolve(slug: string): Promise<RuntimePack | null> {
  const row = await one<Row>("SELECT * FROM packs WHERE slug = $1", [slug]);
  if (row) return map(row);
  return BUILTIN.find((p) => p.slug === slug) ?? null;
}

export type PackPatch = Partial<
  Pick<
    StoredPack,
    | "name"
    | "description"
    | "status"
    | "purpose"
    | "rules"
    | "inputs"
    | "sections"
    | "outputs"
  >
>;

/** A slug from a name, made unique by suffix rather than by rejection. */
async function freeSlug(name: string) {
  // The same rule every other slug uses, capped so a pasted paragraph does not
  // become a 400-character primary key.
  const base = slug(name).slice(0, 48) || "pack";
  const taken = new Set([
    ...BUILTIN.map((p) => p.slug),
    ...(await q<{ slug: string }>("SELECT slug FROM packs")).map((r) => r.slug),
  ]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function createPack(patch: PackPatch): Promise<StoredPack> {
  const name = patch.name?.trim() || "Untitled pack";
  const row = await one<Row>(
    `INSERT INTO packs
       (id, slug, name, description, status, purpose, rules,
        inputs, sections, outputs, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             $8::jsonb, $9::jsonb, $10::jsonb,
             (SELECT COALESCE(MAX(position), -1) + 1 FROM packs))
     RETURNING *`,
    [
      id("pk"),
      await freeSlug(name),
      name,
      patch.description ?? "",
      patch.status ?? "DRAFT",
      patch.purpose ?? "",
      patch.rules ?? "",
      JSON.stringify(patch.inputs ?? []),
      JSON.stringify(patch.sections ?? []),
      JSON.stringify(patch.outputs ?? []),
    ],
  );
  return map(row!);
}

export async function updatePack(
  slug: string,
  patch: PackPatch,
): Promise<StoredPack | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${col} = $${values.length}${cast}`);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.description !== undefined) set("description", patch.description);
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.purpose !== undefined) set("purpose", patch.purpose);
  if (patch.rules !== undefined) set("rules", patch.rules);
  if (patch.inputs !== undefined) set("inputs", JSON.stringify(patch.inputs), "::jsonb");
  if (patch.sections !== undefined)
    set("sections", JSON.stringify(patch.sections), "::jsonb");
  if (patch.outputs !== undefined)
    set("outputs", JSON.stringify(patch.outputs), "::jsonb");
  if (!sets.length) return getPack(slug);

  // Every saved edit is a new version — a run records the slug, and the version
  // is how you tell content written before a rewrite from content written after.
  sets.push("version = version + 1", "updated_at = now()");
  values.push(slug);
  const row = await one<Row>(
    `UPDATE packs SET ${sets.join(", ")} WHERE slug = $${values.length} RETURNING *`,
    values,
  );
  return row ? map(row) : null;
}

export async function deletePack(slug: string) {
  const rows = await q("DELETE FROM packs WHERE slug = $1 RETURNING id", [slug]);
  if (!rows.length) return false;
  // The usage row goes too. Slugs are reused — write a pack, delete it, write
  // another by the same name and it takes the same slug — and a fresh pack
  // that opens on "3 runs, used 2h ago" is reporting a stranger's history.
  await q("DELETE FROM pack_usage WHERE slug = $1", [slug]);
  return true;
}

/** Recorded when a run starts, for both code packs and written ones. */
export async function markUsed(slug: string) {
  await q(
    `INSERT INTO pack_usage (slug, used_at, runs) VALUES ($1, now(), 1)
     ON CONFLICT (slug) DO UPDATE
       SET used_at = now(), runs = pack_usage.runs + 1`,
    [slug],
  );
}

export const isShipped = (slug: string) => BUILTIN.some((p) => p.slug === slug);

const SEEDED_KEY = "seededPacks";

/**
 * The shipped packs, written into the table so they are ordinary rows.
 *
 * Introduced once each, tracked by slug rather than by whether the table is
 * empty. The difference is what happens after you delete one: an emptiness
 * check would put it back the moment the last pack went, and a per-slug record
 * lets a pack added in a future release arrive without resurrecting anything.
 *
 * They arrive complete — every section, every instruction, the inputs and the
 * output groups — because the point is a finished pack to read and copy from,
 * not an example with the prompts left out.
 */
export async function seedPacks() {
  const seeded = await getRaw<string[]>(SEEDED_KEY, []);
  const fresh = BUILTIN.filter((p) => !seeded.includes(p.slug));
  if (!fresh.length) return 0;

  for (const p of fresh) await seedOne(p);
  await setRaw(SEEDED_KEY, [...seeded, ...fresh.map((p) => p.slug)]);
  return fresh.length;
}

/**
 * Put a pack back the way it shipped.
 *
 * The safety net that makes an editable tuned prompt reasonable to offer: a
 * section rewritten badly is one click from the version that was working, and
 * the version number keeps climbing so a run written under the broken one is
 * still distinguishable.
 */
export async function restorePack(slug: string): Promise<StoredPack | null> {
  const code = BUILTIN.find((p) => p.slug === slug);
  if (!code) return null;
  const row = await one<Row>(
    `UPDATE packs SET
       name = $2, description = $3, rules = $4, inputs = $5::jsonb,
       sections = $6::jsonb, outputs = $7::jsonb, purpose = $8,
       status = 'ACTIVE', version = version + 1, updated_at = now()
     WHERE slug = $1 RETURNING *`,
    [
      slug,
      code.name,
      code.description,
      code.rules,
      JSON.stringify(code.inputs),
      JSON.stringify(code.sections),
      JSON.stringify(code.outputs),
      // The purpose goes back too. Restoring everything except the line that
      // says what the pack is FOR would leave one that runs correctly and has
      // forgotten why.
      code.purpose ?? "",
    ],
  );
  // No row to restore onto: write it back in as a new one.
  if (!row) {
    await seedOne(code);
    return getPack(slug);
  }
  return map(row);
}

async function seedOne(p: RuntimePack) {
  await q(
    `INSERT INTO packs
       (id, slug, name, description, version, status, rules, inputs, sections,
        outputs, purpose, position)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7::jsonb, $8::jsonb, $9::jsonb,
             $10,
             (SELECT COALESCE(MAX(position), -1) + 1 FROM packs))
     ON CONFLICT (slug) DO NOTHING`,
    [
      id("pk"),
      p.slug,
      p.name,
      p.description,
      p.version,
      p.rules,
      JSON.stringify(p.inputs),
      JSON.stringify(p.sections),
      JSON.stringify(p.outputs),
      p.purpose ?? "",
    ],
  );
}
