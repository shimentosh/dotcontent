import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import {
  authenticate,
  createInvite,
  createUser,
  endOtherSessions,
  endSession,
  listInvites,
  listSessions,
  listUsers,
  removeUser,
  revokeInvite,
  signupOpen,
  startSession,
  sweepSessions,
  updatePassword,
  type User,
} from "@/lib/server/auth";

import { clearSession, setSession } from "../common/cookie";
import { Public } from "../common/session.guard";
import { CurrentUser, SessionId } from "../common/user.decorator";

/**
 * Signing in, signing up, and the people who can.
 *
 * The four routes a visitor reaches before they have a session are `@Public()`;
 * everything else is behind the global guard. The cookie is set by this
 * process, on this origin — see common/cookie.ts for what that means when the
 * web app is somewhere else.
 */
@Controller()
export class AuthController {
  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Headers("user-agent") agent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await authenticate(body.email ?? "", body.password ?? "");
    void sweepSessions();
    setSession(res, await startSession(user.id, agent ?? ""));
    return user;
  }

  @Public()
  @Get("auth/signup")
  async signupOpen() {
    return { open: await signupOpen() };
  }

  @Public()
  @Post("auth/signup")
  async signup(
    @Body()
    body: { email?: string; password?: string; name?: string; invite?: string },
    @Headers("user-agent") agent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await createUser({
      email: body.email ?? "",
      password: body.password ?? "",
      name: body.name,
      invite: body.invite,
    });
    setSession(res, await startSession(user.id, agent ?? ""));
    return user;
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(
    @SessionId() sid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (sid) await endSession(sid);
    clearSession(res);
    return { ok: true };
  }

  /** Who is signed in, and whether the console still has no owner. */
  @Public()
  @Get("auth/me")
  async me(@CurrentUser() user: User | null) {
    return { user, signupOpen: await signupOpen() };
  }

  @Post("auth/password")
  @HttpCode(200)
  async password(
    @CurrentUser() user: User,
    @Body() body: { current?: string; next?: string },
    @Headers("user-agent") agent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await updatePassword(user.id, body.current ?? "", body.next ?? "");
    // A new session on a new password: whatever knew the old one is out.
    setSession(res, await startSession(user.id, agent ?? ""));
    return { ok: true };
  }

  @Get("auth/sessions")
  sessions(@CurrentUser() user: User, @SessionId() sid: string) {
    return listSessions(user.id, sid);
  }

  @Delete("auth/sessions")
  async endOthers(@CurrentUser() user: User, @SessionId() sid: string) {
    return { ended: await endOtherSessions(user.id, sid) };
  }

  @Get("invites")
  invites() {
    return listInvites();
  }

  @Post("invites")
  invite(
    @CurrentUser() user: User,
    @Body() body: { email?: string; note?: string; days?: number },
  ) {
    return createInvite({
      createdBy: user.id,
      email: body.email,
      note: body.note,
      days: body.days,
    });
  }

  @Delete("invites/:token")
  async revoke(@Param("token") token: string) {
    const gone = await revokeInvite(token);
    if (!gone) throw new NotFoundException("That invite is already used");
    return { ok: true };
  }

  @Get("users")
  users() {
    return listUsers();
  }

  @Delete("users/:id")
  async remove(@CurrentUser() me: User, @Param("id") id: string) {
    const gone = await removeUser(id, me.id);
    if (!gone) throw new NotFoundException("No such account");
    return { ok: true };
  }
}
