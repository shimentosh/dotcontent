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
 * Slow on purpose. A fetch holds while yt-dlp downloads, ffmpeg cuts stills
 * and a transcriber runs — minutes, not seconds — and the browser waits with
 * a spinner on it. Express has no request timeout of its own, so there is
 * nothing here to raise; the Next handlers needed `maxDuration` and this does
 * not.
 */
@Controller("sources")
export class SourcesController {
  @Get()
  list(@Query("workspaceId") workspaceId?: string) {
    return listSources(workspaceId || undefined);
  }

  /** Fetch a reel by link, or hand back the one already fetched. */
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

  /** One more still, at a moment somebody asked for. */
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
