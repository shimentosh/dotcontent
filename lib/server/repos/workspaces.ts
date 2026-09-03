import { id, iso, one, q } from "@/lib/server/db/client";

/**
 * Workspaces — a brand, and everything under it.
 *
 * Rows in, objects out. Nothing above this layer sees a column name, and
 * nothing in it decides policy: that belongs to the services.
 */

export type Workspace = {
  id: string;
  name: string;
  handle: string;
  channel: string;
  status: string;
  goal: string;
  brandVoice: string;
  langs: string[];
  tint: string;
  photo: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const map = (r: Row): Workspace => ({
  id: String(r.id),
  name: String(r.name),
  handle: String(r.handle ?? ""),
  channel: String(r.channel ?? ""),
  status: String(r.status ?? "Planning"),
  goal: String(r.goal ?? ""),
  brandVoice: String(r.brand_voice ?? ""),
  // jsonb comes back already parsed; the guard is for a hand-edited row.
  langs: Array.isArray(r.langs) ? (r.langs as string[]) : [],
  tint: String(r.tint ?? ""),
  photo: r.photo == null ? null : String(r.photo),
  position: Number(r.position ?? 0),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export async function listWorkspaces(): Promise<Workspace[]> {
  return (
    await q<Row>("SELECT * FROM workspaces ORDER BY position, created_at")
  ).map(map);
}

export async function getWorkspace(wid: string): Promise<Workspace | null> {
  const row = await one<Row>("SELECT * FROM workspaces WHERE id = $1", [wid]);
  return row ? map(row) : null;
}

export async function createWorkspace(
  patch: Partial<Workspace>,
): Promise<Workspace> {
  const row = await one<Row>(
    `INSERT INTO workspaces
       (id, name, handle, channel, status, goal, brand_voice, langs, tint,
        photo, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
             COALESCE($11, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces)))
     RETURNING *`,
    [
      patch.id || id("ws"),
      patch.name ?? "New workspace",
      patch.handle ?? "",
      patch.channel ?? "",
      patch.status ?? "Planning",
      patch.goal ?? "",
      patch.brandVoice ?? "",
      JSON.stringify(patch.langs ?? []),
      patch.tint ?? "",
      patch.photo ?? null,
      patch.position ?? null,
    ],
  );
  return map(row!);
}

/** Only the fields present are written — an absent key means "leave it". */
export async function updateWorkspace(
  wid: string,
  patch: Partial<Workspace>,
): Promise<Workspace | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${col} = $${values.length}${cast}`);
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.handle !== undefined) set("handle", patch.handle);
  if (patch.channel !== undefined) set("channel", patch.channel);
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.goal !== undefined) set("goal", patch.goal);
  if (patch.brandVoice !== undefined) set("brand_voice", patch.brandVoice);
  if (patch.langs !== undefined) set("langs", JSON.stringify(patch.langs), "::jsonb");
  if (patch.tint !== undefined) set("tint", patch.tint);
  if (patch.photo !== undefined) set("photo", patch.photo);
  if (patch.position !== undefined) set("position", patch.position);

  if (!sets.length) return getWorkspace(wid);

  sets.push("updated_at = now()");
  values.push(wid);
  const row = await one<Row>(
    `UPDATE workspaces SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return row ? map(row) : null;
}

export async function deleteWorkspace(wid: string) {
  // Series, topics and runs go with it — the cascades are in the schema, and
  // Postgres enforces them without a pragma to remember.
  const rows = await q<Row>(
    "DELETE FROM workspaces WHERE id = $1 RETURNING id",
    [wid],
  );
  return rows.length > 0;
}

export async function countWorkspaces() {
  const row = await one<{ n: string }>("SELECT COUNT(*)::int AS n FROM workspaces");
  return Number(row?.n ?? 0);
}
