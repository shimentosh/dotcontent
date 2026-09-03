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
  /** The model that writes. An integration id. */
  brain: string;
  /**
   * Local tools allowed to run, by id. A tool that is installed but switched
   * off is skipped — which is how you get metadata without a 200MB download.
   */
  enabled: string[];
  /**
   * Whether the Claude CLI may open the frame files on this machine.
   *
   * Only Claude's: Codex is handed the picture with `-i` and Gemini opens the
   * one path it is given, neither of which grants the model anything. Claude
   * reads a still by being granted the Read TOOL for that call, which is a
   * different kind of permission from WebFetch, so it has its own switch.
   *
   * On by default, because this console runs off signed-in CLIs and the
   * alternative is not "safer", it is "the researcher does not work". The
   * switch stays so it can be turned off by whoever owns the machine.
   */
  cliCanReadFrames: boolean;
};

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
  brain: "claude-cli",
  enabled: ["yt-dlp", "ffmpeg", "ffprobe", "whisper"],
  cliCanReadFrames: true,
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
