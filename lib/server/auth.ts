import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { id, iso, one, q } from "@/lib/server/db/client";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Who is using this console.
 *
 * One owner, made by the first signup, and the console closes to new accounts
 * after that. This is one operator's own tool — every workspace, pack and run
 * in the database belongs to whoever is at the keyboard, so a second account
 * would either see all of it (which is not a second account) or none of it
 * (which is not this app). Closing signup says that plainly instead.
 */

export { SESSION_COOKIE };

const SESSION_DAYS = 30;

export type User = {
  id: string;
  email: string;
  name: string;
  owner: boolean;
  createdAt: string;
  lastSeenAt: string;
};

type Row = Record<string, unknown>;

const map = (r: Row): User => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name ?? ""),
  owner: Boolean(r.owner),
  createdAt: iso(r.created_at),
  lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : "",
});

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ── Passwords ──────────────────────────────────────────────────────────── */

const KEYLEN = 64;

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    // scrypt rather than a hashing library: it is in node:crypto, it is
    // memory-hard by design, and it costs nothing to keep up to date.
    scrypt(password.normalize("NFKC"), salt, KEYLEN, (e, key) =>
      e ? reject(e) : resolve(key),
    );
  });

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = await derive(password, Buffer.from(saltHex, "hex"));
  const expected = Buffer.from(keyHex, "hex");
  // Compared in constant time: a plain === leaks how much of the hash matched
  // through how long it took to say no.
  if (expected.length !== key.length) return false;
  return timingSafeEqual(expected, key);
}

/**
 * What a password has to be before it is accepted.
 *
 * Length over character classes. A twelve-character passphrase beats "P@ss1!"
 * on every measure that matters, and rules demanding a symbol mostly produce
 * a symbol on the end.
 */
export function passwordProblem(password: string) {
  if (password.length < 10) return "Use at least 10 characters";
  if (password.length > 200) return "That is longer than 200 characters";
  if (!password.trim()) return "A password cannot be only spaces";
  return "";
}

export function emailProblem(email: string) {
  const value = email.trim();
  if (!value) return "An email address is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That is not an email address";
  return "";
}

/* ── Accounts ───────────────────────────────────────────────────────────── */

export async function countUsers() {
  const row = await one<{ n: string }>("SELECT COUNT(*)::int AS n FROM users");
  return Number(row?.n ?? 0);
}

/** True while the console has no owner — the only time signup is open. */
export const signupOpen = async () => (await countUsers()) === 0;

/** Everyone with an account, for the Team panel. */
export async function listUsers(): Promise<User[]> {
  const rows = await q<Row>(
    "SELECT * FROM users ORDER BY owner DESC, created_at",
  );
  return rows.map(map);
}

/**
 * Take someone's access away.
 *
 * Their sessions go with the row, so it takes effect on their next request
 * rather than whenever they happen to sign out. The owner cannot be removed
 * and nobody can remove themselves: both leave a console with no way back in,
 * and an invite-only signup means nobody could make a new owner either.
 *
 * What they wrote stays. Runs and topics belong to the workspace, not to the
 * person who pressed the button.
 */
