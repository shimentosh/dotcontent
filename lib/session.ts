/**
 * The session cookie's name, and nothing else.
 *
 * Its own file because the middleware needs it and the middleware runs on the
 * Edge runtime: importing it from the auth module drags node:crypto and the
 * Postgres pool in with it, which the Edge runtime cannot load at all.
 */
export const SESSION_COOKIE = "dotcontent_session";
