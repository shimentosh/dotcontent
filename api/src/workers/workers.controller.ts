import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import busboy from "busboy";
import type { Response } from "express";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  LEASE_SECONDS,
  claim,
  fail,
  heartbeat,
  heldBy,
  succeed,
} from "@/lib/server/repos/jobs";
import { registerWorker } from "@/lib/server/repos/workers";
import { getSource } from "@/lib/server/repos/sources";
import {
  AUDIO_FILE,
  FRAME_FILE,
  MAX_UPLOAD_BYTES,
  audioPath,
  ensureSourceDir,
  frameFile,
  sourceFailed,
  sourceResult,
  transcriptResult,
} from "@/lib/server/services/ingest";
import { sectionFailed, sectionResult } from "@/lib/server/services/runs";
import type { ToolStatus } from "@/lib/server/tools";

import { WorkerRoute, workerOf, type WorkerRequest } from "../common/worker.guard";

/**
 * How long a claim holds when there is nothing to hand out, and how often the
 * worker is told to speak.
 *
 * Twenty-five seconds is under every proxy's thirty-second idle default, which
 * is the only number that actually constrains it: a long-poll that outlives an
 * intermediary comes back as a dropped connection the worker cannot tell from
 * a server that has gone away. A second between polls keeps latency to about a
 * second without anything stateful in between — the reason this is a long-poll
 * and not a socket.
 */
const CLAIM_HOLD_MS = 25_000;
const CLAIM_POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;

/**
 * The six endpoints a machine speaks, and nothing else.
 *
 * Every route here is `@WorkerRoute()`: a bearer token, no session, no cookie.
 * The server decides and the worker executes — a job carries finished text and
 * a command, never a pack, a template, a rule or a dependency graph — so there
 * is deliberately nothing on this controller that reads the content library.
 * A stolen worker token buys the queue and nothing more.
 */
@Controller("workers")
export class WorkersController {
  /**
   * Enrol a machine, or re-report the one already holding this token.
   *
   * Idempotent on the token because `registerWorker` makes it so: the desktop
   * app registers at every start and after every update, and a newly installed
   * `whisper` becomes visible by the machine saying so again. This is what
   * replaces `toolStatuses(force)` and the 60s probe cache, both of which
   * belonged to a server that could probe itself.
   *
   * The owner's switches — `canReadFrames`, `maxConcurrency`, `workspaceIds` —
   * are not accepted here even though the protocol table lists them, because
   * `registerWorker` refuses to overwrite them and it is right to: a worker
   * restarting with its defaults must not hand itself back file-read
   * permission somebody switched off in the console. They are the console's
   * writes; this is the machine's report.
   */
  @Post("register")
  @WorkerRoute()
  async register(
    @Req() req: WorkerRequest,
    @Body()
    body: {
      name?: string;
      platform?: string;
      version?: string;
      tools?: ToolStatus[];
      enabled?: string[];
    },
  ) {
    const worker = workerOf(req);
    const saved = await registerWorker({
      userId: worker.userId,
      name: body.name?.trim() || worker.name,
      // The raw token off the header, hashed again inside the repo. The row is
      // found by its hash, so this is the same machine by definition.
      token: req.workerToken ?? "",
      platform: body.platform ?? "",
      version: body.version ?? "",
      tools: Array.isArray(body.tools) ? body.tools : [],
      enabled: Array.isArray(body.enabled) ? body.enabled.map(String) : [],
    });
    return {
      workerId: saved.id,
      heartbeatMs: HEARTBEAT_MS,
      claimMs: CLAIM_HOLD_MS,
    };
  }

