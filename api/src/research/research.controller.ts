import { BadRequestException, Body, Controller, HttpCode, Post } from "@nestjs/common";

import { research } from "@/lib/server/services/researcher";

/**
 * Watch a reel and say what it is about.
 *
 * Minutes: eight stills go to the model as pictures. Nothing here times out
 * on purpose — the service has its own ten-minute ceiling on the model call.
 */
@Controller("research")
export class ResearchController {
  @Post()
  @HttpCode(200)
  run(@Body() body: { sourceId?: string; frames?: string[]; note?: string }) {
    if (!body.sourceId) throw new BadRequestException("Fetch a video first");
    return research({
      sourceId: body.sourceId,
      frames: body.frames,
      note: body.note,
    });
  }
}
