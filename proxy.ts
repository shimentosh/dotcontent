import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

/**
 * The lock on the front door.
 *
 * Named `proxy` in a file called proxy.ts: Next 16 deprecated the `middleware`
 * convention and renamed it. Same runtime, same matcher, same one job.
 *
 * It checks only that a session cookie is PRESENT, not that it is valid —
 * this runs before the database is reachable, and a forged cookie gets
 * no further than the first API call, every one of which calls `requireUser`.
 * This exists so someone who is not signed in lands on the sign-in page
 * instead of an empty shell that 401s six times.
 */

/** Reachable without signing in: the auth pages and the API behind them. */
const OPEN = [
  "/login",
  "/signup",
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/logout",
  "/api/auth/me",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  // The API answers in JSON. Redirecting a fetch to an HTML page is how a
  // client ends up parsing a login form and reporting "unexpected token <".
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

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
