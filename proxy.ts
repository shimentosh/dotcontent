import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

/**
 * The lock on the front door.
 *
 * Named `proxy` in a file called proxy.ts: Next 16 deprecated the `middleware`
 * convention and renamed it. Same runtime, same matcher, same one job.
 *
 * It checks only that a session cookie is PRESENT, not that it is valid — this
 * runs before any database is reachable. Validity is the API's job: every
 * request the browser makes goes to the NestJS service on its own origin,
 * where a global guard refuses anything without a live session. There is no
 * `/api` under Next any more, so there is nothing here for a forged cookie to
 * reach; a visitor without one is sent to sign in rather than shown an empty
 * shell that 401s six times.
 *
 * For that to work when the API is on a different host, the cookie has to be
 * visible to BOTH origins — COOKIE_DOMAIN on the API, see api/src/common.
 */

/** Reachable without signing in. */
const OPEN = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const to = request.nextUrl.clone();
  to.pathname = "/login";
  to.search = "";
  // Where they were headed, so signing in lands them there rather than home.
  if (pathname !== "/") to.searchParams.set("next", pathname + search);
  return NextResponse.redirect(to);
}

export const config = {
  /*
   * Everything except Next's own assets and the favicon.
   *
   * `_next/static` and `_next/image` are matched out rather than allowed
   * through above, because a redirect on a stylesheet request produces a page
   * that renders unstyled instead of one that redirects.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|woff2?)$).*)"],
};
