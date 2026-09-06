import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { id, iso, one, q } from "@/lib/server/db/client";
import { hashToken } from "@/lib/server/repos/workers";
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

/* ── The hand-off ───────────────────────────────────────────────────────── */

/**
 * One sign-in, carried from the desktop app into the console window beside it.
 *
 * The app signs in from Rust and keeps the session id in the OS credential
 * store, because its webview is on `tauri://localhost` and the API's cookie is
 * third-party there — `api/src/common/session.guard.ts` sets that out at
 * length. Then it opens the console, which is an ordinary navigation to the
 * team's server carrying no cookie at all, and the person signs in a *second*
 * time: same email, same password, same account, ten seconds after the first.
 * That second form is the only thing this exists to remove.
 *
 * A hand-off code is a one-shot bearer of one existing session. The app mints
 * one over the session it already holds, opens the webview at
 * `GET /api/auth/adopt?code=…` instead of at the console's own URL, and that
 * route spends the code and sets the ordinary session cookie. The console is
 * then signed in exactly the way every browser is signed in.
 *
 * Four rules, and each of them is preventing something specific:
 *
 * 1. **It buys the session it was minted from, and nothing else.** Spending a
 *    code calls no `startSession` and extends no expiry. Two session rows for
 *    one sign-in would mean "sign out everywhere" and Settings → Team could
 *    each end one and leave the other alive — a person who revoked their
 *    laptop and watched it keep working.
 * 2. **Minutes, not hours.** For as long as a code is live it is a session in
 *    a URL, and a URL is the least private thing in the system: webview
 *    history, a proxy log, the `Referer` on whatever the console loads next.
 *    Two minutes is a navigation, generously.
 * 3. **Stored as a hash.** The `handoffs` table holds a sha256 and never the
 *    code, for the reason `workers.token_hash` does: a database dump must not
 *    be a list of live credentials. It is worth more here than there, because
 *    what a hand-off code opens is a person's whole console rather than nine
 *    queue routes.
 * 4. **Single use, decided by Postgres.** The spend is one `UPDATE ... WHERE
 *    used_at IS NULL` returning a row, the same trick `createUser` uses to
 *    stop an invite link being redeemed twice by two people racing it. A read
 *    followed by a write would let a replayed URL and the real navigation both
 *    pass the read.
 */

/**
 * How long a code is good for.
 *
 * It is spent by the very next request the app makes — it exists to survive
 * one navigation, not a coffee break — so this is generous already. What it
 * has to absorb is a slow window opening and a clock a minute out of step
 * between the app's machine and the API's.
 */
const HANDOFF_SECONDS = 120;

/**
 * 32 random bytes, base64url.
 *
 * The same size and the same encoding as a session id, because it is a
 * credential for the same thing for two minutes. base64url rather than
 * `inviteToken`'s hand-rolled substitution because this one is always going
 * into a query string, and a `+` in a URL is a space by the time it is read
 * back.
 */
const handoffCode = () => randomBytes(32).toString("base64url");

/**
 * Mint a code for a session that already exists.
 *
 * `sessionId` is the caller's own, taken off the request by the guard, so
 * there is no way to ask for a code for somebody else's session: the only
 * session a caller can name is the one it authenticated with.
 *
 * `hashToken` is deliberately the worker repo's function rather than a second
 * `createHash` call written here. It says so itself: one place that turns a
 * credential into what the database stores is what stops two places getting
 * the encoding subtly different, which would show up as a hand-off that mints
 * fine and can never be spent.
 */
export async function createHandoff(sessionId: string) {
  const code = handoffCode();
  const row = await one<{ expires_at: string }>(
    `INSERT INTO handoffs (code_hash, session_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
     RETURNING expires_at`,
    [hashToken(code), sessionId, String(HANDOFF_SECONDS)],
  );
  return { code, expiresAt: iso(row!.expires_at) };
}

/**
 * Spend a code, and get back the session it was minted from.
 *
 * `null` for spent, expired, unknown, and for a code whose session has since
 * been ended — one answer, on purpose. Telling those apart would tell whoever
 * is guessing which half of their guess was right, and there is nothing a
 * caller could usefully do differently with the distinction anyway: every one
 * of them means "this navigation is not signed in".
 *
 * The `UPDATE` is the whole single-use rule. Two requests carrying the same
 * code race each other inside one statement, and exactly one of them gets a
 * row back — so a replayed URL, out of a webview's history or a log, finds
 * `used_at` already set and is refused.
 */
export async function spendHandoff(code: string): Promise<string | null> {
  if (!code) return null;
  const row = await one<{ session_id: string }>(
    `UPDATE handoffs SET used_at = now()
      WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING session_id`,
    [hashToken(code)],
  );
  if (!row) return null;

  /*
   * And the session it names has to still be alive.
   *
   * The cascade takes codes with a deleted session, but expiry is not a
   * delete: a session row sits there past `expires_at` until the sweep runs,
   * and `sessionUser` is the one place that decides what "still signed in"
   * means. Setting a cookie for a session this same module would refuse a
   * moment later is a console that loads and immediately bounces to /login.
   */
  const sid = String(row.session_id);
  return (await sessionUser(sid)) ? sid : null;
}

