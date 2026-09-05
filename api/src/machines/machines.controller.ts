import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";

import { listUsers, type User } from "@/lib/server/auth";
import {
  deleteWorker,
  getWorker,
  listWorkers,
  registerWorker,
  updateWorker,
  type Worker,
} from "@/lib/server/repos/workers";

import { CurrentUser } from "../common/user.decorator";

/**
 * The console's half of the worker split.
 *
 * Everything here is behind the global `SessionGuard` — a person, with a
 * cookie, on the Settings screen. It is emphatically NOT a worker route:
 * `api/src/workers/workers.controller.ts` is the machine's six endpoints and
 * every one of them is `@WorkerRoute()` with a bearer token. The two are
 * different principals on purpose (`docs/WORKER.md`, "The desktop app holds
 * two credentials"), so they are different controllers on different paths and
 * neither decorator appears on the other's file.
 *
 * What is here is the half a machine is deliberately not allowed to do for
 * itself: mint its credential, and set the switches its owner owns.
 */
@Controller("machines")
export class MachinesController {
  /**
   * Every machine, with whose it is.
   *
   * The owner's name is joined in here rather than being looked up by the
   * browser, because the picker's whole job is to let somebody choose a
   * machine and "Rakib's desktop" is the answer to "whose GPU am I about to
   * spend". `Worker.live` is already derived in the repo from `last_seen_at`,
   * so the page never has to know what the liveness window is.
   */
  @Get()
  async list(): Promise<Machine[]> {
    const [workers, users] = await Promise.all([listWorkers(), listUsers()]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return workers.map((worker) => decorate(worker, byId.get(worker.userId)));
  }

  /**
   * Enrol a machine: mint the token, hand it back exactly once.
   *
   * 256 bits from `node:crypto` — the same randomness the session ids use, and
   * not `Math.random`, because this is a credential that grants the queue. It
   * is returned in this one response body and never again: `registerWorker`
   * stores only its sha256, so a database dump is a list of machines, not a
   * list of live logins. Lose it and the answer is to revoke the row and mint
   * another, which costs one paste in the desktop app.
   *
   * The row is created by the same `registerWorker` the machine itself calls,
   * which is what makes the first real registration an UPDATE on this row
   * rather than a second one: enrolment and re-registration are the same
   * insert keyed on the same token hash. The machine has not spoken yet, so
   * `platform`, `version` and `tools` stay empty until it does — that emptiness
   * is what the panel reads as "waiting for this machine to check in".
   */
  @Post()
  async mint(
    @CurrentUser() user: User,
    @Body() body: { name?: string },
  ): Promise<{ machine: Machine; token: string }> {
    const name = (body.name ?? "").trim();
    if (!name) throw new BadRequestException("Give the machine a name");

    const token = `wrk_${randomBytes(32).toString("base64url")}`;
    const worker = await registerWorker({ userId: user.id, name, token });
    return { machine: decorate(worker, user), token };
  }

  /**
   * The owner's switches.
   *
   * `registerWorker` refuses to overwrite these when a machine re-registers,
   * on purpose — a worker restarting with its defaults must not hand itself
   * back a permission somebody switched off — which makes this route the only
   * place they are ever set. `tools` is not patchable for the mirror-image
   * reason: nobody types a binary into existence from a browser.
   *
   * `enabled` is intersected with what the machine actually reported, so a
   * stale form cannot leave a tool switched on that the machine has since
   * stopped advertising. The claim query would then hand it work it cannot
   * run, and the job would fail on somebody's laptop rather than here.
   */
  @Patch(":id")
  async patch(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      enabled?: string[];
      canReadFrames?: boolean;
      maxConcurrency?: number;
    },
  ): Promise<Machine> {
    const patch: Parameters<typeof updateWorker>[1] = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException("A machine needs a name");
      patch.name = name;
    }
    if (body.enabled !== undefined) {
      if (!Array.isArray(body.enabled))
        throw new BadRequestException("enabled must be a list of tool ids");
      const worker = await requireWorker(id);
      const advertised = new Set(worker.tools.map((tool) => tool.id as string));
      patch.enabled = body.enabled.map(String).filter((t) => advertised.has(t));
    }
    if (body.canReadFrames !== undefined)
      patch.canReadFrames = body.canReadFrames === true;
    if (body.maxConcurrency !== undefined) {
      const n = Number(body.maxConcurrency);
      if (!Number.isFinite(n)) throw new BadRequestException("A number, please");
      // Clamped in `updateWorker` as well; rejecting here would turn a stepper
      // held down into an error toast for something the repo already handles.
      patch.maxConcurrency = Math.round(n);
    }

    const saved = await updateWorker(id, patch);
    if (!saved) throw new NotFoundException("No such machine");

    const users = await listUsers();
    return decorate(saved, users.find((u) => u.id === saved.userId));
  }

  /**
   * Revoke: the row goes, and with it the only copy of the token's hash.
   *
   * There is no separate revoked flag because a hash that is not in the table
   * cannot authenticate, and a row that exists but is refused is a second
   * state to keep in sync with the first. Work the machine was holding is not
   * lost: `jobs.worker_id` is ON DELETE SET NULL, so a claimed job simply
   * loses its lease and the reaper puts it back in the queue for whoever is
   * next. What it will not do is come back on this machine.
   */
  @Delete(":id")
  async revoke(@Param("id") id: string) {
    const gone = await deleteWorker(id);
    if (!gone) throw new NotFoundException("That machine is already gone");
    return { ok: true };
  }
}

/**
 * A worker as the console reads it: the row, plus whose machine it is.
 *
 * The extra fields are display only. They are added here rather than in the
 * repo because `listWorkers` is also read by the claim path, which has no
 * interest in anybody's email address.
 */
export type Machine = Worker & {
  ownerName: string;
  ownerEmail: string;
  /** True until the machine itself has registered — nothing reported yet. */
  awaitingFirstContact: boolean;
};

const decorate = (worker: Worker, owner: User | undefined): Machine => ({
  ...worker,
  ownerName: owner?.name || owner?.email || "Unknown",
  ownerEmail: owner?.email ?? "",
  /*
   * A machine that has never spoken has no platform, no version and no tools,
   * because only `POST /api/workers/register` sets those. `last_seen_at` is
   * stamped by the mint itself — the enrolment row is written by the same
   * insert — so liveness alone would call a brand new row "live" for two
   * minutes and the page would be waiting for tools from something that has
   * not been started yet.
   */
  awaitingFirstContact: !worker.platform && !worker.version && !worker.tools.length,
});

async function requireWorker(id: string): Promise<Worker> {
  const worker = await getWorker(id);
  if (!worker) throw new NotFoundException("No such machine");
  return worker;
}
