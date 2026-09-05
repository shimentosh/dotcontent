"use client";

import { apiFetch } from "@/lib/api-base";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { QUALITIES } from "@/lib/data";
import { KEY_GROUP_ORDER, providersIn } from "@/lib/keys";
import {
  loadKeys,
  loadWiring,
  removeKey,
  saveKey,
  type BrainStatus,
  type Settings,
} from "@/lib/integrations-client";
import { useStore } from "@/lib/store";
import { font, panel, primary, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Button, Toggle } from "@/components/ui";
import {
  BrainGlyph,
  CheckGlyph,
  CloseGlyph,
  CpuGlyph,
  UsedGlyph,
  GlobeGlyph,
  KeyGlyph,
  PlugGlyph,
  SpeechGlyph,
  StackGlyph,
} from "@/components/ui/DocIcons";
import { TeamPanel } from "@/components/settings/TeamPanel";
import { MachinesPanel } from "@/components/settings/MachinesPanel";

/**
 * Preferences, keys and the account.
 *
 * Every control here writes to the database. The page used to end with
 * "nothing here is saved yet — these settings reset on reload", which was
 * true: quality, pace and the toggles were React state, and the API keys were
 * a Map in the browser the server could never read, so the one thing that
 * could spend them never saw one.
 */

type SectionKey =
  | "general"
  | "keys"
  | "team"
  | "machines"
  | "language"
  | "appearance"
  | "account";

const SECTIONS: { key: SectionKey; label: string; icon: typeof CpuGlyph }[] = [
  { key: "general", label: "Generation", icon: CpuGlyph },
  { key: "keys", label: "API keys", icon: KeyGlyph },
  { key: "team", label: "Team", icon: UsedGlyph },
  // Not CpuGlyph: Generation already wears it, and two identical glyphs in a
  // seven-row nav make the reader check the words to tell them apart.
  { key: "machines", label: "Machines", icon: PlugGlyph },
  { key: "language", label: "Language", icon: SpeechGlyph },
  { key: "appearance", label: "Appearance", icon: GlobeGlyph },
  { key: "account", label: "Account", icon: StackGlyph },
];

/** Keys a model needs, kept beside the service keys they are not. */
const MODEL_KEYS = [
  { id: "anthropic", name: "Anthropic", use: "Claude, when the CLI is not installed", hint: "sk-ant-…" },
  { id: "openai", name: "OpenAI", use: "ChatGPT, when the codex CLI is not installed", hint: "sk-…" },
  { id: "gemini", name: "Google AI", use: "Gemini, when the gemini CLI is not installed", hint: "AIza…" },
];

