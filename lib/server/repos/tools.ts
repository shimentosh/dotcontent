import { iso, one, q } from "@/lib/server/db/client";
import { getRaw, setRaw } from "@/lib/server/repos/settings";
import { TOOLS as BUILTIN, type Tool } from "@/lib/tools";

/**
 * The tool bench — the shipped tools and where each one is allowed to appear.
 *
 * Tools used to be a constant. Every workspace saw the same three cards, and
 * the only way to change that was a release. A workspace is a channel with its
 * own job, so which tools stand on its bench is the user's call: `scope` is
 * either "all" or "chosen", and a chosen tool reads its workspaces from
 * `tool_workspaces`.
 *
 * The shipped ones are seeded into the table on first run, exactly as packs
 * are, so from then on they are rows like any other — recategorised, assigned,
 * or switched off.
 */

export type StoredTool = Tool & {
  scope: "all" | "chosen";
  enabled: boolean;
  position: number;
  /** Workspace ids, when scope is "chosen". Empty otherwise. */
  workspaces: string[];
  updatedAt: string;
};

type Row = Record<string, unknown>;

const map = (r: Row, workspaces: string[]): StoredTool => ({
  slug: String(r.slug) as Tool["slug"],
  name: String(r.name),
  tagline: String(r.tagline ?? ""),
  takes: String(r.takes ?? ""),
  returns: String(r.returns ?? ""),
  feeds: String(r.feeds ?? ""),
  runtime: String(r.runtime ?? ""),
  category: String(r.category ?? "Research"),
  scope: r.scope === "chosen" ? "chosen" : "all",
  enabled: r.enabled !== false,
  position: Number(r.position ?? 0),
  workspaces,
  updatedAt: iso(r.updated_at),
});

/** Every tool, with the workspaces each is assigned to. */
export async function listTools(): Promise<StoredTool[]> {
  const [rows, links] = await Promise.all([
    q<Row>("SELECT * FROM tools ORDER BY position, slug"),
    q<{ tool_slug: string; workspace_id: string }>(
      "SELECT tool_slug, workspace_id FROM tool_workspaces",
    ),
  ]);

  const by = new Map<string, string[]>();
  for (const l of links) {
    const list = by.get(l.tool_slug) ?? [];
    list.push(l.workspace_id);
    by.set(l.tool_slug, list);
  }

  return rows.map((r) => map(r, by.get(String(r.slug)) ?? []));
}

/**
 * The tools one workspace should see.
 *
 * Filtered here rather than in the browser: the bench is what this workspace
 * can do, and a card that is hidden by a client-side filter is still in the
 * payload for anyone who looks.
 */
export async function toolsFor(workspaceId: string): Promise<StoredTool[]> {
  const all = await listTools();
  return all.filter(
    (t) =>
      t.enabled &&
      (t.scope === "all" || t.workspaces.includes(workspaceId)),
  );
}

export async function getTool(slug: string): Promise<StoredTool | null> {
  const row = await one<Row>("SELECT * FROM tools WHERE slug = $1", [slug]);
  if (!row) return null;
  const links = await q<{ workspace_id: string }>(
    "SELECT workspace_id FROM tool_workspaces WHERE tool_slug = $1",
    [slug],
  );
  return map(
    row,
    links.map((l) => l.workspace_id),
  );
}

export type ToolPatch = Partial<
  Pick<StoredTool, "name" | "tagline" | "category" | "scope" | "enabled"> & {
    workspaces: string[];
  }
>;

export async function updateTool(
  slug: string,
  patch: ToolPatch,
): Promise<StoredTool | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.tagline !== undefined) set("tagline", patch.tagline);
  if (patch.category !== undefined) set("category", patch.category);
  if (patch.scope !== undefined) set("scope", patch.scope);
  if (patch.enabled !== undefined) set("enabled", patch.enabled);

  if (sets.length) {
    sets.push("updated_at = now()");
    values.push(slug);
    const rows = await q(
      `UPDATE tools SET ${sets.join(", ")} WHERE slug = $${values.length}`,
      values,
    );
    if (!rows) return null;
  }

  /*
   * The assignment is replaced wholesale, not merged.
   *
   * The screen sends the set of workspaces it is showing ticked, so a merge
   * would make unticking one do nothing — the one edit most likely to be made
   * on a screen whose whole purpose is choosing where a tool appears.
   */
  if (patch.workspaces) {
    await q("DELETE FROM tool_workspaces WHERE tool_slug = $1", [slug]);
    for (const id of patch.workspaces) {
      await q(
        `INSERT INTO tool_workspaces (tool_slug, workspace_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [slug, id],
      );
    }
    await q("UPDATE tools SET updated_at = now() WHERE slug = $1", [slug]);
  }

  return getTool(slug);
}

const SEEDED_KEY = "seededTools";

/**
 * The shipped tools, written into the table so they are ordinary rows.
 *
 * Introduced once each, tracked by slug — the same rule the packs use, and for
 * the same reason: a tool switched off or reassigned must stay that way on the
 * next reload, while a tool added in a future release still arrives.
 *
 * Only the columns that describe the tool are seeded. What it DOES stays in
 * code: a tool is a screen and a service, and a row that could rename its slug
 * would be a row pointing at nothing.
 */
export async function seedTools() {
  const seeded = await getRaw<string[]>(SEEDED_KEY, []);
  const fresh = BUILTIN.filter((t) => !seeded.includes(t.slug));
  if (!fresh.length) return 0;

  for (const [i, t] of fresh.entries()) {
    await q(
      `INSERT INTO tools
         (slug, name, tagline, takes, returns, feeds, runtime, category, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               (SELECT COALESCE(MAX(position), -1) + 1 + $9 FROM tools))
       ON CONFLICT (slug) DO NOTHING`,
      [
        t.slug,
        t.name,
        t.tagline,
        t.takes,
        t.returns,
        t.feeds,
        t.runtime,
        t.category,
        i,
      ],
    );
  }

  await setRaw(SEEDED_KEY, [...seeded, ...fresh.map((t) => t.slug)]);
  return fresh.length;
}
