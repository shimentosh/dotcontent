import { describe, expect, it } from "vitest";

import { sessionFromHeader } from "@/lib/server/auth";

/**
 * Which credential is which.
 *
 * The API takes three now — the session cookie a browser sends, the session id
 * the desktop app sends as `Authorization: Session <id>` because a webview on
 * a local origin cannot keep a third-party cookie, and the worker token a
 * machine sends as `Authorization: Bearer <token>`. Two of those three arrive
 * in the same header, and telling them apart is one regex in `SessionGuard`.
 *
 * That regex is worth a test for one specific failure: a `Bearer` header
 * reading as a session. A worker token is a machine's credential over nine
 * queue routes; a session is a person's credential over the whole console —
 * every run, every template, and the ability to spend model budget. A guard
 * that accepted either word would let the first stand in for the second, which
 * is the merge `docs/WORKER.md` argues against under "The desktop app holds
 * two credentials, on purpose". Nothing about that is visible in a screenshot
 * and nothing in `tsc` would notice a loosened pattern.
 *
 * The lookup itself is not tested here on purpose: it is `sessionUser`, the
 * same call the cookie path has always made, and a second copy of that
 * assertion would only be testing Postgres.
 */
describe("what an Authorization header counts as", () => {
  it("reads a session sent under its own scheme", () => {
    expect(sessionFromHeader("Session abc123")).toBe("abc123");
  });

  it("is not fussy about the case or the spacing a client uses", () => {
    expect(sessionFromHeader("session   abc123")).toBe("abc123");
    expect(sessionFromHeader("  SESSION abc123  ")).toBe("abc123");
  });

  /*
   * The one that matters. `Bearer` belongs to `WorkerGuard`, and a worker
   * token that satisfied the console's guard would be a stolen machine
   * credential reading the content library.
   */
  it("refuses a worker's bearer token", () => {
    expect(sessionFromHeader("Bearer wrk_aaaabbbbcccc")).toBe("");
  });

  it("refuses anything else, including a scheme that only starts the same", () => {
    expect(sessionFromHeader("Basic dXNlcjpwYXNz")).toBe("");
    expect(sessionFromHeader("Sessionabc123")).toBe("");
    expect(sessionFromHeader("Session")).toBe("");
    expect(sessionFromHeader("Session   ")).toBe("");
    expect(sessionFromHeader("")).toBe("");
    expect(sessionFromHeader(undefined)).toBe("");
  });
});
