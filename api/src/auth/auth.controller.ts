import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import {
  adoptTarget,
  authenticate,
  createHandoff,
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
  spendHandoff,
  startSession,
  sweepHandoffs,
  sweepSessions,
  updatePassword,
  type User,
} from "@/lib/server/auth";

import { clearSession, setSession } from "../common/cookie";
import { Public, SESSION_SCHEME } from "../common/session.guard";
import { CurrentUser, SessionId } from "../common/user.decorator";

/**
 * Signing in, signing up, and the people who can.
 *
 * The routes a visitor reaches before they have a session are `@Public()`;
 * everything else is behind the global guard. The cookie is set by this
 * process, on this origin — see common/cookie.ts for what that means when the
 * web app is somewhere else.
 *
 * `auth/adopt` is the newest of the public ones and the only one that is not a
 * form: it takes a one-time code minted by `auth/handoff` over an existing
 * session and turns it into that same session's cookie, so the desktop app's
 * webview arrives signed in instead of at a second login form.
 */
@Controller()
export class AuthController {
  /**
   * Sign in. The cookie always; the session id only when it is asked for.
   *
   * A browser needs nothing but the cookie and has never read this body for a
   * credential. The desktop app cannot use the cookie at all — its webview is
   * on a local origin, so the API's cookie is third-party — so it holds the
   * session id itself and sends it back as `Authorization: Session <id>`; see
   * `common/session.guard.ts` for why that is the same session and not a new
   * principal.
   *
   * Behind a header rather than given to everybody, because a credential in a
   * response body is a credential in whatever logs that body. Nothing on the
   * console asks for this one, so nothing on the console can start recording
   * it: a request-logging middleware, a browser devtools export somebody
   * pastes into a bug report, a proxy keeping response samples. A client that
   * sends `X-Session-Return: 1` has said it intends to store the thing, and
   * has somewhere to store it — the OS credential store, in this app's case.
   *
   * The header is the request's, not a response flag, so the web app's login
   * is byte-for-byte what it was. And it is a header rather than a body field
   * so that the shape of what a client *posts* stays the same for both, which
   * keeps `authenticate` the one thing this route is about.
   */
  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Headers("user-agent") agent: string | undefined,
    @Headers("x-session-return") wantsSession: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await authenticate(body.email ?? "", body.password ?? "");
    void sweepSessions();
    const sid = await startSession(user.id, agent ?? "");
    setSession(res, sid);
    // Any value that is not an explicit "no" counts as asking: a client that
    // sets this header at all is a non-browser client that will not get the
    // cookie home, and failing it over the spelling of "true" would produce a
    // sign-in that looks like it worked and a machine that never enrols.
    if (!asked(wantsSession)) return user;
    /*
     * The scheme travels with the credential. The app has to send it back as
     * `Authorization: Session <id>` and there is no second place it could read
     * that word from — it is not in a header of this response, it is not in
     * the cookie — so saying it here is what stops a client inventing `Bearer`
     * and colliding with the worker token.
     */
    return { ...user, session: sid, scheme: SESSION_SCHEME };
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

  /**
   * A one-time code that carries this session into a webview.
   *
   * Behind the global guard, and that is the whole authorisation: the session
   * it hands out is `@SessionId()`, which is the one the caller just
   * authenticated with. There is no parameter naming a session or a user, so
   * there is nothing here that could be pointed at somebody else's — a caller
   * can only ever ask for a code for the session it already has, which means
   * this route hands out no access that the request did not arrive holding.
   *
   * The desktop app is what calls it, over its `Authorization: Session …`,
   * immediately before opening the console window. See "The hand-off" in
   * lib/server/auth.ts for why the code is single-use, short-lived, hashed at
   * rest, and buys this session rather than minting another.
   *
   * The code is in the response body because the caller is a Rust process with
   * somewhere to put it, exactly as `POST /auth/login` returns a session id to
   * a client that asked for one — and nothing on the console calls this, so
   * nothing on the console can start logging it.
   */
  @Post("auth/handoff")
  @HttpCode(200)
  handoff(@SessionId() sid: string) {
    // Spent and expired rows, on the way past. Same shape as `sweepSessions`
    // on login: the tidying rides on the traffic rather than on a timer.
    void sweepHandoffs();
    return createHandoff(sid);
  }

  /**
   * Spend a hand-off code, set the session cookie, and go to the console.
   *
   * `@Public()` because the point of it is to be reachable by a webview that
   * has no cookie yet — that is the state it exists to fix. The code is the
   * credential, and it is checked by `spendHandoff`, which refuses a spent, an
   * expired, an unknown and a since-revoked code identically.
   *
   * **`next` is validated before the code is spent**, and a `next` that is not
   * the console is refused outright rather than replaced with something safe.
   * Two reasons in that order: a redirect that also sets a session cookie is
   * the pairing an open redirect is actually worth something for, and a typo
   * in a deployment's `WEB_ORIGIN` should fail loudly on the first try rather
   * than work-ish forever. Spending the code only after that check means a
   * refusal does not also burn the app's one credential, so it can simply open
   * the console the ordinary way and let the person sign in.
   *
   * **A bad code still redirects, with no cookie set.** This is a window
   * somebody is looking at, mid-navigation, and a JSON error in it is a dead
   * end with nothing to click. Sending them to the console signed out gets
   * them the console's own login page, which is precisely the second sign-in
   * this feature removes when it works and is a perfectly good outcome when it
   * does not. It is also one response for all four failures, so it says
   * nothing about which one happened.
   */
  @Public()
  @Get("auth/adopt")
  async adopt(
    @Query("code") code: string | undefined,
    @Query("next") next: string | undefined,
    @Res() res: Response,
  ) {
    const target = adoptTarget(String(next ?? ""));
    if (!target) {
      throw new BadRequestException(
        "That is not this console's address, so this app will not sign a browser in and send it there.",
      );
    }

    const sid = await spendHandoff(String(code ?? ""));
    if (sid) setSession(res, sid);
    /*
     * Never stored anywhere on the way. A 302 carrying a `Set-Cookie` is the
     * one response in this API that a shared proxy caching it would hand one
     * person's session to the next person down the wire.
     */
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, target);
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

/**
 * Whether a client asked for its session id back.
 *
 * Generous in one direction only. Absent is no — that is the browser, and the
 * whole reason this is opt-in — but anything present counts as yes unless it
 * is one of the words that plainly means no. A desktop app that sent `true`
 * where this wanted `1` would otherwise sign in successfully, be handed
 * nothing to keep, and fail at enrolment with a sentence about a server that
 * is working perfectly.
 */
const asked = (header: string | undefined) => {
  const value = String(header ?? "").trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false" && value !== "no";
};
