import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { SESSION_COOKIE, sessionUser, type User } from "@/lib/server/auth";

/** Marks a handler reachable without a session — the sign-in routes. */
export const PUBLIC = "contentos:public";
export const Public = () => SetMetadata(PUBLIC, true);

/** The request, once the guard has run: the user rides on it. */
export type SessionRequest = Request & { user?: User; sessionId: string };

/**
 * The lock on every route.
 *
 * Reads the session cookie off the request, looks the session up, and puts
 * the user on the request for `@CurrentUser()`. Global, so a new controller
 * is closed by default: the audit found fifteen Next route handlers that
 * each had to remember to call `requireUser()`, and did not.
 *
 * A route that must be open — login, signup, the "is signup open" probe —
 * says so with `@Public()`. The session id is put on the request either way,
 * because logout needs it whether or not the session is still valid.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    req.sessionId = String(req.cookies?.[SESSION_COOKIE] ?? "");

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