export async function removeUser(id: string, actingAs: string) {
  if (id === actingAs) throw new AuthError("You cannot remove yourself", 400);

  const row = await one<{ owner: boolean }>(
    "SELECT owner FROM users WHERE id = $1",
    [id],
  );
  if (!row) return false;
  if (row.owner) throw new AuthError("The owner cannot be removed", 400);

  const gone = await q("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
  return gone.length > 0;
}

/* ── Invitations ────────────────────────────────────────────────────────── */

export type Invite = {
  token: string;
  email: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  /** Live, spent, or out of time — one word, worked out on read. */
  state: "open" | "used" | "expired";
};

const mapInvite = (r: {
  token: string;
  email: string;
  note: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}): Invite => ({
  token: r.token,
  email: r.email,
  note: r.note,
  createdAt: iso(r.created_at),
  expiresAt: iso(r.expires_at),
  usedAt: r.used_at ? iso(r.used_at) : null,
  state: r.used_at
    ? "used"
    : new Date(r.expires_at).getTime() < Date.now()
      ? "expired"
      : "open",
});

/**
 * A token nobody can guess.
 *
 * 32 bytes of randomness in base64url: the link is the whole credential, so
 * it has to be long enough that trying tokens is pointless, and short enough
 * that it survives being pasted into a chat message.
 */
const inviteToken = () =>
  randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function createInvite(input: {
  createdBy: string;
  email?: string;
  note?: string;
  days?: number;
}): Promise<Invite> {
  const days = Math.min(Math.max(input.days ?? 14, 1), 90);
  const row = await one<never>(
    `INSERT INTO invites (token, email, note, created_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)
     RETURNING *`,
    [
      inviteToken(),
      (input.email ?? "").trim().toLowerCase(),
      (input.note ?? "").trim(),
      input.createdBy,
      String(days),
    ],
  );
  return mapInvite(row!);
}

export async function listInvites(): Promise<Invite[]> {
  const rows = await q<never>(
    "SELECT * FROM invites ORDER BY created_at DESC LIMIT 100",
  );
  return rows.map(mapInvite);
}

export async function revokeInvite(token: string) {
  const rows = await q(
    "DELETE FROM invites WHERE token = $1 AND used_at IS NULL RETURNING token",
    [token],
  );
  return rows.length > 0;
}

/** The invite this token names, if it is still good for one signup. */
async function openInvite(token: string) {
  const row = await one<{ token: string; email: string }>(
    "SELECT token, email FROM invites WHERE token = $1 AND used_at IS NULL AND expires_at > now()",
    [token],
  );
  return row ?? null;
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
  /** An invite token, for everyone after the owner. */
  invite?: string;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const problem = emailProblem(email) || passwordProblem(input.password);
  if (problem) throw new AuthError(problem, 400);

  const first = (await countUsers()) === 0;

  /*
   * Two ways in, and only two: be the first, or hold an invite.
   *
   * The invite is checked and spent inside the same call that writes the user,
   * so a link cannot be redeemed twice by two people racing it — the second
   * finds it already used.
   */
  let invite: { token: string; email: string } | null = null;
  if (!first) {
    invite = input.invite ? await openInvite(input.invite) : null;
    if (!invite) {
      throw new AuthError(
        input.invite
          ? "That invite has been used or has expired. Ask for a new one."
          : "This console is invite-only. Ask its owner for a link.",
        403,
      );
    }
    if (invite.email && invite.email !== email) {
      throw new AuthError(`That invite is for ${invite.email}.`, 403);
    }
  }

  const row = await one<Row>(
    `INSERT INTO users (id, email, name, password_hash, owner)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      id("usr"),
      email,
      input.name?.trim() || email.split("@")[0],
      await hashPassword(input.password),
      first,
    ],
  );

  if (invite) {
    await q(
      "UPDATE invites SET used_at = now(), used_by = $1 WHERE token = $2",
      [row!.id, invite.token],
    );
  }

  return map(row!);
}

export async function findByEmail(email: string) {
  return one<Row>("SELECT * FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
}

export async function authenticate(email: string, password: string) {
  const row = await findByEmail(email);
  /*
   * The same message either way.
   *
   * "No account with that email" tells whoever is guessing which half to keep
   * — it turns a login form into a way to enumerate who has an account here.
   */
  const wrong = new AuthError("That email and password do not match", 401);
  if (!row) {
    // Still spend the time. Answering an unknown email instantly is the same
    // disclosure by another route.
    await derive(password, Buffer.alloc(16));
    throw wrong;
  }
  if (!(await verifyPassword(password, String(row.password_hash)))) throw wrong;
  await q("UPDATE users SET last_seen_at = now() WHERE id = $1", [row.id]);
  return map(row);
}

export async function updatePassword(
  userId: string,
  current: string,
  next: string,
) {
  const row = await one<Row>("SELECT * FROM users WHERE id = $1", [userId]);
  if (!row) throw new AuthError("No such account", 404);
  if (!(await verifyPassword(current, String(row.password_hash)))) {
    throw new AuthError("Your current password is wrong", 401);
  }
  const problem = passwordProblem(next);
  if (problem) throw new AuthError(problem, 400);

  await q("UPDATE users SET password_hash = $1 WHERE id = $2", [
    await hashPassword(next),
    userId,
  ]);
  // Every other session goes: changing a password is what you do when you
  // think someone else has it, and leaving their cookie working defeats it.
  await q("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

export async function startSession(userId: string, agent: string) {
  // 32 random bytes, stored as the primary key. Not a JWT: the whole point of
  // a session row is that deleting it logs someone out, and a signed token
  // that verifies itself cannot be taken away.
  const sid = randomBytes(32).toString("base64url");
  await q(
    `INSERT INTO sessions (id, user_id, agent, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [sid, userId, agent.slice(0, 300), String(SESSION_DAYS)],
  );
  return sid;
}

export async function endSession(sid: string) {
  await q("DELETE FROM sessions WHERE id = $1", [sid]);
}

export async function sessionUser(sid: string): Promise<User | null> {
  if (!sid) return null;
  const row = await one<Row>(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sid],
  );
  return row ? map(row) : null;
}

export async function listSessions(userId: string, currentId: string) {
  const rows = await q<Row>(
    "SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC",
    [userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    agent: String(r.agent ?? ""),
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    current: String(r.id) === currentId,
  }));
}

/** Everything except the one asking. Signing out elsewhere, in one call. */
export async function endOtherSessions(userId: string, keep: string) {
  const rows = await q(
    "DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id",
    [userId, keep],
  );
  return rows.length;
}

/** Expired rows are dead weight; cleared whenever a session is read. */
export const sweepSessions = () =>
  q("DELETE FROM sessions WHERE expires_at <= now()");

/* ── The current request ────────────────────────────────────────────────── */

/*
 * Framework-neutral on purpose.
 *
 * These used to read Next's cookie jar themselves, which tied the whole auth
 * module to one runtime. The NestJS API and the Next route handlers each know
 * how to get the cookie out of their own request; what they share is what to
 * do with it, which is this.
 */

/** The user behind a session id, or null. */
export async function currentUser(sid: string) {
  return sessionUser(sid);
}

/** The user, or a 401 the caller turns into a response. */
export async function requireUser(sid: string) {
  const user = await currentUser(sid);
  if (!user) throw new AuthError("Sign in first", 401);
  return user;
}

export const cookieOptions = (maxAgeDays = SESSION_DAYS) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // Off on localhost or the cookie is never sent back over plain http, which
  // looks exactly like a login that silently does not work.
  secure: process.env.NODE_ENV === "production",
  maxAge: maxAgeDays * 24 * 60 * 60,
});
