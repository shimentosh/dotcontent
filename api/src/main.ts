import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";

import { ready } from "@/lib/server/http";
import { resumeOrphans } from "@/lib/server/services/runs";

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

  // Whatever the last process was writing when it stopped, this one finishes.
  const resumed = await resumeOrphans();
  if (resumed.length) {
    console.log(`Resuming ${resumed.length} run(s) left mid-write: ${resumed.join(", ")}`);
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Content OS API on http://localhost:${port}/api`);
}

void main();
