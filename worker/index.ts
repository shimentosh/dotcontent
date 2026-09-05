import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { toolStatuses, type ToolStatus } from "../lib/server/tools";
import { Api, HttpError, isStale, type ClaimedJob } from "./api";
import { isConfigError, loadConfig, type Config } from "./config";
import { RESULT_MARK } from "./job-types";
import { TEMP_ROOT, sweepTemp } from "./temp";

/**
 * The worker: register, claim, run, report. Forever, until somebody stops it.
 *
 * It opens outbound connections only — no inbound port, no static IP, no hole
 * in anybody's router — which is what makes it something a teammate can run on
 * their own Windows laptop without asking anyone for anything. The server
 * decides what happens and this executes it: a job carries finished text and a
 * command, never a pack, a template, a rule or a dependency graph.
 *
 * Nothing here is stateful across a restart, and that is deliberate. A job
 * held by a process that dies is not lost — its lease expires, the reaper puts
 * it back, another machine takes it — so this process has nothing to persist
 * and no file to be careful about.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** A job this machine is holding, and the process actually doing it. */
type Running = {
  job: ClaimedJob;
  child: ChildProcess;
  /** Killed on purpose — a `drop` from the server, or a shutdown. */
  killed: boolean;
};

async function main() {
  const cfg = loadConfig();
  const api = new Api(cfg);

  // Whatever an earlier run left behind. A killed process cleans up nothing,
  // and a laptop that has been fetching videos for a month should not be
  // storing a month of them in its temp directory.
  await sweepTemp();

  const running = new Map<string, Running>();
  let stopping = false;
  let claiming: AbortController | null = null;

  /**
   * Stop claiming, and mean it.
   *
   * Installed before anything that waits — the first registration can wait for
   * minutes — because a Ctrl-C that does nothing is a machine you have to kill
   * to stop, and a killed machine hands nothing back.
   */
  function stop(signal: string) {
    if (stopping) {
      // A second Ctrl-C is somebody who has decided not to wait. Honour it.
      log("Stopping now.");
      process.exit(1);
    }
    stopping = true;
    log(`${signal} — finishing up. Not claiming any more work.`);
    // The claim is a long poll; aborting it is the difference between stopping
    // now and stopping in twenty-five seconds.
    claiming?.abort();
  }

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  /*
   * Keep trying to enrol.
   *
   * A worker that exited because the console was not up yet would be a
   * desktop app that has to be started in the right order, on a laptop that
   * opens before its wifi does — every morning. A bad token is different and
   * does exit: no amount of waiting turns a 401 into a machine.
   */
  let enrolled: Awaited<ReturnType<typeof register>> | null = null;
  while (!enrolled && !stopping) {
    try {
      enrolled = await register(cfg, api);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw e;
      log(`Cannot reach ${cfg.base} yet: ${say(e)}. Trying again in 10s.`);
      await sleep(10_000);
    }
  }
  if (!enrolled) return;

  log(
    `Registered as ${enrolled.workerId} (${cfg.name}). Claiming for ${enrolled.claimMs}ms at a time, heartbeat every ${enrolled.heartbeatMs}ms.`,
  );

  /*
   * Re-register on a timer.
   *
   * This is what replaces `toolStatuses(force)` and the sixty-second probe
   * cache: the server has no machine to probe, so a whisper installed this
   * afternoon becomes visible by this machine saying so again. It is
   * idempotent on the token — the same machine, the same row, a fresher tool
   * report.
   */
  const registerTimer = setInterval(() => {
    void register(cfg, api).catch((e: unknown) => {
      // Not fatal. The claim loop is still talking to the same server, and the
      // next tick reports again; a worker that exited over a failed re-report
      // would stop working over something that changed nothing.
      log(`Could not re-report this machine's tools: ${say(e)}`);
    });
  }, cfg.registerEveryMs);

  /*
   * Heartbeat, and act on what comes back.
   *
   * `drop` is the whole reason this returns anything: it is how this machine
   * learns a job was cancelled by a Stop button or reaped while the lid was
   * shut. The answer is to kill the child, not to finish work nobody wants —
   * four more minutes of a subscription spent on something the server will
   * refuse with a 409 anyway.
   */
  const heartbeatTimer = setInterval(() => {
    if (stopping || running.size === 0) return;
    void api
      .heartbeat([...running.keys()])
      .then(({ drop }) => {
        for (const id of drop ?? []) {
          const held = running.get(id);
          if (!held) continue;
          log(`Job ${id} was taken back by the server — stopping it here.`);
          held.killed = true;
          killTree(held.child);
        }
      })
      .catch((e: unknown) => log(`Heartbeat failed: ${say(e)}`));
  }, enrolled.heartbeatMs);

  /**
   * Run a job, then say what happened.
   *
   * A 409 on the way out is not a failure and is not logged as one: it means
   * the job stopped being this machine's — a lease that ran out while the
   * laptop slept, and somebody else has already written it. Nothing was lost,
   * and there is nothing to retry.
   */
  const start = (job: ClaimedJob) => {
    const child = spawnExecutor(job);
    const held: Running = { job, child, killed: false };
    running.set(job.id, held);
    log(`Claimed ${job.kind} ${job.id}.`);

    void collect(child)
      .then(async (answer) => {
        if (held.killed) {
          // The server already took it back. Posting anything now would be
          // answering a question nobody is still asking.
          log(`Job ${job.id} was stopped before it finished.`);
          return;
        }
        if (answer.ok) {
          await api.result(job.id, answer.result);
          log(`Finished ${job.kind} ${job.id}.`);
        } else {
          await api.fail(job.id, answer.error, answer.retryable);
          log(
            `Failed ${job.kind} ${job.id}${answer.retryable ? "" : " (for good)"}: ${answer.error}`,
          );
        }
      })
      .catch((e: unknown) => {
        if (isStale(e)) {
          log(`Job ${job.id}: ${say(e)}`);
          return;
        }
        log(`Could not report job ${job.id}: ${say(e)}`);
      })
      .finally(() => {
        running.delete(job.id);
      });
  };

  /*
   * The loop.
   *
   * A long poll rather than a socket: one code path, survives every proxy, and
   * about a second of latency without anything stateful in between. An empty
   * answer after twenty-five quiet seconds is the normal answer and says
   * nothing — a line per worker per half minute would bury the one line that
   * matters on the day something is actually wrong.
   */
  while (!stopping) {
    if (running.size >= cfg.maxJobs) {
      await sleep(1_000);
      continue;
    }

    claiming = new AbortController();
    try {
      const { jobs } = await api.claim(cfg.maxJobs - running.size, claiming.signal);
      for (const job of jobs ?? []) start(job);
    } catch (e) {
      if (stopping) break;
      /*
       * The console is not answering.
       *
       * Said once and then waited out, because the ordinary cause is a laptop
       * that woke before its wifi did, and a machine that logged a line per
       * failed poll would fill a terminal with the same sentence. Nothing is
       * lost while this is happening: any job this worker held has a lease
       * that will expire, and the reaper hands it to somebody awake.
       */
      log(`No answer from ${cfg.base}: ${say(e)}. Trying again in 5s.`);
      await sleep(5_000);
    } finally {
      claiming = null;
    }
  }

  clearInterval(registerTimer);
  clearInterval(heartbeatTimer);

  /*
   * Shutting down: nothing is left half-said.
   *
   * Every job still running is killed and then FAILED explicitly, as
   * retryable, rather than being abandoned to its lease. Both end with the job
   * back in the queue, but ninety seconds apart — and those ninety seconds are
   * somebody watching a row that says "Writing" on a machine that is already
   * closed.
   */
  for (const held of running.values()) {
    held.killed = true;
    killTree(held.child);
    await api
      .fail(
        held.job.id,
        `${cfg.name} was shut down while this job was running. Nothing was written.`,
        true,
      )
      .catch((e: unknown) => {
        if (!isStale(e)) log(`Could not hand back job ${held.job.id}: ${say(e)}`);
      });
    log(`Handed back ${held.job.kind} ${held.job.id}.`);
  }

  await rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {});
  log("Stopped.");
}

