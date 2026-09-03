import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";

import { DuplicateName } from "@/lib/server/repos/series";

/**
 * Every thrown thing, as the JSON the browser already understands.
 *
 * The same rules `caught()` in lib/server/http.ts applies for the Next
 * handlers, so the API answers identically whichever process is behind it:
 * `{ error }` with the status the service asked for, 503 with a sentence
 * when Postgres is not there, and `existing` beside the error on a duplicate
 * name so the screen can offer the merge.
 */

const OFFLINE =
  /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|Connection terminated|connect ECONN/i;

const isOffline = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  const message = e instanceof Error ? e.message : String(e);
  return OFFLINE.test(code) || OFFLINE.test(message);
};

@Catch()
export class ErrorsFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (e instanceof HttpException) {
      const body = e.getResponse();
      const message =
        typeof body === "string"
          ? body
          : ((body as { message?: string | string[] }).message ?? e.message);
      res.status(e.getStatus()).json({
        error: Array.isArray(message) ? message.join(", ") : message,
      });
      return;
    }

    if (e instanceof DuplicateName) {
      res.status(409).json({ error: e.message, existing: e.existing });
      return;
    }

    if (isOffline(e)) {
      res.status(503).json({
        error:
          "The database is not running. Start Docker Desktop, then run: npm run db:up",
      });
      return;
    }

    // AuthError, RunError, IngestError, ResearchError, FetchError all carry
    // the status they want; anything without one is a 500 with its message.
    const status =
      typeof e === "object" && e && "status" in e
        ? Number((e as { status: number }).status)
        : 500;
    res
      .status(Number.isFinite(status) && status >= 400 ? status : 500)
      .json({ error: e instanceof Error ? e.message : "Something went wrong" });
  }
}