  /**
   * Hand out work, waiting up to twenty-five seconds for some to appear.
   *
   * An empty answer is the normal answer. Most of the day there is nothing
   * queued, and `{ jobs: [] }` after a quiet twenty-five seconds is a machine
   * doing exactly what it should — so nothing here logs, throws or counts it
   * as a failure. The alternative, a 500 or a warn per worker per half minute,
   * would bury the one line that matters on the day something is actually
   * wrong.
   *
   * The loop is written so it cannot outlive its own deadline or the
   * connection. It re-checks the clock and the socket before every wait and
   * again after it, and the timer it waits on is `unref`ed, so a worker that
   * disconnects mid-poll leaves nothing behind holding the process open. There
   * is no shared state between requests, which is what lets two API replicas
   * serve claims for the same estate without knowing about each other — the
   * queue's `FOR UPDATE SKIP LOCKED` is the only coordination there is.
   */
  @Post("claim")
  @WorkerRoute()
  async claim(@Req() req: WorkerRequest, @Body() body: { max?: number }) {
    const worker = workerOf(req);
    const asked = Math.max(1, Math.min(8, Number(body?.max ?? 1) || 1));

    let open = true;
    const closed = () => {
      open = false;
    };
    req.on("close", closed);

    try {
      const deadline = Date.now() + CLAIM_HOLD_MS;
      for (;;) {
        /*
         * Recomputed every pass, not once. A worker holding one job can post
         * its result on another connection while this one is waiting, and the
         * next second of the same poll should then be allowed to hand it more
         * work. `heldBy` is one indexed count; the claim itself is where the
         * decision is actually made atomic.
         */
        const room = worker.maxConcurrency - (await heldBy(worker.id));
        const jobs = room > 0 ? await claim(worker.id, worker.enabled, Math.min(asked, room)) : [];
        if (jobs.length) {
          return {
            jobs: jobs.map((j) => ({
              id: j.id,
              kind: j.kind,
              payload: j.payload,
              leaseUntil: j.leaseUntil,
            })),
          };
        }
        if (!open || Date.now() + CLAIM_POLL_MS >= deadline) return { jobs: [] };
        await sleep(CLAIM_POLL_MS);
        if (!open) return { jobs: [] };
      }
    } finally {
      req.off("close", closed);
    }
  }

  /**
   * Extend the leases a machine still holds, and tell it what it has lost.
   *
   * `drop` is the whole reason this returns anything: it is how a worker
   * learns a job was cancelled by a Stop button, or reaped out from under it
   * while its laptop was asleep. The answer on the worker's side is to kill
   * the child process rather than spend another four minutes producing
   * something the server will refuse. Everything not kept is dropped, ids this
   * server has never heard of included, because "I do not know that job" and
   * "that job is not yours any more" call for the same action.
   */
  @Post("heartbeat")
  @WorkerRoute()
  async heartbeat(
    @Req() req: WorkerRequest,
    @Body() body: { jobIds?: string[]; progress?: string },
  ) {
    const worker = workerOf(req);
    const ids = Array.isArray(body?.jobIds) ? body.jobIds.map(String) : [];
    return heartbeat(worker.id, ids, LEASE_SECONDS);
  }

