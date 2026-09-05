"use client";

import { apiFetch } from "@/lib/api-base";
import { json } from "@/lib/api-json";
import type { ToolStatus } from "@/lib/server/tools";
import type { Worker } from "@/lib/server/repos/workers";

/**
 * The browser's half of Settings → Machines.
 *
 * Session-authenticated like every other `lib/*-client.ts`: these are the
 * console's routes, reached with the cookie `apiFetch` carries. The worker's
 * own six endpoints under `/api/workers` are bearer-token only and are spoken
 * by the desktop app, never by this file — nothing in the browser has, or
 * should be able to get, a worker token after the one moment it is shown.
 *
 * `Worker` comes from the server's own module rather than being redeclared
 * here, so the two descriptions of this JSON boundary cannot disagree — a
 * disagreement shows up as a blank field, not as an error.
 */
export type { ToolStatus };

/** A machine row as the console reads it: the worker, plus whose it is. */
export type Machine = Worker & {
  ownerName: string;
  ownerEmail: string;
  /** Enrolled here, but the machine itself has not checked in yet. */
  awaitingFirstContact: boolean;
};

/** The switches that belong to whoever owns the machine. */
export type MachinePatch = {
  name?: string;
  enabled?: string[];
  canReadFrames?: boolean;
  maxConcurrency?: number;
};

/** Every machine, most recently seen first. */
export const listMachines = () =>
  apiFetch("/api/machines", { cache: "no-store" }).then((r) =>
    json<Machine[]>(r),
  );

/**
 * Enrol a machine and get its token.
 *
 * The token is in this response and in no other, ever: the server keeps only
 * its sha256. Whatever calls this has one chance to put it in front of a
 * person and on their clipboard.
 */
export const mintMachine = (name: string) =>
  apiFetch("/api/machines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => json<{ machine: Machine; token: string }>(r));

export const patchMachine = (id: string, patch: MachinePatch) =>
  apiFetch(`/api/machines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => json<Machine>(r));

/** Revoke: the row goes, and the token with it. */
export const revokeMachine = (id: string) =>
  apiFetch(`/api/machines/${id}`, { method: "DELETE" }).then((r) =>
    json<{ ok: true }>(r),
  );
