"use client";

import { apiFetch } from "@/lib/api-base";
import { useCallback, useEffect, useState } from "react";

import { json } from "@/lib/api-json";
import { font, panel, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Button, Chip, Field, TextInput } from "@/components/ui";
import { CopyIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";

type Person = {
  id: string;
  email: string;
  name: string;
  owner: boolean;
  createdAt: string;
  lastSeenAt: string;
};

type Invite = {
  token: string;
  email: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  state: "open" | "used" | "expired";
};

const TONE = {
  open: "good",
  used: "mute",
  expired: "warn",
} as const;

/**
 * Getting other people in.
 *
 * The console closes signup the moment it has an owner, which is right for one
 * person on one laptop and a locked door the moment it is shared: an employee
 * had no way to make an account at all. An invite is a link — the token IS the
 * credential, so it is created here, copied, and sent however you already talk
 * to each other. There is no email sender in this app and adding one to hand
 * over a URL would be a service to run for no gain.
 *
 * Everyone who joins shares the workspace: the same templates, series and
 * content, live. That is the point of putting it online, and it is said on the
 * panel rather than left to be discovered.
 */
export function TeamPanel() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    void apiFetch("/api/invites", { cache: "no-store" })
      .then((r) => json<Invite[]>(r))
      .then(setInvites)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not read the invites"),
      );
    void apiFetch("/api/users", { cache: "no-store" })
      .then((r) => json<Person[]>(r))
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  useEffect(load, [load]);

  const linkFor = (token: string) =>
    `${window.location.origin}/signup?invite=${token}`;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const made = await apiFetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), note: note.trim() }),
      }).then((r) => json<Invite>(r));

      setEmail("");
      setNote("");
      setInvites((prev) => [made, ...(prev ?? [])]);
      // Straight to the clipboard: the only thing to do with a fresh invite is
      // send it, and the link is 60 characters nobody should be reading off a
      // screen.
      await navigator.clipboard?.writeText(linkFor(made.token)).catch(() => {});
      setCopied(made.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make an invite");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    setInvites((prev) => (prev ?? []).filter((i) => i.token !== token));
    await apiFetch(`/api/invites/${token}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  const removePerson = async (person: Person) => {
    setPeople((prev) => (prev ?? []).filter((p) => p.id !== person.id));
    await apiFetch(`/api/users/${person.id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  return (
    <>
      {/*
        Who is in, before how to let anyone else in.
        An invite-only console needs both halves on one screen: without this,
        the only way to know who could open the app was to ask around.
      */}
      <div style={{ ...panel(18), padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>Who has access</div>
        <p style={{ margin: "5px 0 14px", fontSize: 12.5, color: t(0.5) }}>
          Everyone here can read and change everything in this workspace.
          Removing someone ends their sessions at once; what they wrote stays.
        </p>

        {(people ?? []).map((person) => (
          <div
            key={person.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 0",
              borderBottom: `1px solid ${w(0.05)}`,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                flex: "none",
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
                background: "linear-gradient(150deg,#93a7c0,#4a5a70)",
              }}
            >
              {(person.name || person.email).slice(0, 2).toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {person.name || person.email}
              </div>
              <div style={{ fontSize: 11, color: t(0.4) }}>{person.email}</div>
            </div>
            {person.owner ? (
              <Chip tone="accent">owner</Chip>
            ) : (
              <Hov
                onClick={() => void removePerson(person)}
                aria-label={`Remove ${person.email}`}
                title="Remove access"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  cursor: "pointer",
                  color: "#d1656b",
                  background: "rgba(209,101,107,0.12)",
                  border: "1px solid rgba(209,101,107,0.24)",
                }}
                hover={{ background: "rgba(209,101,107,0.22)" }}
              >
                <TrashIcon size={11} stroke="currentColor" />
              </Hov>
            )}
          </div>
        ))}

        {people?.length === 0 ? (
          <div style={{ fontSize: 12.5, color: t(0.4) }}>Nobody yet.</div>
        ) : null}
      </div>

    <div style={{ ...panel(18), padding: 18 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700 }}>Invite someone</div>
      <p
        style={{
          margin: "5px 0 16px",
          fontSize: 12.5,
          color: t(0.5),
          textWrap: "pretty",
        }}
      >
        They get their own sign-in and share this workspace — the same
        templates, series and content, live. Send them the link; it works once
        and expires in 14 days.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Their email" hint="optional — locks the link to them">
          <TextInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@company.com"
          />
        </Field>
        <Field label="Note" hint="optional — who this is, for your own list">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Rakib — scripts"
          />
        </Field>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button variant="primary" onClick={() => void create()} disabled={busy}>
          <PlusIcon size={13} stroke="#fff" strokeWidth={2.2} />
          Create invite link
        </Button>
        {error ? (
          <span style={{ fontSize: 12, color: "#d1656b" }}>{error}</span>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 20,
          paddingTop: 14,
          borderTop: `1px solid ${w(0.07)}`,
          fontFamily: font.mono,
          fontSize: 9.5,
          letterSpacing: "0.14em",
          color: t(0.35),
        }}
      >
        INVITES
      </div>

      {invites === null ? (
        <div style={{ padding: "12px 0", fontSize: 12.5, color: t(0.4) }}>
          Reading…
        </div>
      ) : invites.length === 0 ? (
        <div style={{ padding: "12px 0", fontSize: 12.5, color: t(0.4) }}>
          None yet. Everyone but you is locked out until there is one.
        </div>
      ) : (
        invites.map((invite) => (
          <div
            key={invite.token}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 0",
              borderBottom: `1px solid ${w(0.05)}`,
            }}
          >
            <Chip tone={TONE[invite.state]}>{invite.state}</Chip>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {invite.email || invite.note || "Anyone with the link"}
              </div>
              <div style={{ fontSize: 11, color: t(0.4) }}>
                {invite.email && invite.note ? `${invite.note} · ` : ""}
                {invite.state === "used"
                  ? `used ${new Date(invite.usedAt!).toLocaleDateString()}`
                  : `expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
              </div>
            </div>

            {invite.state === "open" ? (
              <>
                <Hov
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(linkFor(invite.token))
                      .catch(() => {});
                    setCopied(invite.token);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    color: copied === invite.token ? "#4bb07a" : t(0.6),
                    background: w(0.06),
                    border: `1px solid ${w(0.09)}`,
                  }}
                  hover={{ background: w(0.12) }}
                >
                  <CopyIcon size={11} stroke="currentColor" />
                  {copied === invite.token ? "Copied" : "Copy link"}
                </Hov>
                <Hov
                  onClick={() => void revoke(invite.token)}
                  aria-label="Revoke this invite"
                  title="Revoke"
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    cursor: "pointer",
                    color: "#d1656b",
                    background: "rgba(209,101,107,0.12)",
                    border: "1px solid rgba(209,101,107,0.24)",
                  }}
                  hover={{ background: "rgba(209,101,107,0.22)" }}
                >
                  <TrashIcon size={11} stroke="currentColor" />
                </Hov>
              </>
            ) : null}
          </div>
        ))
      )}
    </div>
    </>
  );
}