  /**
   * A finished job, from the machine that still holds it.
   *
   * `jobs.succeed` returns null for exactly one situation and it is not an
   * error: the job is not this worker's, or its lease ran out. A laptop that
   * wakes from sleep and posts a section that was reassigned twenty minutes
   * ago must not overwrite the one that actually landed, so the write is
   * refused, the result already in `run_sections` stands, and the worker is
   * told 409 so that it stops rather than retrying into the same wall.
   *
   * Every kind is handed to the service that owns the row it writes, and
   * nothing here writes `run_sections` or `sources` itself: the ordering, the
   * dependency waves, what "written" means to a run and what a missing
   * transcript means to a source all belong on that side, and a second
   * implementation of them living in a controller is how the two quietly stop
   * agreeing.
   *
   * Until now only `write_section` was applied and the other three kinds were
   * stored on the job and nowhere else — which is the same bug in three
   * places: a machine finished the work, said so, and the row a person is
   * looking at never moved. An ingest that landed left its source on
   * "Fetching…" with an empty queue behind it, and the frames and the WAV it
   * had already uploaded sat on disk with nothing in the database pointing at
   * them.
   */
  @Post("jobs/:id/result")
  @WorkerRoute()
  async result(
    @Req() req: WorkerRequest,
    @Param("id") jobId: string,
    @Body() body: { result?: Record<string, unknown> },
  ) {
    const worker = workerOf(req);
    const result = body?.result ?? {};
    const job = await succeed(jobId, worker.id, result);
    if (!job) throw new ConflictException(staleJob(jobId));

    switch (job.kind) {
      case "write_section":
        await sectionResult(job, result, worker.name);
        break;
      /*
       * The frames and the WAV are already here — they went up through the two
       * upload endpoints below before this was posted — so the result only
       * names files the server holds, and `sourceResult` re-checks every one
       * of those names before it puts them on the row.
       */
      case "ingest_source":
        await sourceResult(job, result);
        break;
      case "transcribe_audio":
        await transcriptResult(job, result);
        break;
      /*
       * `test_brain` has nothing to apply anywhere else, and that is the whole
       * of its handling — but it is written down rather than left to fall off
       * the end, because the thing that matters about it is that `succeed()`
       * above has already put the job at `done` with the reply on it. That is
       * what the Integrations panel polls for; a job that stayed `claimed`
       * because nobody moved it would leave the button spinning until the
       * lease expired and the reaper handed the test to a second machine.
       */
      case "test_brain":
        break;
    }
    return { ok: true };
  }

  /**
   * A failure, from the machine that still holds the job.
   *
   * Same ownership and lease test, same 409, for the same reason. `retryable:
   * false` is the worker saying "this will fail identically on any machine" —
   * a refusal, a bad payload, a transport it cannot honour — and the server
   * does not spend another attempt on those. A worker that cannot do what the
   * payload asked must fail rather than quietly answer some other way; a
   * silent downgrade is the outcome `docs/DECISIONS.md` calls worse than an
   * error.
   */
  @Post("jobs/:id/fail")
  @WorkerRoute()
  async failJob(
    @Req() req: WorkerRequest,
    @Param("id") jobId: string,
    @Body() body: { error?: string; retryable?: boolean },
  ) {
    const worker = workerOf(req);
    const message = String(body?.error ?? "").trim() || "The machine did not say why.";
    const job = await fail(jobId, worker.id, message, body?.retryable !== false);
    if (!job) throw new ConflictException(staleJob(jobId));

    /*
     * A job that is finished failing has to say so on the section.
     *
     * `fail()` either puts the job back in the queue for another attempt or
     * ends it, and only the ending is news to the run: a retryable failure is
     * about to be tried on another machine, and marking the section failed in
     * between would flash "Failed" on a row that is still being written.
     *
     * Without this the row keeps whatever `advance` set — `writing` — with
     * nothing left in the queue that will ever move it. That is the run that
     * sat on "Writing" for five days, which `docs/DECISIONS.md` records and
     * this whole design exists to make impossible.
     */
    if (job.state === "failed") {
      if (job.kind === "write_section") {
        await sectionFailed(job, message);
      } else {
        /*
         * The same rule for a source, and `sourceFailed` draws the one
         * distinction that matters: a failed `ingest_source` fetched nothing,
         * so the source fails and names the machine; a failed
         * `transcribe_audio` cost the source its words and nothing else, so
         * the source stays ready and says which step fell short. A missing or
         * broken transcriber degrades a source; it does not fail it. A
         * `test_brain` has no source and falls through as a no-op — its
         * failure is the answer, and it is already on the job.
         */
        await sourceFailed(job, message, worker.name);
      }
    }
    return { ok: true };
  }

