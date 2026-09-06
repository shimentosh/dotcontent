import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adoptTarget } from "@/lib/server/auth";

/**
 * Where a hand-off is allowed to put somebody down.
 *
 * `GET /api/auth/adopt` sets a session cookie and then redirects, and those
 * two halves together are worth more to an attacker than either on its own: a
 * link that lands a browser on your page *already signed in as its owner* is a
 * different thing from an open redirect. So the one rule that keeps it honest
 * — the redirect target must be the console — is the thing worth pinning.
 *
 * Pure, and therefore here rather than in a request test. Nothing about a
 * loosened check is visible to `tsc`, nothing about it shows in a screenshot,
 * and the failure it prevents is not a broken page but a working one on
 * somebody else's domain.
 *
 * The single-use and expiry rules live in Postgres — one `UPDATE ... WHERE
 * used_at IS NULL` — and are proved against a real API rather than mocked
 * here; see docs/WORKER.md, "The hand-off".
 */

const ORIGINAL = process.env.WEB_ORIGIN;

beforeEach(() => {
  process.env.WEB_ORIGIN = "https://console.example.com,https://old.example.com";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = ORIGINAL;
});

describe("where a hand-off may redirect to", () => {
  it("allows the console it was told about", () => {
    expect(adoptTarget("https://console.example.com/content")).toBe(
      "https://console.example.com/content",
    );
  });

  it("allows every origin WEB_ORIGIN names, because CORS already does", () => {
    expect(adoptTarget("https://old.example.com/")).toBe("https://old.example.com/");
  });

  /* A path is what the app has when it wants to land somebody on one screen. */
  it("resolves a path against the console", () => {
    expect(adoptTarget("/runs/run_x")).toBe("https://console.example.com/runs/run_x");
  });

  it("sends an empty next to the console's front door", () => {
    expect(adoptTarget("")).toBe("https://console.example.com");
    expect(adoptTarget("   ")).toBe("https://console.example.com");
  });

  /*
   * The four that matter, and they are one rule: whatever the string parses
   * to, its ORIGIN has to be on the list. A scheme, a host and a port is all
   * an origin is, so a protocol-relative host, a `javascript:` URL and the
   * console's name smuggled in as a username all miss it without any of them
   * needing to be recognised on its own.
   */
  it("refuses another host outright", () => {
    expect(adoptTarget("https://evil.example.com/")).toBeNull();
  });

  it("refuses a protocol-relative host, which is a host and not a path", () => {
    expect(adoptTarget("//evil.example.com/")).toBeNull();
  });

  it("refuses a scheme that is not the web", () => {
    expect(adoptTarget("javascript:alert(1)")).toBeNull();
    expect(adoptTarget("data:text/html,<script>1</script>")).toBeNull();
  });

  it("refuses the console's name used as a username on somebody else's host", () => {
    expect(adoptTarget("https://console.example.com@evil.example.com/")).toBeNull();
  });

  /* Same host, wrong scheme or wrong port, is a different origin and is not it. */
  it("refuses the same host on another scheme or port", () => {
    expect(adoptTarget("http://console.example.com/")).toBeNull();
    expect(adoptTarget("https://console.example.com:8443/")).toBeNull();
  });

  it("refuses a subdomain of the console, which is not the console", () => {
    expect(adoptTarget("https://uploads.console.example.com/")).toBeNull();
  });

  /*
   * A deployment that names no console has nowhere legitimate to send anyone,
   * and must refuse rather than fall back to a default host that would then be
   * the one origin an attacker knows is always allowed.
   */
  it("refuses everything when WEB_ORIGIN is unusable", () => {
    process.env.WEB_ORIGIN = "not a url";
    expect(adoptTarget("https://console.example.com/")).toBeNull();
    expect(adoptTarget("")).toBeNull();
  });
});