export function SettingsView() {
  /*
   * Preferences come from the store, not from this screen's own copy.
   *
   * The shell reads reduceMotion and the run driver reads autoApprove; a
   * second copy here would let the toggle you just moved disagree with the
   * behaviour it controls until the next reload.
   */
  const { askConfirm, go, settings, saveSettings } = useStore();
  const router = useRouter();

  const [section, setSection] = useState<SectionKey>("general");
  const [brains, setBrains] = useState<BrainStatus[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadWiring(), loadKeys()])
      .then(([wiring, stored]) => {
        if (cancelled) return;
        setBrains(wiring.brains);
        setKeys(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Write one preference through, and say so briefly. */
  function put(patch: Partial<Settings>) {
    saveSettings(patch);
    setSaved(Object.keys(patch)[0] ?? "");
    window.setTimeout(() => setSaved(""), 1400);
  }

  const brain = brains.find((b) => b.id === settings?.brain);

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1040,
        margin: "0 auto",
        padding: "34px 30px 60px",
      }}
    >
      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          margin: "0 0 5px",
        }}
      >
        Settings
      </h1>
      <p style={{ margin: "0 0 22px", fontSize: 13.5, color: t(0.5) }}>
        How runs behave, what they can spend, and who gets in.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const on = section === s.key;
            return (
              <Hov
                key={s.key}
                onClick={() => setSection(s.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 11px",
                  borderRadius: 11,
                  fontSize: 13,
                  fontWeight: on ? 600 : 500,
                  cursor: "pointer",
                  color: on ? "#f0f0f4" : t(0.55),
                  background: on ? w(0.075) : "transparent",
                }}
                hover={{ background: w(0.05), color: "#f0f0f4" }}
              >
                <Icon size={14} stroke={on ? "#6a9dff" : t(0.45)} />
                <span style={{ flex: 1 }}>{s.label}</span>
                {s.key === "keys" && Object.keys(keys).length ? (
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 10,
                      color: t(0.45),
                    }}
                  >
                    {Object.keys(keys).length}
                  </span>
                ) : null}
              </Hov>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!settings ? (
            <Card title="Loading">
              <div style={{ padding: 16, fontSize: 12.5, color: t(0.4) }}>
                Reading your settings…
              </div>
            </Card>
          ) : null}

          {settings && section === "general" ? (
            <>
              {/*
                Which model writes lives on Integrations, but it is the first
                thing anyone looks for here, so it is shown and linked rather
                than duplicated.
              */}
              <Hov
                onClick={() => go("/integrations")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "13px 15px",
                  borderRadius: 14,
                  cursor: "pointer",
                  background: "rgba(0,87,252,0.08)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "rgba(0,87,252,0.22)",
                }}
                hover={{ background: "rgba(0,87,252,0.16)" }}
              >
                <BrainGlyph size={16} stroke="#6a9dff" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {brain
                      ? `${brain.name} writes every section`
                      : "No model is set as the brain"}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 11.5, color: t(0.5) }}>
                    {brain?.available
                      ? `${brain.model} — change it on Integrations`
                      : "Nothing can run until one is picked on Integrations"}
                  </div>
                </div>
              </Hov>

              <Card title="Generation">
                <Setting
                  label="Default quality"
                  hint="What a new run starts on. Deep thinks harder per section."
                  saved={saved === "quality"}
                >
                  <Segments
                    options={QUALITIES}
                    value={settings.quality}
                    onPick={(quality) => put({ quality })}
                  />
                </Setting>
                <Setting
                  label="Approve finished sections automatically"
                  hint="Off means every section waits for you, which is why Needs review exists."
                  saved={saved === "autoApprove"}
                >
                  <Toggle
                    on={settings.autoApprove}
                    onToggle={() => put({ autoApprove: !settings.autoApprove })}
                    label="Approve finished sections automatically"
                  />
                </Setting>
                {/*
                  This used to be a console-wide toggle, and it granted the
                  Read tool on whatever filesystem happened to be running the
                  model. Now that the model runs on somebody's desktop, a
                  global here would let a teammate turn on file access on
                  another person's computer — which is not a setting, it is a
                  hole. It is per machine, in Machines, owned by whoever owns
                  the disk.
                */}
                <Setting
                  label="Let the Claude CLI open frame files"
                  hint="Set per machine now, because it grants Read on one particular person's computer — the one that will actually run the model."
                >
                  <Button onClick={() => setSection("machines")}>
                    Set it on Machines
                  </Button>
                </Setting>
              </Card>
            </>
          ) : null}

          {section === "team" ? <TeamPanel /> : null}

          {/*
            Where runs actually happen. It is a settings section rather than a
            page of its own because it is the same act as Team next door —
            mint a credential, show it once, list who holds one, revoke — and
            splitting the two would put "who is in" and "what may run" on
            different screens.
          */}
          {section === "machines" ? <MachinesPanel /> : null}

          {settings && section === "keys" ? (
            <>
              <Card title="Model keys">
                <div
                  style={{
                    padding: "0 16px 11px",
                    fontSize: 11.5,
                    color: t(0.45),
                    textWrap: "pretty",
                  }}
                >
                  Only needed when a model&rsquo;s own CLI is not installed. With
                  the CLI present, it is used first and no key is spent.
                </div>
                {MODEL_KEYS.map((p) => (
                  <KeyRow
                    key={p.id}
                    provider={p}
                    masked={keys[p.id] ?? ""}
                    onSave={async (v) => setKeys(await saveKey(p.id, v))}
                    onClear={async () => setKeys(await removeKey(p.id))}
                  />
                ))}
              </Card>

              {KEY_GROUP_ORDER.map((group) => (
                <Card key={group} title={group}>
                  {providersIn(group).map((p) => (
                    <KeyRow
                      key={p.id}
                      provider={p}
                      masked={keys[p.id] ?? ""}
                      onSave={async (v) => setKeys(await saveKey(p.id, v))}
                      onClear={async () => setKeys(await removeKey(p.id))}
                    />
                  ))}
                </Card>
              ))}

              <div style={{ fontSize: 11.5, color: t(0.35), textWrap: "pretty" }}>
                Keys are encrypted with AES-256-GCM before they are stored, and
                only ever come back masked. Set CONTENTOS_SECRET in{" "}
                <code style={{ fontFamily: font.mono }}>.env</code> to control the
                encryption key yourself.
              </div>
            </>
          ) : null}

          {settings && section === "language" ? (
            <Card title="Language">
              {/*
                Languages belong to the brand, not to the console. This screen
                used to keep its own global list, which could only ever be
                right for one workspace — and was not read by anything.
              */}
              <Setting
                label="Script languages"
                hint="Set per workspace, because two brands here publish in different ones."
              >
                <Button onClick={() => go("/workspaces")}>
                  Edit on Workspaces
                </Button>
              </Setting>
              <Setting
                label="Keep tool names in English"
                hint="Product and tool names are never translated. It is in every template's rules."
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#4bb07a",
                  }}
                >
                  <CheckGlyph size={11} stroke="#4bb07a" />
                  Always
                </span>
              </Setting>
            </Card>
          ) : null}

          {settings && section === "appearance" ? (
            <Card title="Appearance">
              <Setting
                label="Reduce motion"
                hint="Stops the aurora drifting and shortens transitions."
                saved={saved === "reduceMotion"}
              >
                <Toggle
                  on={settings.reduceMotion}
                  onToggle={() => put({ reduceMotion: !settings.reduceMotion })}
                  label="Reduce motion"
                />
              </Setting>
            </Card>
          ) : null}

          {settings && section === "account" ? (
            <Account askConfirm={askConfirm} onSignedOut={() => router.replace("/login")} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Account ────────────────────────────────────────────────────────────── */

type Session = {
  id: string;
  agent: string;
  createdAt: string;
  current: boolean;
};

function Account({
  askConfirm,
  onSignedOut,
}: {
  askConfirm: (o: {
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
  }) => void;
  onSignedOut: () => void;
}) {
  const [me, setMe] = useState<{ email: string; name: string; owner: boolean } | null>(
    null,
  );
  const [sessions, setSessions] = useState<Session[]>([]);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = () => {
    void apiFetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { user?: typeof me }) => setMe(b.user ?? null))
      .catch(() => {});
    void apiFetch("/api/auth/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setSessions)
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { user?: typeof me }) => {
        if (!cancelled) setMe(b.user ?? null);
      })
      .catch(() => {});
    void apiFetch("/api/auth/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Session[]) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function changePassword() {
    setError("");
    setMessage("");
    const res = await apiFetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error || "That did not work");
      return;
    }
    setCurrent("");
    setNext("");
    setMessage("Password changed. Every other session was signed out.");
    refresh();
  }

  return (
    <>
      <Card title="Account">
        <Setting label="Signed in as" hint={me?.owner ? "The owner of this console." : ""}>
          <span style={{ fontSize: 12.5, color: t(0.75) }}>
            {me?.email ?? "…"}
          </span>
        </Setting>
        <Setting
          label="Sign out"
          hint="Ends this session on this browser. Your data stays where it is."
        >
          <Button
            onClick={() => {
              void apiFetch("/api/auth/logout", { method: "POST" }).then(onSignedOut);
            }}
          >
            Sign out
          </Button>
        </Setting>
      </Card>

      <Card title="Change password">
        <div style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            aria-label="Current password"
            style={inputStyle}
          />
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password — at least 10 characters"
            autoComplete="new-password"
            aria-label="New password"
            style={inputStyle}
          />
          {error ? <Note tone="#e08585">{error}</Note> : null}
          {message ? <Note tone="#4bb07a">{message}</Note> : null}
          <div>
            <Button
              variant="primary"
              onClick={() => void changePassword()}
              disabled={!current || !next}
            >
              Change password
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Where you are signed in">
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              borderTop: `1px solid ${w(0.05)}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {browserOf(s.agent)}
                {s.current ? (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#4bb07a" }}>
                    this one
                  </span>
                ) : null}
              </div>
              <div style={{ marginTop: 2, fontSize: 11, color: t(0.4) }}>
                since {new Date(s.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        {sessions.length > 1 ? (
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${w(0.05)}` }}>
            <Button
              variant="danger"
              onClick={() =>
                askConfirm({
                  title: "Sign out everywhere else?",
                  body: "Every other browser signed in to this console is signed out. This one stays.",
                  confirmLabel: "Sign out the others",
                  onConfirm: () => {
                    void apiFetch("/api/auth/sessions", { method: "DELETE" }).then(
                      refresh,
                    );
                  },
                })
              }
            >
              Sign out everywhere else
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