  /**
   * Frames from an ingesting machine, streamed to the server's disk.
   *
   * The server is the single source of truth for frames: the browser renders
   * them, the worker that ingests and the worker that writes are usually
   * different machines, and desktops are not backed up. So ingest uploads and
   * write downloads, and this is the uploading half.
   *
   * Every filename is re-checked against `FRAME_FILE`. That regex has until
   * now been guarding a query string; these names arrive over the network from
   * a process the server does not control, and it is now guarding a write —
   * `frame-01.jpg` is a file in this source's directory, `../../../id_rsa` is
   * not. Nothing else about the name is trusted: the part's own path
   * components are discarded before the test, not after.
   *
   * Read straight off the request with busboy and counted as it passes, the
   * way `writeCapped` does, because a parser buffers and a cap taken from the
   * content-length header is a number the client chose.
   */
  @Post("sources/:id/frames")
  @WorkerRoute()
  async frames(@Req() req: WorkerRequest, @Param("id") sourceId: string) {
    const source = await getSource(sourceId);
    if (!source) throw new NotFoundException("No such source");

    // Through the ingest service rather than by rebuilding the path here:
    // there is one place that knows where a source's files live, and a second
    // copy of `.data/sources/<id>` in a controller is a layout that drifts the
    // first time CONTENTOS_DATA_DIR means something new.
    const dir = await ensureSourceDir(sourceId);

    return new Promise<{ files: string[] }>((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      const files: string[] = [];
      const writes: Promise<void>[] = [];
      let bad: Error | null = null;

      bb.on("file", (field, file, info) => {
        if (field !== "file") {
          file.resume();
          return;
        }
        const name = path.basename(String(info.filename ?? ""));
        if (!FRAME_FILE.test(name)) {
          bad ??= new BadRequestException(`Not a frame filename: ${name}`);
          file.resume();
          return;
        }
        files.push(name);
        writes.push(writeCappedFile(file, path.join(dir, name)));
      });

      bb.on("error", reject);
      bb.on("finish", () => {
        Promise.all(writes)
          .then(() => {
            if (bad) throw bad;
            if (!files.length) throw new BadRequestException("No frame in that request");
            resolve({ files });
          })
          .catch(reject);
      });

      req.pipe(bb);
    });
  }

  /**
   * The audio, from the machine that fetched the video.
   *
   * The other half of "ingest uploads, write downloads", and the reason
   * `whisper` never became a dependency of this server. Audio is roughly a
   * thirtieth of the video, so the ingesting worker sends a 16 kHz mono WAV —
   * about a megabyte a minute rather than four hundred — and the machine with
   * a GPU downloads only that when it claims the `transcribe_audio` job.
   *
   * One fixed filename rather than one the sender chooses. A frame's name
   * carries information — which second it was cut at — and so has to be
   * checked against `FRAME_FILE`; a source has exactly one audio track, so the
   * safest name is the one the server picks and the sender cannot influence at
   * all. Multipart, and counted as it passes, for the same reason the frames
   * are: a parser buffers, and a cap read off content-length is a number the
   * client chose.
   */
  @Post("sources/:id/audio")
  @WorkerRoute()
  async audioUp(@Req() req: WorkerRequest, @Param("id") sourceId: string) {
    const source = await getSource(sourceId);
    if (!source) throw new NotFoundException("No such source");

    await ensureSourceDir(sourceId);
    const dest = audioPath(sourceId);

    return new Promise<{ ok: true; file: string }>((resolve, reject) => {
      const bb = busboy({ headers: req.headers, limits: { files: 1 } });
      let handled = false;

      bb.on("file", (field, file) => {
        if (field !== "file") {
          file.resume();
          return;
        }
        handled = true;
        writeCappedFile(file, dest)
          .then(() => resolve({ ok: true, file: AUDIO_FILE }))
          .catch(reject);
      });

      bb.on("error", reject);
      bb.on("finish", () => {
        if (!handled) reject(new BadRequestException("No audio in that request"));
      });

      req.pipe(bb);
    });
  }