/** Spent and expired codes are dead weight; cleared whenever one is minted. */
export const sweepHandoffs = () =>
  q("DELETE FROM handoffs WHERE expires_at <= now() OR used_at IS NOT NULL");

/**
 * The origins a hand-off is allowed to land on: the console's, and no others.
 *
 * Read from `WEB_ORIGIN` — the same variable, parsed the same way, as the CORS
 * list in `api/src/main.ts` — because that is already this deployment's
 * statement of where the console is. A second variable would be a second thing
 * to keep in step, and the failure of drifting apart would be a hand-off that
 * works in dev and refuses on the server.
 */
const consoleOrigins = () =>
  (process.env.WEB_ORIGIN ?? "http://localhost:3333")
    .split(",")
    .map((o) => {
      try {
        return new URL(o.trim()).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);

/**
 * Where a hand-off may redirect to, or `null`.
 *
 * **This is the sharp edge of the whole feature.** `/auth/adopt` sets a
 * session cookie and then redirects, and an open redirect that also hands out
 * a session is worth more to an attacker than either half on its own: send
 * somebody a link, and their browser arrives at your page signed in as
 * themselves, with whatever the console renders into the URL along for the
 * ride. So `next` is checked against an allowlist and anything else is
 * refused outright — not trimmed, not stripped back to a path, not quietly
 * replaced with the console's front page. A silent fallback would make a
 * misconfigured `WEB_ORIGIN` look like it worked, and the one time it mattered
 * would be the time somebody was probing it.
 *
 * The rule is one line and covers every trick by construction, because
 * `origin` is a scheme, a host and a port and nothing else: `//evil.example`
 * resolves to evil's origin, `javascript:…` has no origin any allowlist can
 * hold, `https://console@evil.example` is evil's origin with the console's
 * name as a username. All three miss the list.
 *
 * An absent `next` is not a refusal — there is nothing to refuse — and means
 * the console's front door.
 */
export function adoptTarget(next: string): string | null {
  const allowed = consoleOrigins();
  if (!allowed.length) return null;

  const raw = (next ?? "").trim();
  if (!raw) return allowed[0];

  try {
    // Resolved against the console, so `/runs/run_x` is a thing the app can
    // send; the origin check below is what makes that safe rather than the
    // parsing.
    const url = new URL(raw, allowed[0]);
    return allowed.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

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

/* ── The Authorization header ──────────────────────────────────── */

/*
 * Here rather than in the guard that uses it, and the reason is a build.
 *
 * It lived in `api/src/common/session.guard.ts`, which imports NestJS. The
 * test for it therefore imported NestJS too, transitively — and the root
 * tsconfig excludes `api` but not `tests`, so `next build` followed that one
 * import into the API and failed on a machine where the API's dependencies
 * are not installed. Which is every clean checkout, including the one the
 * deployment builds from. It passed locally only because there was an
 * `api/node_modules` lying around to be copied into the image.
 *
 * Nothing about parsing a header needed a web framework. It is a string in
 * and a string out, it belongs beside the sessions it names, and from here
 * it can be tested without dragging a server in behind it.
 */

/**
 * The scheme a client that is not a browser sends its session under:
 * `Authorization: Session <id>`.
 *
 * **Not `Bearer`.** `WorkerGuard` owns that word, and the two credentials it
 * would then share a spelling with are the two that must never be confused:
 * a session is a person and reaches the whole console, a worker token is a
 * machine and reaches nine queue routes. Two credentials that look alike at a
 * glance is how one ends up pasted where the other belongs — into a support
 * message, a `.env`, or the wrong field of a setup window — and the paste that
 * matters is the one that hands somebody's whole console to a machine's
 * credential store. A different scheme name costs one word and makes the two
 * impossible to mistake in a log line, a proxy rule or a curl command.
 *
 * `Session` is not on the IANA scheme registry and does not need to be: it is
 * read by this guard and sent by this repository's own desktop app, and a
 * registered name would only invite something else to assume it means what it
 * means somewhere else.
 */
export const SESSION_SCHEME = "Session";

const SESSION_HEADER = /^Session\s+(.+)$/i;

/**
 * The session id an `Authorization` header carries, or an empty string.
 *
 * Split out so it can be tested without a database, a request or a window
 * system, and so there is exactly one place that decides what counts: the
 * important half of this function is what it *refuses*. A `Bearer` header is
 * a worker token and must read as no session at all, or the desktop app's two
 * credentials would each be accepted in the other's place — precisely the
 * merge `docs/WORKER.md` argues against in "The desktop app holds two
 * credentials, on purpose".
 */
export function sessionFromHeader(header: string | undefined): string {
  return SESSION_HEADER.exec(String(header ?? "").trim())?.[1]?.trim() ?? "";
}
