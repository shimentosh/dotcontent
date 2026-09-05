"use client";

import { useEffect, useRef, useState } from "react";

import { getRun, isWriting, type Run } from "@/lib/runs-client";

/**
 * How often to ask, for each of the three things a run can be doing.
 *
 * The old loop knew two speeds — 1.5s while "running", 6s otherwise — because
 * running meant a loop inside the API process was writing a section this
 * second. It does not any more. A run whose sections are jobs is *running* the
 * whole time it sits on the queue waiting for somebody to open their laptop,
 * which can be until tomorrow, and asking twice a second about that is a hot
 * spin against the API for a fact that will not change for hours.
 *
 * So the speed follows what is actually moving:
 *
 * - `writing` — a machine is holding a section right now, and the text can
 *   land at any moment. Worth a second and a half.
 * - `waiting` — jobs exist, nothing has claimed them. Something WILL happen,
 *   just not this second: five seconds, stretched to fifteen once it has been
 *   like that for a couple of minutes, because "queued behind a laptop that is
 *   shut" is a state measured in hours.
 * - `settled` — nothing on the queue. Eight seconds, stretched to thirty when
 *   nothing has changed for a while, so a page left open overnight costs a
 *   couple of requests a minute rather than a thousand.
 */
const PACE = {
  writing: 1500,
  waiting: 5000,
  waitingSlow: 15000,
  settled: 8000,
  settledSlow: 30000,
} as const;

/** How long a state has to hold before the slow cadence takes over. */
const PATIENCE_MS = 120_000;

/** Backoff for a failing poll, and its ceiling. */
const RETRY_FLOOR = 4000;
const RETRY_CEILING = 30_000;

export type RunWatch = {
  fetched: Run | null;
  setFetched: (run: Run | null) => void;
  /** Anything on the queue for this run, on any machine. */
  serverWriting: boolean;
  setServerWriting: (running: boolean) => void;
  /**
   * Jobs exist but no section says `writing`: the work is queued and no
   * machine has picked it up. The page says something different for this than
   * for "a model is typing", because the answer is usually to switch a
   * computer on.
   */
  waitingForMachine: boolean;
};

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
 * be seconds old and not in any list yet), then follow it — at whichever of the
 * three speeds above matches what the run is actually doing.
 *
 * It never gives up. A run can legitimately sit queued for a day waiting for a
 * machine, and it can resume on a different machine than the one it started
 * on, so there is no point at which "nothing has happened lately" means
 * "nothing will". Failures back off and keep asking; they do not stop, and
 * they do not throw away the copy already on screen.
 */
export function useRunWatch(runId: string | null | undefined): RunWatch {
  const [fetched, setFetched] = useState<Run | null>(null);
  const [serverWriting, setServerWriting] = useState(false);
  const [waitingForMachine, setWaitingForMachine] = useState(false);

  /*
   * What the loop needs to know, in refs rather than in its dependencies.
   *
   * The interval is decided from the last answer, and putting that answer in
   * the effect's deps would tear the timer down and rebuild it on every poll —
   * which is how a "slow" poll quietly becomes an immediate one.
   */
  const since = useRef({ pace: "" as string, at: 0 });
  const failures = useRef(0);

  useEffect(() => {
    // Nothing to follow, and deliberately nothing set: writing state from an
    // effect makes React render twice to reach the same screen. What a caller
    // sees with no run is derived at the bottom of this hook instead.
    if (!runId) return;

    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    since.current = { pace: "", at: Date.now() };
    failures.current = 0;

    /** One poll. Returns how long to wait before the next one. */
    const tick = async (): Promise<number> => {
      let answer: [{ running: boolean }, Run | null];
      try {
        answer = await Promise.all([isWriting(runId), getRun(runId)]);
      } catch {
        /*
         * A failed poll is not an answer about the run.
         *
         * The API restarting, a laptop's wifi blinking, a 502 from a proxy —
         * none of them mean the run stopped, and the old loop's flat six-second
         * retry hammered a dead API for as long as the page stayed open. Back
         * off, keep the last good copy on screen, and keep asking.
         */
        failures.current += 1;
        return Math.min(RETRY_FLOOR * 2 ** (failures.current - 1), RETRY_CEILING);
      }
      failures.current = 0;
      if (stop) return PACE.settled;
      const [{ running }, fresh] = answer;

      const writing = Boolean(fresh?.sections.some((s) => s.state === "writing"));
      setServerWriting(running);
      setWaitingForMachine(running && !writing);
      if (fresh) setFetched(fresh);

      /*
       * How long this has been true, so a long wait can slow down.
       *
       * Keyed on the pace rather than on the run's `updatedAt`: a run whose
       * sections are being written changes constantly and must stay fast, and
       * a run that is merely queued does not change at all — which is exactly
       * the case the timer is being stretched for.
       */
      const pace = writing ? "writing" : running ? "waiting" : "settled";
      if (pace !== since.current.pace) since.current = { pace, at: Date.now() };
      const held = Date.now() - since.current.at;

      if (pace === "writing") return PACE.writing;
      if (pace === "waiting") {
        return held > PATIENCE_MS ? PACE.waitingSlow : PACE.waiting;
      }
      return held > PATIENCE_MS ? PACE.settledSlow : PACE.settled;
    };

    const loop = async () => {
      const wait = await tick();
      if (!stop) timer = setTimeout(() => void loop(), wait);
    };

    /*
     * A hidden tab asks nothing, and asks again the moment it is looked at.
     *
     * Browsers already clamp timers in a background tab, but not to zero, and
     * "someone left fifteen run pages open" is a real shape of this app's use.
     * Coming back has to be instant, though: a person switching to this tab to
     * see whether it finished must not read a thirty-second-old page.
     */
    const wake = () => {
      if (stop || document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void loop();
    };
    document.addEventListener("visibilitychange", wake);

    void loop();

    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [runId]);

  /**
   * `setFetched` is handed back on purpose: queueing a section returns the
   * whole run, and the page that asked has the answer a poll would spend a
   * second and a half getting to. `setServerWriting` likewise, so pressing
   * "Write the rest" — or Stop — shows before the first poll confirms it.
   */
  /*
   * With no run there is nothing true to say about one.
   *
   * Derived rather than cleared in the effect: a stale `fetched` belonging to
   * the run we just navigated away from must not be handed back for one render
   * while an effect catches up, and clearing it in an effect is exactly that
   * render. The state itself is left alone, so coming back to the same run
   * still has its last copy.
   */
  if (!runId) {
    return {
      fetched: null,
      setFetched,
      serverWriting: false,
      setServerWriting,
      waitingForMachine: false,
    };
  }

  return {
    fetched,
    setFetched,
    serverWriting,
    setServerWriting,
    waitingForMachine,
  };
}
