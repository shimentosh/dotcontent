import type { CookieOptions, Response } from "express";

import { SESSION_COOKIE } from "@/lib/server/auth";

const SESSION_DAYS = 30;

/**
 * How the session cookie is set, on an API that lives on its own origin.
 *
 * The Next handlers set it same-origin with SameSite=Lax. Here the browser
 * may be on app.example.com and this on api.example.com — same *site*, so Lax
 * still travels — or on two unrelated hosts, where only SameSite=None with
 * Secure does. Which one is a deployment fact, not a code one, so it is env:
 *
 *   COOKIE_SAMESITE   lax (default) | none | strict
 *   COOKIE_DOMAIN     ".example.com" to share the cookie across subdomains,
 *                     which is also what lets the Next proxy see it and send
 *                     a signed-out visitor to /login instead of a blank shell.
 *
 * Secure is on in production regardless — a session cookie over plain HTTP
 * is a session handed to the network.
 */
export function cookieOptions(maxAgeDays = SESSION_DAYS): CookieOptions {
  const sameSite = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
  return {
    httpOnly: true,
    sameSite:
      sameSite === "none" ? "none" : sameSite === "strict" ? "strict" : "lax",
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
  };
}

export const setSession = (res: Response, sid: string) =>
  res.cookie(SESSION_COOKIE, sid, cookieOptions());

export const clearSession = (res: Response) =>
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
