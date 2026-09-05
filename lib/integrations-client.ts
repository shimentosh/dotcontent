"use client";

import { apiFetch } from "@/lib/api-base";
import { useCallback, useEffect, useRef, useState } from "react";
import { json } from "@/lib/api-json";

/**
 * What can run WHERE, as the browser sees it.
 *
 * Every field here used to describe "this machine", because the API process
 * and the machine with the binaries on it were the same computer. They are not
 * any more: work happens on enrolled desktops, and the server has nothing to
 * probe. So the page stops asking "what is installed" and starts asking "what
 * is installed on which machine" — and every row below comes out of a
 * `workers` row that a machine reported about itself, not out of a child
 * process spawned here.
 *
 * The scoping that migration 0016 forced is visible in the shape: `brain` and
 * `apiFallback` hang off a WORKSPACE, `enabled` and `canReadFrames` off a
 * MACHINE, and only `settings` is still console-wide. They were all one flat
 * `settings` object before, which is exactly how a teammate could retune every
 * brand in the database and switch off a binary on somebody else's desktop
 * with the same click.
 */

export type Transport = "cli" | "api" | "";

export type BrainStatus = {
  id: string;
  name: string;
  vendor: string;
  role: string;
  command?: string;
  model: string;
  /** The command is installed on the chosen machine AND switched on for it. */
  cli: boolean;
  cliVersion: string;
  /**
   * A key is stored. This half is a fact about the SERVER, not the machine —
   * the keys live there, encrypted, and the API path runs there as the
   * workspace's fallback. That is why one row can be half true of two
   * different computers, and why `reason` has to say which.
   */
  api: boolean;
  apiFrom: "env" | "settings" | "";
  available: boolean;
  transport: Transport;
  /** The model that will actually be asked for. */
  using: string;
  reason: string;
};

/**
 * A tool as its machine reported it.
 *
 * The same shape `lib/server/tools.ts` produces, because it is literally that
 * array: the worker probes its own hardware and posts the result, the server
 * stores it in `workers.tools`, and this reads it back. Nothing here was
 * checked by the process serving this page.
 */
export type ToolStatus = {
  id: string;
  command: string;
  present: boolean;
  version: string;
  error: string;
  install: string;
};

/** One row in the machine picker. */
export type MachineChoice = {
  id: string;
  name: string;
  platform: string;
  version: string;
  /** Null when a token was minted and never pasted anywhere. */
  lastSeenAt: string | null;
  live: boolean;
};

/** The machine everything else on the page is about. */
export type ChosenMachine = {
  id: string;
  name: string;
  live: boolean;
  lastSeenAt: string | null;
};

/**
 * What is left of the console-wide settings.
 *
 * `brain`, `enabled` and `cliCanReadFrames` are deliberately gone. They were
 * declared here, read here, and — since migration 0016 — arrived as
 * `undefined` from a server that no longer stores them, which is a failure
 * with no error in it. Their replacements are `Wiring.brain` (per workspace),
 * `Wiring.enabled` and `Wiring.canReadFrames` (per machine).
 */
export type Settings = {
  quality: string;
  autoApprove: boolean;
  reduceMotion: boolean;
};

export type Wiring = {
  /** Every enrolled machine. Empty is a real, common state: nothing is wired. */
  machines: MachineChoice[];
  /** The one being reported on, or null when none is enrolled. */
  machine: ChosenMachine | null;
  brains: BrainStatus[];
  /** `workers.tools`, filtered to the media tools. Empty with no machine. */
  tools: ToolStatus[];
  /** The subset of them the machine's owner has switched on. */
  enabled: string[];
  /** `workers.can_read_frames`, which defaults OFF. Per machine, on purpose. */
  canReadFrames: boolean;
  /** The workspace's model. Null when no workspace was named in the query. */
  brain: string | null;
  /** The workspace's API-key fallback. Null when no workspace was named. */
  apiFallback: boolean | null;
  settings: Settings;
  /** Ids of the service keys that are stored. Never the keys. */
  keys: string[];
};

/**
 * Read the wiring for one machine and one workspace.
 *
 * Both are optional and both mean something specific when absent: no machine
 * lets the server pick the most recently live one, because "where can this run
 * right now" is the question, and no workspace means the brain and the
 * fallback come back null rather than as some console-wide value that no
 * longer exists.
 */