/** "Chrome on Windows" out of a user-agent string, or something honest. */
function browserOf(agent: string) {
  if (!agent) return "Unknown browser";
  const name =
    /Edg\//.test(agent) ? "Edge"
    : /Chrome\//.test(agent) ? "Chrome"
    : /Safari\//.test(agent) ? "Safari"
    : /Firefox\//.test(agent) ? "Firefox"
    : "Browser";
  const os =
    /Windows/.test(agent) ? "Windows"
    : /Mac OS/.test(agent) ? "macOS"
    : /Android/.test(agent) ? "Android"
    : /iPhone|iPad/.test(agent) ? "iOS"
    : /Linux/.test(agent) ? "Linux"
    : "";
  return os ? `${name} on ${os}` : name;
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Setting({
  label,
  hint,
  saved,
  children,
}: {
  label: string;
  hint: string;
  saved?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "14px 16px",
        borderTop: `1px solid ${w(0.05)}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
          {/* A moment of "Saved", then gone. A permanent tick would say the
              same thing whether or not anything had just happened. */}
          {saved ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "#4bb07a",
              }}
            >
              <CheckGlyph size={10} stroke="#4bb07a" />
              Saved
            </span>
          ) : null}
        </div>
        {hint ? (
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
        ) : null}
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ ...panel(18), padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "13px 16px",
          fontFamily: font.mono,
          fontSize: 9.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: t(0.45),
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Note({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, color: tone, textWrap: "pretty" }}>{children}</div>
  );
}

function Segments({
  options,
  value,
  onPick,
}: {
  options: readonly string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 3,
        padding: 3,
        borderRadius: 10,
        background: "rgba(0,0,0,0.3)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: w(0.07),
      }}
    >
      {options.map((o) => (
        <Hov
          key={o}
          onClick={() => onPick(o)}
          aria-pressed={value === o}
          style={{
            padding: "5px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            color: value === o ? "#f0f0f4" : t(0.5),
            background: value === o ? w(0.12) : "transparent",
          }}
          hover={{ color: "#f0f0f4" }}
        >
          {o}
        </Hov>
      ))}
    </div>
  );
}

/** One provider's key: masked once saved, editable until then. */
function KeyRow({
  provider,
  masked,
  onSave,
  onClear,
}: {
  provider: { id: string; name: string; use: string; hint: string };
  masked: string;
  onSave: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(draft);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        borderTop: `1px solid ${w(0.05)}`,
      }}
    >
      <div style={{ flex: "0 0 150px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{provider.name}</span>
          {masked ? <CheckGlyph size={11} stroke="#4bb07a" /> : null}
        </div>
        <div style={{ marginTop: 2, fontSize: 11, color: t(0.4) }}>
          {provider.use}
        </div>
      </div>

      {masked ? (
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: font.mono,
              fontSize: 12,
              color: t(0.6),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {masked}
          </span>
          <Button
            icon={<CloseGlyph size={10} stroke="currentColor" />}
            onClick={() => void onClear()}
            label={`Remove the ${provider.name} key`}
          >
            Remove
          </Button>
        </>
      ) : (
        <>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder={provider.hint}
            aria-label={`${provider.name} API key`}
            style={{ ...inputStyle, flex: 1, height: 30, fontFamily: font.mono, fontSize: 12 }}
          />
          <Hov
            as="span"
            onClick={() => void save()}
            style={{
              flex: "none",
              display: "grid",
              placeItems: "center",
              height: 30,
              padding: "0 13px",
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 600,
              opacity: draft.trim() && !busy ? 1 : 0.45,
              ...primary,
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Hov>
        </>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  minWidth: 0,
  height: 34,
  padding: "0 11px",
  borderRadius: 9,
  background: "rgba(0,0,0,0.3)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.09)",
  outline: "none",
  color: "#f0f0f4",
  fontSize: 13,
} as const;
