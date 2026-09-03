/**
 * Where the API is.
 *
 * The backend is a NestJS service on its own origin — http://localhost:4000
 * on a laptop, api.yourdomain.com on a server — so every browser call names
 * that origin rather than its own. `NEXT_PUBLIC_API_URL` is read at build
 * time, which is how Next ships an env var to the browser; leave it unset and
 * the dev default applies.
 *
 * `credentials: "include"` on every call is what carries the session cookie
 * across origins. Without it a fetch to another origin sends no cookies at
 * all, and every route answers 401 to a person who is plainly signed in.
 */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

/** An absolute API URL, for `<img src>` and links: `api("/api/…")`. */
export const api = (path: string) => `${API_URL}${path}`;

/** `fetch`, pointed at the API, with the session cookie along for the ride. */
export const apiFetch = (path: string, init?: RequestInit) =>
  fetch(api(path), { credentials: "include", ...init });
