import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import type { Request } from "express";

import { PUBLIC } from "./session.guard";
import { touchWorker, workerByToken, type Worker } from "@/lib/server/repos/workers";

/** Marks a handler as belonging to the worker protocol rather than the console. */
export const WORKER_ROUTE = "dotcontent:worker";

/** The request, once the guard has run: the machine rides on it. */
export type WorkerRequest = Request & {
  worker?: Worker;
  /** The raw bearer token, kept only for register, which re-hashes it. */
  workerToken?: string;
};

/**
 * The lock on the six worker endpoints.
 *
 * A bearer token, not the session cookie, and the reasons are in
 * `docs/WORKER.md`: a cookie is a browser mechanism the worker would have to
 * scrape out of a webview; sessions are deleted by Settings → Team, which is
 * the wrong lever for a machine; a session can read the entire console while a
 * worker needs six routes; and a headless process cannot be sent to
 * `/login?next=…`, which is what every 401 does to a browser.
 *
 * Hashing goes through `hashToken` inside `workerByToken` — the only
 * `createHash` in the codebase — so no controller can put a raw token in a
 * column, or hash it with a different encoding and produce a machine that
 * enrols and then can never claim anything.
 *
 * `last_seen_at` is touched here rather than in each handler because liveness
 * is a fact about the connection, not about which endpoint was called: a
 * machine that is heartbeating is awake whether or not it is holding work. The
 * write is deliberately not awaited. Liveness is a display notion, the claim
 * long-poll holds for twenty-five seconds either way, and an UPDATE on the
 * hot path of every request should not add a round trip to it.
 */
@Injectable()
export class WorkerGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<WorkerRequest>();

    const header = String(req.headers.authorization ?? "");
    const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() ?? "";
    // A session cookie must never satisfy a worker route. There is no fallback
    // here on purpose: the two credentials are different principals with
    // different lifetimes and different blast radii, and a guard that accepted
    // either would quietly merge them.
    if (!token) throw new UnauthorizedException("Worker token required");

    const worker = await workerByToken(token);
    if (!worker) throw new UnauthorizedException("Unknown worker token");

    req.worker = worker;
    req.workerToken = token;
    void touchWorker(worker.id).catch(() => {});
    return true;
  }
}

/**
 * The third decorator, beside `@Public()`.
 *
 * It does two things at once, and both are needed: it hangs `WorkerGuard` on
 * the handler, and it marks the route `PUBLIC` so the global `SessionGuard`
 * stands aside instead of refusing a request that carries no cookie. Standing
 * aside is all that means — `SessionGuard` still puts a session on the request
 * if one happens to be there, and `WorkerGuard` still demands the bearer
 * token, so a signed-in browser cannot reach these routes and a worker token
 * cannot reach anything else.
 *
 * Written as one decorator rather than the pair, because the pair is a thing
 * somebody would half-apply: `@Public()` without the guard is an open route,
 * and that is exactly the class of hole the global guard exists to close.
 */
export const WorkerRoute = () =>
  applyDecorators(
    SetMetadata(WORKER_ROUTE, true),
    SetMetadata(PUBLIC, true),
    UseGuards(WorkerGuard),
  );

/** The machine on the request. Never undefined inside a `@WorkerRoute()`. */
export const workerOf = (req: WorkerRequest): Worker => {
  if (!req.worker) throw new UnauthorizedException("Worker token required");
  return req.worker;
};
