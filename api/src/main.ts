import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";

import { ready } from "@/lib/server/http";

import { AppModule } from "./app.module";
import { ErrorsFilter } from "./common/errors.filter";

/**
 * The Content OS API, as its own process.
 *
 * Everything the Next.js route handlers used to do, on its own port, reached
 * by the browser directly. It shares `lib/server` with the repo root — the
 * repos, the services, the run driver — so what changed is who answers HTTP,
 * not what happens underneath.
 *
 * Cross-origin on purpose: the web app is on one origin and this on another,
 * so CORS is on for exactly the origins named in WEB_ORIGIN, with credentials,
 * and the session cookie is what carries the session across.
 */
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The seed and the migrations log through here; Nest's own startup lines
    // are noise on a dev terminal that already has Next's.
    logger: ["error", "warn"],
  });

  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.useGlobalFilters(new ErrorsFilter());

  const origins = (process.env.WEB_ORIGIN ?? "http://localhost:3333")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // Uploads are streamed by the sources controller; nothing else needs a body
  // over a megabyte, and a JSON body that size is a bug being sent.
  app.useBodyParser("json", { limit: "1mb" });

  /*
   * Migrations and the seed before the first request, not on it.
   *
   * `ready()` is the same memoised seed the route handlers call; running it
   * here means a deploy that adds a column is never taking traffic against a
   * database that has not got it yet.
   */
  await ready();

  /*
   * Nothing at boot touches a section's state. This is where `resumeOrphans()`
   * used to run, requeueing every `writing` row on the reasoning that its
   * driver died with the last process. That was true while there was one
   * process and the model was its own child; once the writing happens on
   * somebody's laptop it is false, and a deploy would requeue a section a
   * machine was four minutes into — written twice, paid for twice, the second
   * answer overwriting the first. With two API replicas every boot would steal
   * the other's in-flight work.
   *
   * Migration 0015 swept the genuine orphans of the old world once, and that
   * was the last time. From here `jobs.lease_until` decides, per job, on
   * evidence — a lease that ran out — and the reaper acts on it.
   */

  // So the reaper's interval is cleared on SIGTERM rather than left holding a
  // database pool open while the container waits to be killed.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Content OS API on http://localhost:${port}/api`);
}

void main();