  /**
   * The audio, back down to the machine about to transcribe it.
   *
   * Streamed rather than read into memory the way a frame is: a JPEG is tens
   * of kilobytes and an hour of speech is sixty megabytes, and buffering that
   * per concurrent transcription is the API process falling over rather than
   * the request.
   *
   * A 404 here is a real answer, not a fault — an `ingest_source` that could
   * not download the video uploaded no audio, and the job for it should not
   * have been enqueued, but a source deleted mid-transcription reaches exactly
   * this line. The worker fails the job, `sourceFailed` writes the sentence,
   * and the source stays readable.
   */
  @Get("sources/:id/audio")
  @WorkerRoute()
  async audioDown(@Param("id") sourceId: string, @Res() res: Response) {
    const file = audioPath(sourceId);
    const size = await fs
      .stat(file)
      .then((s) => s.size)
      .catch(() => 0);
    if (!size) throw new NotFoundException("No audio for that source");

    res.set({
      "content-type": "audio/wav",
      "content-length": String(size),
      "cache-control": "private, max-age=31536000, immutable",
    });
    createReadStream(file).pipe(res);
  }

  /*
   * There is deliberately no PUT for a transcript here.
   *
   * One existed, and nothing ever called it: a transcript comes back inside
   * the `transcribe_audio` result, where `succeed()` has already checked that
   * this worker holds that job and its lease is live. The PUT had no such
   * check — it took a source id and a string, so ANY valid worker token could
   * overwrite ANY source's transcript without holding a job for it. Dead code
   * would be reason enough; dead code that is also the one write on this
   * controller with no ownership test is reason twice over.
   */

  /**
   * A frame, back down to the machine that is about to look at it.
   *
   * The browser's copy of this lives on `sources.controller.ts` behind a
   * session, and it stays there. This is a second door rather than a widened
   * one: making the existing route accept either credential would mean a
   * stolen worker token could walk the content library through the same
   * handler, and the whole argument for a separate token is that it reaches
   * six endpoints and no more.
   *
   * `write_section` payloads name frames by this path. None of the three CLIs
   * takes bytes and each takes a file differently, so the worker writes them
   * to a temp directory of its own and hands over local paths — which is why
   * the server can stay the only place the frames actually live.
   */
  @Get("sources/:id/frames/:file")
  @WorkerRoute()
  async frame(
    @Param("id") sourceId: string,
    @Param("file") file: string,
    @Res() res: Response,
  ) {
    // The same name check the browser's route makes, for a stronger reason:
    // this one is reached by a process, not a person, and `..` in a path
    // segment is what it would be reached with.
    const bytes = await frameFile(sourceId, path.basename(file));
    if (!bytes) throw new NotFoundException("No such frame");
    res
      .set({
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=31536000, immutable",
      })
      .send(bytes);
  }
}

/**
 * The sentence a worker gets with its 409.
 *
 * Written as prose rather than a code, because the machine reading it logs it
 * and a person reads that log: "409" on a laptop at midnight says nothing,
 * and this says the one thing that is true and reassuring — the work was not
 * lost, it was somebody else's by then.
 */
function staleJob(jobId: string) {
  return `Job ${jobId} is not yours any more — its lease ran out or it was reassigned. Nothing was written.`;
}

/**
 * A wait that cannot outlive the process.
 *
 * `unref` so a claim held mid-poll never keeps Node alive through a shutdown,
 * and a plain resolving timer rather than an abortable one because the caller
 * re-checks the socket on the other side of it; there is nothing to cancel.
 */
function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * One part, to one file, counted as it goes.
 *
 * The same shape as `writeCapped` in services/ingest.ts — a counting Transform
 * between the stream and the file, and the partial file removed on the way out
 * — because the failure it prevents is the same one: a sender that declares
 * ten megabytes and sends ten gigabytes, and a half-written JPEG left on disk
 * that the picker will happily try to render.
 */
async function writeCappedFile(file: NodeJS.ReadableStream, dest: string) {
  let seen = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > MAX_UPLOAD_BYTES) {
        done(new BadRequestException("That upload is over the size cap."));
        return;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(file, cap, createWriteStream(dest));
  } catch (e) {
    await fs.rm(dest, { force: true }).catch(() => {});
    throw e;
  }
}
