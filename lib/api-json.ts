"use client";

/**
 * Reading a JSON response, for every client-side fetch in the app.
 *
 * The four API clients each had this function, identical, and each turned a
 * 401 into a red banner reading "Sign in first" — accurate, and a dead end:
 * the page stays up, empty, with nothing on it that signs you in. A 401 means
 * the session is gone (expired, signed out in another tab, or a tab left open
 * from before the sign-in gate existed), so the browser is sent to the form
 * that fixes it, carrying where it was headed.
 */
export async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };

  if (
    res.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    const next = window.location.pathname + window.location.search;
    /*
     * A full load, not a router push. The shell around this page was rendered
     * for a session that no longer exists, and the router cache still holds
     * payloads fetched under it; throwing the document away is the point.
     */
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
    // The navigation is asynchronous. Throwing stops whatever called this from
    // rendering half a page against data it was never given.
    throw new Error("Signing in\u2026");
  }

  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