/**
 * Say what this machine is and what it can run.
 *
 * `tools` is the whole `ToolStatus` array, probed here, because probing is the
 * worker's job now — the Integrations page renders exactly these rows and the
 * server has no machine of its own to ask. `enabled` is the subset this
 * machine's owner has left switched on, which is a fact about a machine and
 * never about a console: "ffmpeg is off" was one global row for the whole
 * install, and on an estate of four laptops that is three separate wrong
 * things.
 */
async function register(cfg: Config, api: Api) {
  // Forced past the sixty-second cache: this call exists precisely to notice
  // an install that happened since the last one.
  const tools: ToolStatus[] = await toolStatuses(true);
  return api.register({
    name: cfg.name,
    platform: `${process.platform} ${process.arch}`,
    version: cfg.version,
    tools,
    enabled: tools.filter((t) => t.present && !cfg.toolsOff.has(t.id)).map((t) => t.id),
  });
}

/**
 * A job's own process, started the same way this one was.
 *
 * The same `--import` hook, because the executor imports the app's TypeScript
 * by plain path exactly as this file does. On anything but Windows it is
 * `detached` so that it leads its own process group and a kill can take the
 * shell and the CLI under it; on Windows there are no process groups to lead
 * and `taskkill /T` walks the tree instead.
 */