export const loadWiring = (scope: { machine?: string; workspace?: string } = {}) => {
  const q = new URLSearchParams();
  if (scope.machine) q.set("machine", scope.machine);
  if (scope.workspace) q.set("workspace", scope.workspace);
  const query = q.toString();
  return apiFetch(`/api/integrations${query ? `?${query}` : ""}`, {
    cache: "no-store",
  }).then((r) => json<Wiring>(r));
};

/**
 * The workspace's model and its API-key fallback.
 *
 * Scoped in the call rather than in the server's guess: an unscoped PATCH is
 * refused now, and correctly — it used to write one brand's editorial choice
 * into every brand in the database.
 */
export const patchWorkspaceWiring = (
  workspace: string,
  body: { brain?: string; apiFallback?: boolean },
) =>
  apiFetch("/api/integrations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, ...body }),
  }).then((r) => json<{ brain: string; apiFallback: boolean }>(r));

/**
 * Which of a machine's tools it may use.
 *
 * The same repo call `PATCH /api/machines/:id` makes, so the switch on this
 * page and the switch in Settings → Machines cannot mean two different things.
 */
export const patchMachineTools = (machine: string, enabled: string[]) =>
  apiFetch("/api/integrations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machine, enabled }),
  }).then((r) => json<{ machine: string; enabled: string[] }>(r));

/**
 * The POST that starts a test — which no longer answers it.
 *
 * Two possible replies, and the difference matters enough to keep both in one
 * type. A `jobId` means a machine has been asked and somebody has to wait. No
 * `jobId` means the server refused before queueing, because that machine does
 * not have that CLI — the same answer two minutes earlier and in better words
 * than a job timing out on a deadline.
 */
export type TestStart = {
  jobId?: string;
  machine: string;
  state?: string;
  ok?: boolean;
  ms?: number;
  reply?: string;
  error?: string;
  fix?: string;
};

export type TestPoll = {
  state: string;
  running: boolean;
  machine: string;
  /** Why nothing has happened yet — "that laptop has not been seen recently". */
  note?: string;
  ok?: boolean;
  ms?: number;
  reply?: string;
  error?: string;
  fix?: string;
  transport?: Transport;
};

/** Ask a named machine to prove a model writes. */
export const startBrainTest = (id: string, machine: string) =>
  apiFetch("/api/integrations/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, machine }),
  }).then((r) => json<TestStart>(r));

