import { id, iso, one, q } from "@/lib/server/db/client";

/**
 * Workspaces — a brand, and everything under it.
 *
 * Rows in, objects out. Nothing above this layer sees a column name, and
 * nothing in it decides policy: that belongs to the services.
 */

/**
 * What a workspace writes with when nobody has said otherwise.
 *
 * Lives here rather than in the settings repo because the choice is a
 * property of the workspace now: `settings.brain` was one row for the whole
 * console, so two brands in one database could not want different models —
 * see migration 0016. Exported so the run service and the integrations page
 * fall back to the same id instead of each spelling one out.
 */
export const DEFAULT_BRAIN = "claude-cli";

export type Workspace = {
  id: string;
  name: string;
  handle: string;
  channel: string;
  status: string;
  goal: string;
  brandVoice: string;
  /**
   * Which model writes for this brand. An integration id.
   *
   * Editorial, not hardware: the Bangla-script workspace and the SEO-copy one
   * may reasonably want different models, and neither should change under the
   * other because somebody switched a global. It sits beside `brandVoice` for
   * exactly that reason.
   */
  brain: string;
  /**
   * May the server spend an API key when no machine can take the work?
   *
   * Off, and off is the feature. The whole worker split exists so a run costs
   * a subscription somebody already pays for rather than money per token, and
   * a fallback that fired whenever nobody's laptop was open would spend that
   * money precisely when nobody was watching. Turning it on is a deliberate
   * act, per workspace, by somebody who knows what it costs — which is why it
   * cannot be a global either.
   */
  apiFallback: boolean;
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
  // Empty only on a hand-edited row — the column has a default and 0016
  // filled every existing row — but an empty brain id would reach findBrain()
  // and fail a run with "No model called", which is a confusing sentence
  // about a column nobody typed into.
  brain: String(r.brain || DEFAULT_BRAIN),
  apiFallback: r.api_fallback === true,
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
       (id, name, handle, channel, status, goal, brand_voice, brain,
        api_fallback, langs, tint, photo, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12,
             COALESCE($13, (SELECT COALESCE(MAX(position), -1) + 1 FROM workspaces)))
     RETURNING *`,
    [
      patch.id || id("ws"),
      patch.name ?? "New workspace",
      patch.handle ?? "",
      patch.channel ?? "",
      patch.status ?? "Planning",
      patch.goal ?? "",
      patch.brandVoice ?? "",
      patch.brain || DEFAULT_BRAIN,
      // Never inherited from another workspace and never on by default: a new
      // brand must not arrive already able to spend money unattended.
      patch.apiFallback ?? false,
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
  if (patch.brain !== undefined) set("brain", patch.brain || DEFAULT_BRAIN);
  if (patch.apiFallback !== undefined) set("api_fallback", patch.apiFallback);
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
