"use client";

import { useCallback, useEffect, useState } from "react";
import { json } from "@/lib/api-json";

/**
 * What this machine can do, as the browser sees it.
 *
 * Every field comes off the server, and every one of those came from running
 * something. The page this feeds used to keep a set of ids in memory and call
 * that a connection — it would report yt-dlp as connected on a machine that
 * had never had it, and disconnect it again on reload.
 */

export type BrainStatus = {
  id: string;
  name: string;
  vendor: string;
  role: string;
  command?: string;
  model: string;
  cli: boolean;
  cliVersion: string;
  api: boolean;
  apiFrom: "env" | "settings" | "";
  available: boolean;
  transport: "cli" | "api" | "";
  /** The model that will actually be asked for. */
  using: string;
  reason: string;
};

export type ToolStatus = {
  id: string;
  command: string;
  present: boolean;
  version: string;
  error: string;
  install: string;
};

export type Settings = {
  quality: string;
  autoApprove: boolean;
  reduceMotion: boolean;
  brain: string;
  enabled: string[];
  /**
   * Whether the Claude CLI may open the frame files the researcher picked.
   * Only Claude needs it: Codex and Gemini are handed the picture itself.
   */
  cliCanReadFrames: boolean;
};

export type Wiring = {
  brains: BrainStatus[];
  tools: ToolStatus[];
  settings: Settings;
  /** Ids of the service keys that are stored. Never the keys. */
  keys: string[];
};

export const loadWiring = (recheck = false) =>
  fetch(`/api/integrations${recheck ? "?recheck=1" : ""}`, {
    cache: "no-store",
  }).then((r) => json<Wiring>(r));

export const patchWiring = (body: Partial<Settings>) =>
  fetch("/api/integrations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<Settings>(r));

export type BrainTest = {
  ok: boolean;
  ms: number;
  reply: string;
  error: string;
  /** The command that fixes it, when the failure has an obvious one. */
  fix: string;
  transport?: "cli" | "api" | "";
};

/** Actually send a prompt. The only check that proves a model works. */
export const testBrain = (id: string) =>
  fetch("/api/integrations/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).then((r) => json<BrainTest>(r));

export const loadSettings = () =>
  fetch("/api/settings", { cache: "no-store" }).then((r) => json<Settings>(r));

export const patchSettings = (body: Partial<Settings>) =>
  fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<Settings>(r));

export const loadKeys = () =>
  fetch("/api/settings/keys", { cache: "no-store" }).then((r) =>
    json<Record<string, string>>(r),
  );

export const saveKey = (id: string, value: string) =>
  fetch("/api/settings/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, value }),
  }).then((r) => json<Record<string, string>>(r));

export const removeKey = (id: string) =>
  fetch(`/api/settings/keys?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((r) => json<Record<string, string>>(r));

/**
 * The page's whole state in one hook.
 *
 * `checking` is separate from `loading` so re-probing after installing
 * something can spin its own button without blanking the list underneath it.
 */
export function useWiringState() {
  const [wiring, setWiring] = useState<Wiring | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  /*
   * The first read happens inside the effect rather than through `reload`.
   *
   * A `setState` reached synchronously from an effect body is a re-render
   * before paint; going through the promise keeps the first frame cheap, and
   * it is the same shape the store uses to hydrate.
   */
  useEffect(() => {
    let cancelled = false;
    void loadWiring()
      .then((next) => {
        if (!cancelled) setWiring(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not read this machine");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-probe, for the button that means "I have just installed it". */
  const reload = useCallback(async (recheck = false) => {
    if (recheck) setChecking(true);
    try {
      setWiring(await loadWiring(recheck));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this machine");
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  return { wiring, setWiring, loading, checking, error, reload };
}
