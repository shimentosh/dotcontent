import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import {
  clearSecret,
  getSettings,
  listSecrets,
  setSecret,
  setSettings,
  type Settings,
} from "@/lib/server/repos/settings";

/**
 * Preferences, and the API keys beside them.
 *
 * Keys go in and never come back out: `listSecrets` answers with which ids
 * are stored, not their values. The settings table encrypts them with
 * DOTCONTENT_SECRET — see the repo for why a dump is not a list of live keys.
 */
@Controller("settings")
export class SettingsController {
  @Get()
  get() {
    return getSettings();
  }

  @Patch()
  update(@Body() body: Partial<Settings>) {
    return setSettings(body ?? {});
  }

  @Get("keys")
  keys() {
    return listSecrets();
  }

  @Post("keys")
  async setKey(@Body() body: { id?: string; value?: string }) {
    if (!body.id) throw new BadRequestException("Which key?");
    await setSecret(body.id, body.value ?? "");
    return listSecrets();
  }

  @Delete("keys")
  async clearKey(@Query("id") id?: string) {
    if (!id) throw new BadRequestException("Which key?");
    await clearSecret(id);
    return listSecrets();
  }
}
