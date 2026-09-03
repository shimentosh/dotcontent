import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";

import {
  createPack,
  deletePack,
  getPack,
  listPacks,
  restorePack,
  updatePack,
  type PackPatch,
} from "@/lib/server/repos/packs";

/**
 * The template library.
 *
 * Instructions come back with the list — the builder edits them, so it needs
 * them. Any pack can be edited, the shipped ones included; POST on a slug puts
 * a shipped one back the way it came.
 */
@Controller("packs")
export class PacksController {
  @Get()
  list() {
    return listPacks();
  }

  @Post()
  create(@Body() body: PackPatch) {
    if (!body?.name?.trim()) throw new BadRequestException("A pack needs a name");
    return createPack(body);
  }

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    const pack = await getPack(slug);
    if (!pack) throw new NotFoundException("No such pack");
    return pack;
  }

  @Patch(":slug")
  async update(@Param("slug") slug: string, @Body() body: PackPatch) {
    const pack = await updatePack(slug, body ?? {});
    if (!pack) throw new NotFoundException("No such pack");
    return pack;
  }

  /** Restore the shipped version, section by section. */
  @Post(":slug")
  @HttpCode(200)
  async restore(@Param("slug") slug: string) {
    const pack = await restorePack(slug);
    if (!pack) {
      throw new NotFoundException("No version of that pack ships with the app");
    }
    return pack;
  }

  @Delete(":slug")
  async remove(@Param("slug") slug: string) {
    return { ok: await deletePack(slug) };
  }
}
