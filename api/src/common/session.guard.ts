import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import {
  SESSION_COOKIE,
  SESSION_SCHEME,
  sessionFromHeader,
  sessionUser,
  type User,
} from "@/lib/server/auth";

export { SESSION_SCHEME, sessionFromHeader };

/** Marks a handler reachable without a session — the sign-in routes. */
export const PUBLIC = "dotcontent:public";
export const Public = () => SetMetadata(PUBLIC, true);

/** The request, once the guard has run: the user rides on it. */
export type SessionRequest = Request & { user?: User; sessionId: string };

/**
 * The lock on every route.
 *
 * Reads the session off the request, looks it up, and puts the user on the
 * request for `@CurrentUser()`. Global, so a new controller is closed by
 * default: the audit found fifteen Next route handlers that each had to
 * remember to call `requireUser()`, and did not.
 *
 * A route that must be open — login, signup, the "is signup open" probe —
 * says so with `@Public()`. The session id is put on the request either way,
 * because logout needs it whether or not the session is still valid.
 *
 * ## Two transports, one session
 *
 * The cookie is how a browser carries it, and nothing about that path changed:
 * same name, same options in `common/cookie.ts`, same behaviour for the web
 * app on `WEB_ORIGIN`.
 *
 * The header exists because the desktop app is not a browser. Its webview is
 * on a local origin (`tauri://localhost`) and the API is on somebody's server,
 * which makes the session cookie a *third-party* cookie — exactly the thing
 * webviews and browsers are progressively refusing, and a thing this app would
 * have to keep working across four Chromium releases it does not control. The
 * app therefore holds the session id itself, in the OS credential store beside
 * the worker token, and attaches it deliberately to each request. The team's
 * plan is that only this API is deployed, with no hosted console to visit, so
 * "mint a token in Settings → Machines and paste it" stopped being an
 * instruction anybody could follow; the app signs in with an email and a
 * password instead and enrols itself through `POST /api/machines`.
 *
 * **This is not a new principal, and it cannot reach anything a signed-in
 * browser could not.** There is one lookup, `sessionUser`, and it is the same
 * call the cookie path makes: the same `sessions` row, the same `expires_at`,
 * the same user. Everything that ends a session ends this one too — Settings →
 * Team deleting a person's rows, "sign out everywhere" through
 * `endOtherSessions`, a password change deleting all of them, `endSession` on
 * logout, and the expiry sweep. Nothing here mints anything, nothing here
 * extends a lifetime, and there is no branch anywhere that asks which
 * transport a session arrived on — which is the point: a second code path that
 * decided *authorisation* differently would be a second thing to audit, and
 * would be the one that drifts.
 *
 * What it genuinely does widen, said plainly: a session id now lives somewhere
 * other than a cookie jar. A cookie is `httpOnly`, so script on the console
 * cannot read it; a header value is held by whatever client sends it. That is
 * why the desktop app keeps it in Windows Credential Manager rather than in
 * `settings.json` next to the addresses, and why it never puts it in the
 * webview's DOM. The console itself must keep using the cookie and does.
 *
 * The other direction is closed by construction. A worker token in a `Session`
 * header is not a session id — `sessions` has no such row and `sessionUser`
 * answers null. A session id in a `Bearer` header is not a worker — `WorkerGuard`
 * hashes it and finds nothing in `workers`. Neither credential becomes the
 * other by being sent under the wrong scheme; both simply fail.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<SessionRequest>();

    /*
     * The header first, and the cookie only when there is no `Session` header
     * at all.
     *
     * The explicit credential beats the ambient one. A cookie is sent by the
     * browser whether or not this request meant to use it; a header is what
     * this client chose to authenticate as, and a client holding both — a
     * webview that once signed in on the API's own origin, an app being
     * debugged against a console in the same browser profile — means the one
     * it attached.
     *
     * `||` falls through only when the header is absent or is somebody else's
     * scheme, never when it is a `Session` header carrying a value that turns
     * out to be dead. A bad header is a failed request, not a quiet promotion
     * to whichever session the cookie jar happens to hold.
     */
    req.sessionId =
      sessionFromHeader(req.headers?.authorization) ||
      String(req.cookies?.[SESSION_COOKIE] ?? "");

    const open = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const user = req.sessionId ? await sessionUser(req.sessionId) : null;
    if (user) req.user = user;
    if (open) return true;

    if (!user) throw new UnauthorizedException("Sign in first");
    return true;
  }
}
