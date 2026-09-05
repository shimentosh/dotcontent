import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import busboy from "busboy";
import type { Request, Response } from "express";

import { getSource, listSources } from "@/lib/server/repos/sources";
import {
  MAX_UPLOAD_BYTES,
  addFrameAt,
  frameFile,
  ingest,
  ingestFile,
  removeSource,
} from "@/lib/server/services/ingest";

/**
 * Source videos: fetched from a link, or uploaded from a machine.
 *
 * The two halves are no longer the same shape, and the difference is the whole
 * of `docs/WORKER.md`'s "Uploads stay on the server" decision:
 *
 * - **A link returns immediately.** `ingest()` writes an `ingest_source` job
 *   and hands back a source in `fetching`; yt-dlp and ffmpeg run on whichever
 *   machine has them. This route used to hold for minutes with a spinner on
 *   the other end, which only ever worked because the API was somebody's
 *   laptop — on a server it is a request held open across a download that
 *   machine cannot do at all.
 * - **An upload still holds.** The bytes are already arriving here, and
 *   sending a four hundred megabyte recording back out to a laptop to cut
 *   eight stills would double the transfer to learn nothing. The ffmpeg half
 *   runs in this process; only the transcription leaves, as its own job.
 *
 * So a caller polls `GET /sources/:id` after a fetch and watches `state` move
 * from `fetching` to `ready` or `failed`. It must not treat the POST's answer
 * as finished work: `frames` and `transcript` are empty in it by design, and
 * a screen that renders that response as the result shows an empty picker for
 * every link.
 */
@Controller("sources")
export class SourcesController {
  @Get()
  list(@Query("workspaceId") workspaceId?: string) {
    return listSources(workspaceId || undefined);
  }

  /**
   * Queue a fetch for a link, or hand back the one already fetched.
   *
   * Returns a source in `fetching` with a job behind it — or, when nothing on
   * this estate has yt-dlp, one already `failed` with a sentence naming what
   * to install. Both are terminal-or-moving states a person can act on, which
   * is the rule: a source must never sit on `fetching` with an empty queue
   * behind it.
   */
  @Post()
  fetch(
    @Body() body: { url?: string; workspaceId?: string | null; refresh?: boolean },
  ) {
    if (!body.url?.trim()) throw new BadRequestException("Paste a link first");
    return ingest({
      url: body.url,
      workspaceId: body.workspaceId ?? null,
      refresh: body.refresh,
    });
  }

  /**
   * A video off somebody's machine, streamed to disk as it arrives.
   *
   * Read straight off the request with busboy rather than through a body
   * parser: a parser buffers, and the whole point of the ingest's streaming
   * path is that a 400MB recording never sits in memory. The declared size is
   * refused up front as a courtesy; the ingest counts the bytes itself.
   *
   * Still the slow route, and still on purpose — the frames are cut here. It
   * comes back `ready` with the stills on it, and the transcript arrives later
   * on whichever machine has whisper, so `transcript` may fill in after this
   * response the same way a link's does.
   */
  @Post("upload")
  upload(@Req() req: Request) {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1048576)}MB — trim it or export it smaller.`,
      );
    }

    return new Promise((resolve, reject) => {
      const bb = busboy({ headers: req.headers, limits: { files: 1 } });
      let workspaceId: string | null = null;
      let handled = false;

      bb.on("field", (name, value) => {
        if (name === "workspaceId" && value) workspaceId = value;
      });

      bb.on("file", (name, file, info) => {
        if (name !== "file") {
          file.resume();
          return;
        }
        handled = true;
        // Node's Readable, as the Web stream the ingest takes: the ingest is
        // shared with code that gets a fetch() body, so it speaks that shape.
        const web = ReadableStreamFromNode(file);
        ingestFile({ filename: info.filename, stream: web, workspaceId })
          .then(resolve)
          .catch(reject);
      });

      bb.on("error", reject);
      bb.on("finish", () => {
        if (!handled) reject(new BadRequestException("Choose a video file"));
      });

      req.pipe(bb);
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const source = await getSource(id);
    if (!source) throw new NotFoundException("No such source");
    return source;
  }

  /** The row and the download go together. */
  @Delete(":id")
  async remove(@Param("id") id: string) {
    return { ok: await removeSource(id) };
  }

  /**
   * One more still, at a moment somebody asked for.
   *
   * Uploads only. A fetched link's video is downloaded on the machine that
   * ingests it and never comes here — only the stills and the audio do — so
   * this answers 409 with a sentence saying so rather than pretending a file
   * is missing.
   */
  @Post(":id/frames")
  @HttpCode(201)
  addFrame(@Param("id") id: string, @Body() body: { at?: number }) {
    const at = Number(body.at);
    if (!Number.isFinite(at) || at < 0) {
      throw new BadRequestException("Give a time in seconds");
    }
    return addFrameAt(id, at);
  }

  /** The frame's bytes. Immutable: a frame at a second never changes. */
  @Get(":id/frames/:file")
  async frame(
    @Param("id") id: string,
    @Param("file") file: string,
    @Res() res: Response,
  ) {
    const bytes = await frameFile(id, file);
    if (!bytes) throw new NotFoundException("No such frame");
    res
      .set({
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=31536000, immutable",
      })
      .send(bytes);
  }
}

/** A Node readable as a Web ReadableStream, without the whole of node:stream/web's types. */
function ReadableStreamFromNode(
  file: NodeJS.ReadableStream,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      file.on("end", () => controller.close());
      file.on("error", (e) => controller.error(e));
    },
  });
}
