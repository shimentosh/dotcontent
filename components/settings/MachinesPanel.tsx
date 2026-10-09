"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { ago } from "@/lib/packs-client";
import {
  listMachines,
  mintMachine,
  patchMachine,
  revokeMachine,
  type Machine,
} from "@/lib/machines-client";
import { font, panel, t, w } from "@/lib/theme";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  IconButton,
  ListCell,
  ListHeader,
  ListPanel,
  ListRow,
  Modal,
  RowTile,
  Segmented,
  TextInput,
  Toggle,
} from "@/components/ui";
import { CopyIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";
import { CpuGlyph, KeyGlyph, WrenchGlyph } from "@/components/ui/DocIcons";

const COLUMNS = "1.6fr 104px 1.3fr 104px 66px";

/** The four values a machine's concurrency is ever set to, as a pill row. */
const CONCURRENCY = ["1", "2", "3", "4"] as const;

/**
 * The machines that do the work.
 *
 * Runs used to happen inside the API process, on whatever box answered HTTP.
 * They now happen on desktops — one per teammate, each with its own signed-in
 * CLI and its own GPU — which makes "which machines are there, and what may
 * they do" a thing somebody has to be able to see and change. This is that
 * screen.
 *
 * It mints a credential, shows it once, lists who holds one and revokes it —
 * the same shape as the invite panel next door, deliberately, because it is
 * the same problem and two consoles for it would be one too many.
 */
export function MachinesPanel() {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The one moment the token exists in a browser. Cleared, never re-fetched. */
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [revoking, setRevoking] = useState<Machine | null>(null);

  const load = useCallback(() => {
    void listMachines()
      .then(setMachines)
      .catch((e: unknown) => {
        setMachines([]);
        setError(
          e instanceof Error ? e.message : "Could not read the machines",
        );
      });
  }, []);

  useEffect(load, [load]);

  const enrol = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const made = await mintMachine(name.trim());
      setName("");
      setMachines((prev) => [made.machine, ...(prev ?? [])]);
      setMinted({ name: made.machine.name, token: made.token });
      // Straight to the clipboard, as an invite link is: the only thing to do
      // with a fresh token is paste it into the desktop app, and it is 50
      // characters nobody should be reading off a screen.
      await navigator.clipboard?.writeText(made.token).catch(() => {});
      setCopied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enrol a machine");
    } finally {
      setBusy(false);
    }
  };

  const save = async (id: string, patch: Parameters<typeof patchMachine>[1]) => {
    const saved = await patchMachine(id, patch).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "That did not save");
      return null;
    });
    if (!saved) return;
    setMachines((prev) => (prev ?? []).map((m) => (m.id === saved.id ? saved : m)));
    setEditing((prev) => (prev && prev.id === saved.id ? saved : prev));
  };

  const revoke = async (machine: Machine) => {
    setRevoking(null);
    setMachines((prev) => (prev ?? []).filter((m) => m.id !== machine.id));
    await revokeMachine(machine.id).catch(() => {});
    load();
  };

  return (
    <>
      <div style={{ ...panel(18), padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>Enrol a machine</div>
        <p
          style={{
            margin: "5px 0 14px",
            fontSize: 12.5,
            color: t(0.5),
            textWrap: "pretty",
          }}
        >
          A machine is one desktop running the dotcontent worker, under one
          person&rsquo;s login, with their own model CLI and their own GPU. Name
          it here, paste the token it gives you into the desktop app on that
          computer, and it starts asking for work. Nothing runs on the server
          itself.
        </p>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}
        >
          <Field
            label="What is it called"
            hint="a person picking a machine reads this — not a hostname"
          >
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void enrol();
              }}
              placeholder="e.g. Rakib’s desktop"
            />
          </Field>
          <div style={{ alignSelf: "center", paddingTop: 6 }}>
            <Button
              variant="primary"
              size="md"
              onClick={() => void enrol()}
              disabled={busy || !name.trim()}
              icon={<PlusIcon size={13} stroke="#fff" strokeWidth={2.2} />}
            >
              Create token
            </Button>
          </div>
        </div>

        {error ? (
          <div style={{ fontSize: 12, color: "#d1656b" }}>{error}</div>
        ) : null}

        {/*
          Shown once, and this is the once.
          The server keeps only a sha256 of it, for the same reason API keys
          are encrypted and invite tokens are hashed: a database dump must not
          be a list of live credentials. There is no route that can show it
          again — if it is lost, revoke the machine and enrol it afresh.
        */}
        {minted ? (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 14,
              background: "rgba(0,87,252,0.08)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "rgba(0,87,252,0.22)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <KeyGlyph size={13} stroke="#6a9dff" />
              The token for {minted.name}
            </div>
            <p
              style={{
                margin: "5px 0 10px",
                fontSize: 11.5,
                color: t(0.5),
                textWrap: "pretty",
              }}
            >
              Copied to your clipboard. This is the only time it is shown —
              only a hash of it is stored, so nothing here can print it again.
              Paste it into the desktop app on that machine; if you lose it,
              revoke the machine below and enrol it again.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "8px 10px",
                  borderRadius: 9,
                  background: "rgba(0,0,0,0.34)",
                  border: `1px solid ${w(0.09)}`,
                  fontFamily: font.mono,
                  fontSize: 11.5,
                  color: t(0.8),
                  overflowWrap: "anywhere",
                }}
              >
                {minted.token}
              </code>
              <Button
                icon={<CopyIcon size={11} stroke="currentColor" />}
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(minted.token)
                    .catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setMinted(null);
                  setCopied(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ListPanel>
        <ListHeader
          columns={COLUMNS}
          labels={["MACHINE", "STATUS", "TOOLS", "LAST SEEN", ""]}
        />

        {machines === null ? (
          <EmptyState compact title="Reading the machines…" />
        ) : machines.length === 0 ? (
          <EmptyState
            compact
            icon={<CpuGlyph size={15} stroke={t(0.4)} />}
            title="No machines yet"
            line="Until one is enrolled there is nowhere for a run to happen."
          />
        ) : (
          machines.map((machine) => (
            <ListRow
              key={machine.id}
              columns={COLUMNS}
              onClick={() => setEditing(machine)}
            >
              <ListCell
                icon={
                  <RowTile bg={machine.live ? "rgba(75,176,122,0.16)" : w(0.06)}>
                    <CpuGlyph
                      size={13}
                      stroke={machine.live ? "#4bb07a" : t(0.45)}
                    />
                  </RowTile>
                }
                title={machine.name}
                subtitle={[
                  machine.ownerName,
                  machine.platform,
                  machine.version,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />

              <Status machine={machine} />

              <Tools machine={machine} />

              <span style={{ fontSize: 11.5, color: t(0.45) }}>
                {machine.lastSeenAt ? ago(machine.lastSeenAt) : "never"}
              </span>

              <span style={{ display: "flex", gap: 4 }}>
                <IconButton
                  label={`Settings for ${machine.name}`}
                  stopPropagation
                  onClick={() => setEditing(machine)}
                >
                  <WrenchGlyph size={12} stroke="currentColor" />
                </IconButton>
                <IconButton
                  label={`Revoke ${machine.name}`}
                  variant="danger"
                  stopPropagation
                  onClick={() => setRevoking(machine)}
                >
                  <TrashIcon size={11} stroke="currentColor" />
                </IconButton>
              </span>
            </ListRow>
          ))
        )}
      </ListPanel>

      <p
        style={{
          margin: "10px 2px 0",
          fontSize: 11.5,
          color: t(0.35),
          textWrap: "pretty",
        }}
      >
        A grey tool is one that machine does not have — an install away, on that
        computer. A machine that is offline is a different thing entirely: its
        tools are still listed because they are still installed; it is simply
        not there to run them, and the fix is somebody opening their laptop.
      </p>

      {editing ? (
        <MachineSettings
          machine={editing}
          onClose={() => setEditing(null)}
          onSave={save}
          onRevoke={() => {
            const m = editing;
            setEditing(null);
            setRevoking(m);
          }}
        />
      ) : null}

      {revoking ? (
        <Modal
          open
          tone="danger"
          width={480}
          title={`Revoke ${revoking.name}?`}
          subtitle="Its token stops working immediately."
          icon={<TrashIcon size={15} stroke="currentColor" />}
          onClose={() => setRevoking(null)}
          footer={
            <>
              <Button
                onClick={() => setRevoking(null)}
                style={{ marginLeft: "auto" }}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={() => void revoke(revoking)}
              >
                Revoke this machine
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 12.5, color: t(0.6), lineHeight: 1.5 }}>
            Anything it was part way through is not lost and is not finished
            either: the job goes back in the queue within a minute or two and
            the next capable machine picks it up from the start. A section is
            written whole or not at all, so nothing half-done is saved.
          </p>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 12.5,
              color: t(0.6),
              lineHeight: 1.5,
            }}
          >
            The token cannot be brought back — only its hash was ever stored.
            Putting this machine back means enrolling it again and pasting a new
            one into the desktop app.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Three states, and the difference between them is the point of the column.
 *
 * "Waiting" is a row that exists because somebody made a token and has not
 * pasted it anywhere yet — it has never reported a thing about itself.
 * "Offline" is a machine that has told us all about itself and is currently
 * shut. Collapsing the two would make a token nobody used look like a laptop
 * somebody closed.
 */
function Status({ machine }: { machine: Machine }) {
  if (machine.awaitingFirstContact)
    return (
      <Chip tone="warn" title="The token has not been pasted in anywhere yet">
        Waiting
      </Chip>
    );
  if (machine.live)
    return (
      <Chip tone="good" pulse>
        Online
      </Chip>
    );
  return (
    <Chip tone="mute" title="Installed and known, just not switched on now">
      Offline
    </Chip>
  );
}

/** What the machine reported, and which of it its owner has switched on. */
function Tools({ machine }: { machine: Machine }) {
  if (machine.awaitingFirstContact)
    return (
      <span style={{ fontSize: 11.5, color: t(0.35) }}>nothing reported yet</span>
    );

  const present = machine.tools.filter((tool) => tool.present);
  if (!present.length)
    return (
      <span style={{ fontSize: 11.5, color: t(0.35) }}>no tools installed</span>
    );

  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {present.map((tool) => {
        const on = machine.enabled.includes(tool.id);
        return (
          <Chip
            key={tool.id}
            mono
            tone={on ? "good" : "mute"}
            title={
              on
                ? `${tool.version || "installed"} — switched on`
                : "Installed, switched off here"
            }
          >
            {tool.id}
          </Chip>
        );
      })}
    </span>
  );
}

/**
 * The switches the machine is not allowed to set for itself.
 *
 * `registerWorker` refuses to overwrite any of these when a worker
 * re-registers, which is the whole reason this dialog exists: a machine
 * restarting with its defaults must not hand itself back a permission somebody
 * switched off here.
 */
function MachineSettings({
  machine,
  onClose,
  onSave,
  onRevoke,
}: {
  machine: Machine;
  onClose: () => void;
  onSave: (
    id: string,
    patch: {
      name?: string;
      enabled?: string[];
      canReadFrames?: boolean;
      maxConcurrency?: number;
    },
  ) => Promise<void>;
  onRevoke: () => void;
}) {
  const [name, setName] = useState(machine.name);
  const [enabled, setEnabled] = useState<string[]>(machine.enabled);
  const [canReadFrames, setCanReadFrames] = useState(machine.canReadFrames);
  const [maxConcurrency, setMaxConcurrency] = useState(machine.maxConcurrency);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setEnabled((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const apply = async () => {
    setBusy(true);
    try {
      await onSave(machine.id, {
        name: name.trim() || machine.name,
        enabled,
        canReadFrames,
        maxConcurrency,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={machine.name}
      subtitle={`${machine.ownerName}${
        machine.platform ? ` · ${machine.platform}` : ""
      }${machine.version ? ` · worker ${machine.version}` : ""} · ${
        machine.lastSeenAt ? `seen ${ago(machine.lastSeenAt)}` : "never seen"
      }`}
      icon={<CpuGlyph size={15} stroke="currentColor" />}
      footer={
        <>
          <Button
            variant="danger"
            onClick={onRevoke}
            icon={<TrashIcon size={11} stroke="currentColor" />}
          >
            Revoke
          </Button>
          <Button onClick={onClose} style={{ marginLeft: "auto" }}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void apply()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Name" hint="what this machine is called in the picker">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Row
        label="Tools this machine may use"
        hint={
          machine.awaitingFirstContact
            ? "It has not reported anything yet. Start the desktop app on that computer and its tools appear here."
            : "Only what it actually has, and only what you switch on here. A job that needs a tool switched off is never offered to this machine."
        }
      >
        {null}
      </Row>

      {machine.tools.map((tool) => (
        <Row
          key={tool.id}
          label={tool.id}
          hint={
            tool.present
              ? tool.version || "installed"
              : tool.error || `not installed — ${tool.install}`
          }
          mono
        >
          <Toggle
            on={tool.present && enabled.includes(tool.id)}
            disabled={!tool.present}
            onToggle={() => toggle(tool.id)}
            label={`Let this machine use ${tool.id}`}
          />
        </Row>
      ))}

      <Row
        label="Let the Claude CLI open frame files"
        hint="Grants Read, on this computer's filesystem, for the one call that looks at a video's stills. Off unless whoever owns the machine says otherwise — a permission granted on one desktop must not follow the console onto another."
      >
        <Toggle
          on={canReadFrames}
          onToggle={() => setCanReadFrames((v) => !v)}
          label="Let the Claude CLI open frame files"
        />
      </Row>

      <Row
        label="Jobs at once"
        hint="One, because one machine is one signed-in CLI: two jobs share that one login and mostly wait for each other. Raising this does not make a run faster — enrolling a second machine does. Raise it only if you know this computer runs two logins."
      >
        <Segmented
          options={CONCURRENCY.map((v) => ({ value: v, label: v }))}
          value={String(maxConcurrency)}
          onChange={(v) => setMaxConcurrency(Number(v))}
        />
      </Row>
    </Modal>
  );
}

/** One labelled control in the settings dialog. */
function Row({
  label,
  hint,
  mono = false,
  children,
}: {
  label: string;
  hint: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "12px 0",
        borderTop: `1px solid ${w(0.05)}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: mono ? 12 : 12.5,
            fontWeight: 600,
            fontFamily: mono ? font.mono : undefined,
          }}
        >
          {label}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 11.5,
            color: t(0.42),
            textWrap: "pretty",
          }}
        >
          {hint}
        </div>
      </div>
      {children ? <div style={{ flex: "none" }}>{children}</div> : null}
    </div>
  );
}
