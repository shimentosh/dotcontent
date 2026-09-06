import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { SessionRequest } from "./session.guard";

/**
 * The signed-in user, as a handler parameter.
 *
 * `@CurrentUser()` on a guarded route is never undefined — the guard has
 * already refused the request otherwise. On a `@Public()` route it may be
 * null, which is how /auth/me says "nobody" without failing.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<SessionRequest>().user ?? null,
);

/**
 * The session id, valid or not — logout needs it either way.
 *
 * From the cookie or from an `Authorization: Session …` header, whichever the
 * caller used: the guard resolves that before anything reads this, so a
 * handler never has to know which transport carried it. A browser sends the
 * cookie; the desktop app, whose webview is on a local origin against a remote
 * API, sends the header, because a cookie in that position is third-party and
 * is what webviews are progressively refusing.
 */
export const SessionId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<SessionRequest>().sessionId,
);
