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

/** The session id off the cookie, valid or not — logout needs it either way. */
export const SessionId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<SessionRequest>().sessionId,
);