export const readBrainTest = (jobId: string) =>
  apiFetch(`/api/integrations/test/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  }).then((r) => json<TestPoll>(r));

export const loadSettings = () =>
  apiFetch("/api/settings", { cache: "no-store" }).then((r) => json<Settings>(r));

export const patchSettings = (body: Partial<Settings>) =>
  apiFetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<Settings>(r));

export const loadKeys = () =>
  apiFetch("/api/settings/keys", { cache: "no-store" }).then((r) =>
    json<Record<string, string>>(r),
  );

export const saveKey = (id: string, value: string) =>
  apiFetch("/api/settings/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, value }),
  }).then((r) => json<Record<string, string>>(r));

export const removeKey = (id: string) =>
  apiFetch(`/api/settings/keys?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((r) => json<Record<string, string>>(r));

/**
 * The page's whole state in one hook, for one machine and one workspace.
 *
 * `checking` is separate from `loading` so switching machines — or pressing
 * Check again — spins its own control without blanking the list underneath
 * it. Both arguments default to empty so the Sidebar's one-line usage, which
 * only wants a count of what is reachable anywhere, still works.
 */
export function useWiringState(machine = "", workspace = "") {
  const scope = `${machine} ${workspace}`;
  /*
   * The answer is kept WITH the question it answers.
   *
   * A machine's rows and the machine they describe cannot be two pieces of
   * state, or the moment somebody switches the picker the page is showing one
   * laptop's tools under another laptop's name — which is precisely the
   * confusion this whole rewrite exists to end. Holding the scope beside the
   * data makes "what you are looking at is not what you asked for" a derived
   * fact rather than a flag that has to be remembered to set.
   */
  const [loaded, setLoaded] = useState<{ scope: string; wiring: Wiring } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadWiring({ machine, workspace })
      .then((next) => {
        if (!cancelled) {
          setLoaded({ scope, wiring: next });
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not read the machines");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [machine, workspace, scope]);

  const setWiring = useCallback(
    (next: Wiring) => {
      setLoaded({ scope, wiring: next });
    },
    [scope],
  );

  /**
   * Re-read what the machines have reported.
   *
   * Deliberately not a probe. There is nothing on this server to probe, and a
   * machine looks at its own disk when its worker starts and reports what it
   * found — so the freshest answer available to anyone is the one already in
   * the table, and making a machine look again means restarting the worker on
   * it. The page says so rather than implying a button here can reach a laptop.
   */
  const reload = useCallback(async () => {
    setBusy(true);
    try {
      setLoaded({ scope, wiring: await loadWiring({ machine, workspace }) });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the machines");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, [machine, workspace, scope]);

  return {
    wiring: loaded?.wiring ?? null,
    setWiring,
    loading,
    /** Re-reading: the button was pressed, or the picker has moved ahead of the answer. */
    checking: busy || (loaded !== null && loaded.scope !== scope),
    error,
    reload,
  };
}

/** What a row shows about a test, whichever of the two shapes came back. */
export type TestView =
  | { running: true; machine: string; note: string }
  | {
      running: false;
      ok: boolean;
      ms: number;
      reply: string;
      error: string;
      fix: string;
      machine: string;
      transport: Transport;
    };

const POLL_MS = 1500;

/*
 * Long enough to outlast the server's 120s `wait_until` plus the reaper that
 * turns it into a failure. Stopping sooner would leave the page saying
 * "running" about a job that has already been told it failed, which is the one
 * thing this button exists not to do.
 */
const GIVE_UP_MS = 210_000;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run a test on a machine and follow it until it answers.
 *
 * Two steps now, because the work happens on a laptop this request has no way
 * to wait for: POST enqueues a `test_brain` job and returns its id, and the
 * answer arrives by polling. The results are kept per model until the page is
 * left, so "Claude works on Rakib's desktop and not on mine" is two clicks and
 * both answers stay on screen.
 */
export function useBrainTests() {
  const [tests, setTests] = useState<Record<string, TestView>>({});
  const alive = useRef(true);

  useEffect(() => {
    // Re-armed on every mount, not only cleared on unmount: React runs an
    // effect, its cleanup and the effect again in development, and a flag only
    // ever set false would kill every poll after the first render.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const put = useCallback((id: string, view: TestView) => {
    if (alive.current) setTests((prev) => ({ ...prev, [id]: view }));
  }, []);

  const test = useCallback(
    async (id: string, machineId: string, machineName: string) => {
      put(id, { running: true, machine: machineName, note: "" });
      try {
        const started = await startBrainTest(id, machineId);
        const where = started.machine || machineName;

        // No job id: the server already knew this machine could not do it.
        if (!started.jobId) {
          put(id, {
            running: false,
            ok: started.ok === true,
            ms: started.ms ?? 0,
            reply: started.reply ?? "",
            error: started.error ?? "",
            fix: started.fix ?? "",
            machine: where,
            transport: "",
          });
          return;
        }

        const until = Date.now() + GIVE_UP_MS;
        for (;;) {
          await wait(POLL_MS);
          if (!alive.current) return;
          const poll = await readBrainTest(started.jobId);
          if (!alive.current) return;

          if (!poll.running) {
            put(id, {
              running: false,
              ok: poll.ok === true,
              ms: poll.ms ?? 0,
              reply: poll.reply ?? "",
              error: poll.error ?? "",
              fix: poll.fix ?? "",
              machine: poll.machine || where,
              transport: poll.transport ?? "",
            });
            return;
          }

          put(id, {
            running: true,
            machine: poll.machine || where,
            note: poll.note ?? "",
          });

          if (Date.now() > until) {
            put(id, {
              running: false,
              ok: false,
              ms: 0,
              reply: "",
              error: `${where} still has not picked this up.`,
              fix: `Open ${where}, check the desktop app is running, and try again`,
              machine: where,
              transport: "",
            });
            return;
          }
        }
      } catch (e) {
        put(id, {
          running: false,
          ok: false,
          ms: 0,
          reply: "",
          error: e instanceof Error ? e.message : "The test could not be started",
          fix: "",
          machine: machineName,
          transport: "",
        });
      }
    },
    [put],
  );

  return { tests, test };
}
