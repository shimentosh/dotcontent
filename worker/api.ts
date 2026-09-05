import { openAsBlob } from "node:fs";
import path from "node:path";

import type { ToolStatus } from "../lib/server/tools";
import type { Config } from "./config";

/**
 * The six endpoints a machine speaks, and nothing else.
 *
 * Every call carries the bearer token and never a cookie: the worker is not a
 * browser and must not be able to reach the console with a machine credential.
 * `docs/WORKER.md` has the argument; the shape of this file is the argument
 * made in code — there is deliberately no method here that reads a run, a
 * pack or a template, because the token is not allowed to.
 */

/**
 * An answer the server refused, kept with its status so 409 can be told apart.
 *
 * The field is assigned in the body rather than declared as a constructor
 * parameter property: Node strips types out of these files rather than
 * compiling them, and a parameter property is the one piece of TypeScript that
 * emits code rather than deleting it — so it is a syntax error at run time
 * even though `tsc` is perfectly happy with it.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A job that is no longer this machine's. Not a failure, and not lost work. */
export const isStale = (e: unknown) => e instanceof HttpError && e.status === 409;

export type ClaimedJob = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  leaseUntil: string | null;
};

export class Api {
  private readonly cfg: Config;

  // Assigned here rather than as a parameter property, for the reason on
  // `HttpError` above: Node strips these files, it does not compile them.
  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  private url(pathname: string) {
    // Absolute paths arrive in payloads — `/api/workers/sources/x/frames/y` —
    // so the base is joined here rather than concatenated at each call site,
    // where a doubled or missing slash becomes a 404 that reads like a missing
    // frame.
    return new URL(pathname, `${this.cfg.base}/`).toString();
  }

  private async send<T>(
    method: string,
    pathname: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(this.url(pathname), {
      method,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });

    if (!res.ok) {
      /*
       * The server's own sentence, when it wrote one.
       *
       * The 409 on a stale job is prose on purpose — "its lease ran out, and
       * nothing was written" — and that sentence is the whole of what a person
       * reading this laptop's log at midnight needs. Reducing it to the status
       * code would throw away the reassuring half.
       */
      const text = await res.text().catch(() => "");
      let said = text.slice(0, 400);
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        said = String(parsed.message ?? parsed.error ?? said);
      } catch {
        // Not JSON — a proxy's HTML error page, most likely. Its first 400
        // characters still say more than the number does.
      }
      throw new HttpError(said || `${method} ${pathname} answered ${res.status}`, res.status);
    }

    return (await res.json().catch(() => ({}))) as T;
  }

  /**
   * Say what this machine is and what it can run.
   *
   * On start and again on a timer, because re-registering is what replaces
   * `toolStatuses(force)`: the server has no machine to probe, so a newly
   * installed whisper becomes visible by this machine saying so again. It is
   * idempotent on the token — the same machine gets the same row.
   */
  register(body: {
    name: string;
    platform: string;
    version: string;
    tools: ToolStatus[];
    enabled: string[];
  }) {
    return this.send<{ workerId: string; heartbeatMs: number; claimMs: number }>(
      "POST",
      "/api/workers/register",
      body,
    );
  }

  /**
   * Ask for work, and wait.
   *
   * The long poll is held on the server for about twenty-five seconds and an
   * empty answer is the normal answer. The signal is how a shutdown stops
   * waiting immediately instead of holding the process open for the rest of
   * the poll.
   */
  claim(max: number, signal?: AbortSignal) {
    return this.send<{ jobs: ClaimedJob[] }>("POST", "/api/workers/claim", { max }, signal);
  }

  /** Extend the leases still held, and learn which have been taken away. */
  heartbeat(jobIds: string[], progress?: string) {
    return this.send<{ keep: string[]; drop: string[] }>("POST", "/api/workers/heartbeat", {
      jobIds,
      ...(progress ? { progress } : {}),
    });
  }

  result(jobId: string, result: Record<string, unknown>) {
    return this.send<{ ok: true }>("POST", `/api/workers/jobs/${jobId}/result`, { result });
  }

  /**
   * A failure, and whether anyone should try again.
   *
   * `retryable: false` means "this will fail identically on any machine" — a
   * refusal, a payload this worker cannot honour, a tool that is not here.
   * Spending the second attempt on those buys nothing and costs another
   * lease's worth of somebody waiting.
   */
  fail(jobId: string, error: string, retryable: boolean) {
    return this.send<{ ok: true }>("POST", `/api/workers/jobs/${jobId}/fail`, {
      error: error.slice(0, 2000),
      retryable,
    });
  }

  /** Bytes from the console — a frame to look at, or a WAV to transcribe. */
  async download(pathname: string, dest: string, signal?: AbortSignal) {
    const res = await fetch(this.url(pathname), {
      headers: { authorization: `Bearer ${this.cfg.token}` },
      signal,
    });
    if (!res.ok) {
      throw new HttpError(`${pathname} answered ${res.status}`, res.status);
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }

  /**
   * Frames up to the console, in one request.
   *
   * The server is the single source of truth for frames — the browser renders
   * them, the machine that ingests and the machine that writes are usually
   * different, and desktops are not backed up — so an ingest uploads and a
   * write downloads. Every part is named `file`, which is the field the
   * controller reads, and each filename is checked against `FRAME_FILE` on the
   * far side before a byte of it is written.
   */
  async uploadFrames(pathname: string, files: string[]) {
    const form = new FormData();
    for (const file of files) {
      // `openAsBlob` rather than reading each JPEG into a Buffer: eight stills
      // is nothing, but this is the same code path a hundred would take.
      form.append("file", await openAsBlob(file, { type: "image/jpeg" }), path.basename(file));
    }
    const res = await fetch(this.url(pathname), {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.token}` },
      body: form,
    });
    if (!res.ok) {
      throw new HttpError(`Uploading frames answered ${res.status}`, res.status);
    }
  }

  /**
   * The 16 kHz WAV up to the console.
   *
   * Streamed off disk rather than buffered. Audio is roughly a thirtieth of
   * the video, which is the whole reason transcription can afford to be a
   * separate job on a different desktop — but an hour of speech is still sixty
   * megabytes, and holding that in the heap of a sidecar that also has ffmpeg
   * running is how a laptop's worker dies rather than its download.
   */
  async uploadAudio(pathname: string, file: string) {
    const form = new FormData();
    form.append("file", await openAsBlob(file, { type: "audio/wav" }), path.basename(file));
    const res = await fetch(this.url(pathname), {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.token}` },
      body: form,
    });
    if (!res.ok) {
      throw new HttpError(`Uploading the audio answered ${res.status}`, res.status);
    }
  }
}