function spawnExecutor(job: ClaimedJob) {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      pathToFileURL(path.join(here, "register.mjs")).href,
      path.join(here, "executor.ts"),
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      ...(process.platform === "win32" ? {} : { detached: true }),
    },
  );

  // The payload is thousands of characters of system prompt, so it goes down
  // stdin rather than into an argument — the same reason the CLIs are fed on
  // stdin, and the same Windows command-line limit behind it.
  child.stdin?.write(JSON.stringify({ id: job.id, kind: job.kind, payload: job.payload }));
  child.stdin?.end();
  return child;
}

type Answer =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; retryable: boolean };

/**
 * Wait for the job's process, and read its answer out of the noise.
 *
 * Behind a sentinel rather than "the last line of stdout", because a CLI or
 * one of its libraries can print at any moment and being wrong about which
 * line is the answer means posting a progress bar as somebody's section.
 */
function collect(child: ChildProcess): Promise<Answer> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += String(d)));
    child.stderr?.on("data", (d: Buffer) => (err += String(d)));

    child.on("error", (e) =>
      resolve({ ok: false, error: `The job process would not start: ${e.message}`, retryable: true }),
    );

    child.on("close", (code) => {
      const at = out.lastIndexOf(RESULT_MARK);
      if (at >= 0) {
        try {
          return resolve(JSON.parse(out.slice(at + RESULT_MARK.length).trim()) as Answer);
        } catch {
          // Fall through: a mangled answer is a crashed job, not a silent
          // success, and it is reported as one below.
        }
      }
      /*
       * No answer at all: killed, out of memory, or a crash before it could
       * write one. Retryable, because that is the shape of every one of those
       * — another machine, or this one after a restart, may well manage it.
       */
      resolve({
        ok: false,
        error:
          `The job stopped without answering (exit ${code}).` +
          (err.trim() ? ` ${err.trim().split("\n").slice(-3).join(" ").slice(0, 400)}` : ""),
        retryable: true,
      });
    });
  });
}

/**
 * Kill a job and everything it started.
 *
 * The CLIs are spawned through a shell — they are .cmd shims on Windows and
 * spawning one directly fails with ENOENT — so the model process is a
 * grandchild, and killing only the child would leave `claude` running with
 * nobody waiting for it. `taskkill /T` walks the tree; a process group does
 * the same everywhere else.
 */
function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // Already gone, most likely — which is the outcome this was after.
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

function log(line: string) {
  // A person reads this in a console window on their own laptop, so it says
  // the time rather than a level nobody filters on.
  console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
}

main().catch((e: unknown) => {
  /*
   * The one thing this must not do on somebody's desktop is print a stack
   * trace at them. A missing setting is a sentence naming what to set.
   */
  if (isConfigError(e)) {
    console.error(say(e));
    process.exit(1);
  }
  if (e instanceof HttpError && e.status === 401) {
    console.error(
      `${say(e)}\nThe console did not recognise CONTENTOS_WORKER_TOKEN. Add this machine again in Settings → Machines and paste the new token.`,
    );
    process.exit(1);
  }
  console.error(`The worker stopped: ${say(e)}`);
  process.exit(1);
});
