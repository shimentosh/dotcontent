import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { SessionGuard } from "./common/session.guard";
import { AuthController } from "./auth/auth.controller";
import { WorkspacesController } from "./workspaces/workspaces.controller";
import {
  SeriesController,
  TopicsController,
} from "./series/series.controller";
import { PacksController } from "./packs/packs.controller";
import { ToolsController } from "./tools/tools.controller";
import { SettingsController } from "./settings/settings.controller";
import { IntegrationsController } from "./integrations/integrations.controller";
import { RunsController } from "./runs/runs.controller";
import { SourcesController } from "./sources/sources.controller";
import { ResearchController } from "./research/research.controller";
import { WorkersController } from "./workers/workers.controller";
import { Reaper } from "./workers/reaper";

/**
 * One module, because there is one database and one set of rules.
 *
 * Nest's usual shape is a module per feature, each with its own providers.
 * Here the "providers" are the functions in `lib/server` — repos and services
 * shared with the repo root — and a controller is a thin translation from HTTP
 * to those. Ten controllers in one module is honest about that; ten modules
 * each importing nothing would be ceremony.
 *
 * The session guard is global. Every route is behind it unless the handler
 * says otherwise with `@Public()` — the auth gap that the audit found was
 * fifteen routes that each had to remember a line, and a default that fails
 * closed cannot be forgotten.
 */
@Module({
  controllers: [
    AuthController,
    WorkspacesController,
    SeriesController,
    TopicsController,
    PacksController,
    ToolsController,
    SettingsController,
    IntegrationsController,
    RunsController,
    SourcesController,
    ResearchController,
    WorkersController,
  ],
  /*
   * The reaper is a provider rather than something started in `main`, so that
   * its interval is owned by the application: Nest constructs it once and,
   * with shutdown hooks on, clears it on the way out. A `setInterval` in
   * `main` would survive `app.close()` and hold a database pool open forever
   * in tests and on a dev reload.
   */
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }, Reaper],
})
export class AppModule {}
