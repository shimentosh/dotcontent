import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { one, q } from "@/lib/server/db/client";

/**
 * Preferences, and the secrets that go with them.
 *
 * One row per key, so adding a preference is an INSERT rather than a
 * migration. Everything in here belongs to the person rather than to the
 * content, which is why it is not hung off a workspace.
 */

export type Settings = {
  /** What a new run starts on. */
  quality: string;
  /** Whether a finished section is approved without being read. */
  autoApprove: boolean;
  /** Stops the aurora drifting and shortens transitions. */
  reduceMotion: boolean;
};

/*
 * `brain`, `enabled` and `cliCanReadFrames` used to live here, and each was a
 * different kind of wrong. See migration 0016 and docs/WORKER.md.
 *
 * This table is one row per key for the WHOLE console — there is no scope
 * column and there never was one. That was right for one person on one
 * laptop, and on a server with four teammates it meant a value that is a fact
 * about one thing was being read as though it were a fact about everything:
 *
 * - `brain` is a fact about the CONTENT. It is on `workspaces` now, beside
 *   `brand_voice`, so the Bangla-script brand and the SEO-copy brand can want
 *   different models without either changing under the other.
 * - `enabled` is a fact about a MACHINE. "yt-dlp is switched off" is true of
 *   one desktop; it is `workers.enabled`, evaluated by the worker against its
 *   own row.
 * - `cliCanReadFrames` is a fact about a FILESYSTEM. It grants the Read tool
 *   on one specific person's disk, so a global that let a teammate turn it on
 *   from the other side of the office was not a setting, it was a hole. It is
 *   `workers.can_read_frames`, which defaults OFF where this defaulted ON —
 *   on purpose, and not a mismatch to be tidied away.
 *
 * What is left is genuinely console-wide, or wants to be per-user one day,
 * which is a separate argument this move does not force.
 */

/*
 * `languages` and `connected` used to live here.
 *
 * Languages are a property of a BRAND, not of the console: two workspaces in
 * this database publish in different ones, and a single global list could only
 * ever be right for one of them. They are on the workspace, where they were
 * already being edited and shown.
 *
 * `connected` was a hand-set flag for services nothing could probe. Everything
 * on the integrations page is probed now, so a flag saying otherwise is a way
 * to make the page lie.
 */

export const DEFAULTS: Settings = {
  // One of QUALITIES in lib/data — "Standard" was not, so the picker opened
  // with nothing selected and no segment looked like the current setting.
  quality: "Balanced",
  autoApprove: false,
  reduceMotion: false,
};

export async function getSettings(): Promise<Settings> {
  const rows = await q<{ key: string; value: unknown }>(
    "SELECT key, value FROM settings",
  );
  const out = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key in out) {
      (out as Record<string, unknown>)[r.key] = r.value;
    }
  }
  return out;
}

export async function setSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS) || value === undefined) continue;
    await q(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  return getSettings();
}

/**
 * A setting that is bookkeeping rather than a preference.
 *
 * Kept out of `Settings` because nothing on the settings screen should offer
 * to edit it, and `getSettings` only copies keys it already knows — which is
 * what stops an internal key leaking into the API's response by accident.
 */
export async function getRaw<T>(key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return row ? row.value : fallback;
}

export async function setRaw(key: string, value: unknown) {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/* ── Secrets ────────────────────────────────────────────────────────────── */

/**
 * Service API keys, encrypted at rest.
 *
 * They were held in a Map in the browser, which meant the server — the only
 * thing that could ever spend them — never saw one. Now they are rows, and
 * AES-256-GCM around them so a database dump is not a list of live keys.
 *
 * The encryption key comes from CONTENTOS_SECRET. Without one set, a key
 * derived from the connection string is used, which is honest about what it
 * protects: someone who can already read this database can read these too.
 * It is still worth doing, because a `pg_dump` in a backup folder is a much
 * more likely leak than a compromised host.
 */
const SECRET = createHash("sha256")
  .update(
    process.env.CONTENTOS_SECRET ??
      process.env.DATABASE_URL ??
      "contentos-development-only",
  )
  .digest();

/**
 * Refuses to run a server on the development fallback.
 *
 * Deriving the key from DATABASE_URL is fine on a laptop, where the
 * connection string never changes. On a real deployment it is a trap: rotate
 * the database password and every stored key is suddenly encrypted under a
 * value nothing can reproduce. `decrypt` returns "" for anything it cannot
 * open, so nothing errors — the keys simply stop being there, and it reads to
 * whoever owns the box as "the console lost my keys" rather than "the secret
 * changed". Better to refuse to boot while it is still one env var away from
 * being right.
 *
 * Called from ready() in lib/server/http.ts, before the port opens. Only in
 * production: `npm run dev` keeps the fallback and needs no configuration.
 */
export function assertSecret() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.CONTENTOS_SECRET?.trim()) return;
  throw new Error(
    "CONTENTOS_SECRET is not set. Set it to a long random string and keep it " +
      "constant for the life of this deployment — it is the key that encrypts " +
      "stored API keys. Without it the key is derived from DATABASE_URL, so " +
      "rotating the database password would make every saved key unreadable, " +
      "silently. Note that keys saved under a different value cannot be read " +
      "back with a new one and will have to be entered again.",
  );
}

const SECRET_PREFIX = "secret:";

function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SECRET, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(".");
}

function decrypt(packed: string) {
  const [ivB64, tagB64, bodyB64] = packed.split(".");
  if (!ivB64 || !tagB64 || !bodyB64) return "";
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      SECRET,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A key written under a different CONTENTOS_SECRET cannot be read back.
    // Returning "" makes it look absent, which is what it effectively is.
    return "";
  }
}

export async function setSecret(id: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return clearSecret(id);
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [SECRET_PREFIX + id, JSON.stringify(encrypt(trimmed))],
  );
}

export async function clearSecret(id: string) {
  await q("DELETE FROM settings WHERE key = $1", [SECRET_PREFIX + id]);
}

/** The real key. Server-side only — nothing returns this to a browser. */
export async function getSecret(id: string) {
  const row = await one<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [SECRET_PREFIX + id],
  );
  return row ? decrypt(row.value) : "";
}

/** What a key looks like from the outside: enough to tell two apart. */
export function mask(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(10)}${value.slice(-4)}`;
}

/** Every stored key, masked. The shape the settings screen renders. */
export async function listSecrets(): Promise<Record<string, string>> {
  const rows = await q<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE $1",
    [SECRET_PREFIX + "%"],
  );
  const out: Record<string, string> = {};
  for (const r of rows) {
    const plain = decrypt(r.value);
    if (plain) out[r.key.slice(SECRET_PREFIX.length)] = mask(plain);
  }
  return out;
}
