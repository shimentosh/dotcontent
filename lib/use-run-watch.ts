"use client";

import { useEffect, useState } from "react";

import { getRun, isWriting, type Run } from "@/lib/runs-client";

/**
 * The server's copy of one run, kept current while it moves.
 *
 * Lifted out of DocumentView, where it was sixty lines in the middle of a
 * nineteen-hundred-line screen — and where the subtlest bug on the page lived:
 * the poll worked, and what it fetched was never rendered, because the store's
 * once-loaded list was consulted first. Whoever calls this has to prefer what
 * it returns over any list copy of the same run.
 *
 * Two jobs, because they are the same fact: fetch the run the URL names (it may
 * be seconds old and not in any list yet), then follow it — fast while
 * something is being written, slowly once it settles, so a page left open
 * overnight is not asking twice a second.
 */
export function useRunWatch(runId: string | null | undefined) {
  const [fetched, setFetched] = useState<Run | null>(null);
  const [serverWriting, setServerWriting] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void getRun(runId)
      .then((r) => {
        if (!cancelled) setFetched(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let stop = false;

    const tick = async () => {
      try {
        const [state, fresh] = await Promise.all([
          isWriting(runId),
          getRun(runId),
        ]);
        if (stop) return;
        setServerWriting(state.running);
        if (fresh) setFetched(fresh);
        return state.running ? 1500 : 6000;
      } catch {
        return 6000;
      }
    };

    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const wait = (await tick()) ?? 6000;
      if (!stop) timer = setTimeout(() => void loop(), wait);
    };
    void loop();

    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId]);

  /**
   * `setFetched` is handed back on purpose: writing a section returns the whole
   * run, and the page that asked has the answer a poll would spend a second and
   * a half getting to. `setServerWriting` likewise, so pressing "Write the
   * rest" shows as busy before the first poll confirms it.
   */
  return { fetched, setFetched, serverWriting, setServerWriting };
}
