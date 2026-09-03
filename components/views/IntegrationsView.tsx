"use client";

import { useState, type ReactNode } from "react";

import {
  patchWiring,
  testBrain,
  useWiringState,
  type BrainStatus,
  type BrainTest,
  type ToolStatus,
} from "@/lib/integrations-client";
import { useStore } from "@/lib/store";
import { font, panel, rise, t, w } from "@/lib/theme";
import { Button, Toggle } from "@/components/ui";
import {
  BrainGlyph,
  CheckGlyph,
  CloseGlyph,
  CpuGlyph,
  WrenchGlyph,
} from "@/components/ui/DocIcons";

/**
 * What Content OS can reach, checked rather than claimed.
 *
 * Every row here is the result of running the thing: `claude --version`,
 * `yt-dlp --version`, a request to localhost:11434. A tool that is not
 * installed says so and shows the one command that installs it, because the
 * previous version of this page displayed a version number for software that
 * might never have been on the machine.
 */

const GOOD = "#4bb07a";
const WARN = "#e0a83c";
const BAD = "#d1656b";

/** What each local tool is actually for, in this app's own terms. */
const TOOL_ROLE: Record<string, string> = {
  "yt-dlp": "Pulls a source reel down so a template can be told what it shows",
  ffmpeg: "Cuts stills out of that video for the identify step to read",
  ffprobe: "Reads the video's length, so the stills are evenly spaced",
  whisper: "Turns the spoken audio into a transcript research can quote",
  claude: "The headless Claude command, when Claude is the brain",
};

export function IntegrationsView() {
  const { go } = useStore();
  const { wiring, setWiring, loading, checking, error, reload } = useWiringState();
  const [saving, setSaving] = useState("");
  const [refused, setRefused] = useState("");
  /*
   * Test results, per model, kept until the page is left.
   *
   * A version number proves a command exists and nothing more: codex can be
   * installed AND logged in and still fail because the CLI is a release
   * behind. Only sending a prompt settles it, so the page offers to.
   */
  const [tests, setTests] = useState<Record<string, BrainTest | "running">>({});

  async function test(id: string) {
    setTests((prev) => ({ ...prev, [id]: "running" }));
    try {
      const result = await testBrain(id);
      setTests((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setTests((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          ms: 0,
          reply: "",
          error: e instanceof Error ? e.message : "The test could not run",
          fix: "",
        },
      }));
    }
  }

  const brains = wiring?.brains ?? [];
  const tools = wiring?.tools ?? [];
  const settings = wiring?.settings;

  /** Missing pieces, counted for the banner at the top. */
  const missingTools = tools.filter((x) => !x.present);
  const readyBrains = brains.filter((b) => b.available);
  const brain = brains.find((b) => b.id === settings?.brain);

  async function chooseBrain(id: string) {
    if (!wiring) return;
    setSaving(id);
    setRefused("");
    try {
      const next = await patchWiring({ brain: id });
      setWiring({ ...wiring, settings: next });
    } catch (e) {
      setRefused(e instanceof Error ? e.message : "That model could not be set");
    } finally {
      setSaving("");
    }
  }

  async function toggleTool(id: string) {
    if (!wiring || !settings) return;
    const enabled = settings.enabled.includes(id)
      ? settings.enabled.filter((x) => x !== id)
      : [...settings.enabled, id];
    setWiring({ ...wiring, settings: { ...settings, enabled } });
    await patchWiring({ enabled }).catch(() => {});
  }

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1040,
        margin: "0 auto",
        padding: "34px 30px 60px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontFamily: font.tight,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              margin: "0 0 5px",
            }}
          >
            Integrations
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: t(0.5) }}>
            {loading
              ? "Checking this machine…"
              : `${readyBrains.length} of ${brains.length} models usable · ${
                  tools.filter((x) => x.present).length
                } of ${tools.length} tools installed`}
          </p>
        </div>
        <Button
          onClick={() => void reload(true)}
          disabled={checking}
          icon={<CpuGlyph size={13} stroke="currentColor" />}
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>

      {error ? <Banner tone={BAD}>{error}</Banner> : null}
      {refused ? <Banner tone={WARN}>{refused}</Banner> : null}

      {/*
        The one line that matters most: which model is going to write the next
        section, and whether it can. Everything below is how to change that.
      */}
      {!loading ? (
        <div
          style={{
            ...panel(18),
            marginTop: 18,
            padding: "15px 17px",
            display: "flex",
            alignItems: "center",
            gap: 13,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              flex: "none",
              background: brain?.available
                ? "rgba(75,176,122,0.16)"
                : "rgba(209,101,107,0.14)",
            }}
          >
            <BrainGlyph size={16} stroke={brain?.available ? GOOD : BAD} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
              {brain
                ? `${brain.name} is the brain`
                : "No model is set as the brain"}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: t(0.5) }}>
              {brain?.available
                ? `${brain.using} · over the ${
                    brain.transport === "cli"
                      ? `${brain.command} CLI${brain.cliVersion ? ` ${brain.cliVersion}` : ""}`
                      : `API key from ${brain.apiFrom === "env" ? "the environment" : "Settings"}`
                  }`
                : (brain?.reason ??
                  "Pick one below — every section is written by it.")}
            </div>
          </div>
        </div>
      ) : null}

      {/*
        Missing tools, said once and loudly, with the command to fix each.
        Buried in a list this reads as decoration; at the top it is a to-do.
      */}
      {missingTools.length ? (
        <div
          style={{
            ...panel(18),
            marginTop: 12,
            padding: "15px 17px",
            borderColor: "rgba(224,168,60,0.28)",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}
          >
            <WrenchGlyph size={14} stroke={WARN} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {missingTools.length === 1
                ? "One tool is not installed"
                : `${missingTools.length} tools are not installed`}
            </span>
          </div>
          <div style={{ fontSize: 12, color: t(0.5), marginBottom: 11 }}>
            Run these, then press Check again. Nothing here is required — each
            one missing just costs you what it does.
          </div>
          {missingTools.map((x) => (
            <div
              key={x.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "7px 0",
                borderTop: `1px solid ${w(0.055)}`,
              }}
            >
              <span style={{ flex: "0 0 86px", fontSize: 12.5, fontWeight: 600 }}>
                {x.id}
              </span>
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: font.mono,
                  fontSize: 11.5,
                  color: t(0.72),
                  background: "rgba(0,0,0,0.34)",
                  border: `1px solid ${w(0.08)}`,
                  borderRadius: 8,
                  padding: "5px 9px",
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {x.install}
              </code>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Models ─────────────────────────────────────────────────────── */}
      <Group
        icon={<CpuGlyph size={13} stroke={t(0.5)} />}
        title="Models"
        blurb="One of these writes every section. A model is usable when its command is installed or a key is stored."
        count={`${readyBrains.length}/${brains.length}`}
      >
        {brains.map((b) => (
          <BrainRow
            key={b.id}
            item={b}
            chosen={settings?.brain === b.id}
            saving={saving === b.id}
            test={tests[b.id]}
            onTest={() => void test(b.id)}
            onChoose={() => void chooseBrain(b.id)}
            onKeys={() => go("/settings")}
          />
        ))}
        {loading ? <Empty>Checking which models answer…</Empty> : null}
      </Group>

      {/* ── Local tools ────────────────────────────────────────────────── */}
      <Group
        icon={<WrenchGlyph size={13} stroke={t(0.5)} />}
        title="Local tools"
        blurb="Binaries on this machine. A source video goes through these before a template ever sees it."
        count={`${tools.filter((x) => x.present).length}/${tools.length}`}
      >
        {tools.map((x) => (
          <ToolRow
            key={x.id}
            item={x}
            on={Boolean(settings?.enabled.includes(x.id))}
            onToggle={() => void toggleTool(x.id)}
          />
        ))}
        {loading ? <Empty>Looking for them…</Empty> : null}
      </Group>

      <p style={{ marginTop: 20, fontSize: 11.5, color: t(0.35), textWrap: "pretty" }}>
        Everything on this page was checked by running it, not by a setting
        someone left on. Versions are what the tool reported when asked.
      </p>
    </div>
  );
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

function BrainRow({
  item,
  chosen,
  saving,
  test,
  onTest,
  onChoose,
  onKeys,
}: {
  item: BrainStatus;
  chosen: boolean;
  saving: boolean;
  test?: BrainTest | "running";
  onTest: () => void;
  onChoose: () => void;
  onKeys: () => void;
}) {
  const running = test === "running";
  const result = running ? null : test;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        borderTop: `1px solid ${w(0.05)}`,
        opacity: item.available ? 1 : 0.72,
      }}
    >
      <Dot ok={item.available} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.name}</span>
          <span style={{ fontSize: 11.5, color: t(0.35) }}>{item.vendor}</span>
          {chosen ? <Tag tone={GOOD}>BRAIN</Tag> : null}
        </div>
        <div style={{ marginTop: 2, fontSize: 11.5, color: t(0.45) }}>
          {item.role}
        </div>
        {/*
          How it is reached, spelled out. "Connected" told you nothing about
          whether it would work; "claude CLI 2.1.241" tells you exactly what
          is going to run and lets you check it yourself.
        */}
        <div
          style={{
            marginTop: 5,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            fontFamily: font.mono,
            fontSize: 10,
          }}
        >
          {item.cli ? (
            <Tag tone={GOOD}>
              {item.command} {item.cliVersion}
            </Tag>
          ) : item.command ? (
            <Tag tone={t(0.3)}>no {item.command} cli</Tag>
          ) : null}
          {item.api ? (
            <Tag tone={GOOD}>
              key · {item.apiFrom === "env" ? "env" : "settings"}
            </Tag>
          ) : (
            <Tag tone={t(0.3)}>no key</Tag>
          )}
          <Tag tone={t(0.3)}>{item.using}</Tag>
        </div>
        {!item.available ? (
          <div style={{ marginTop: 6, fontSize: 11.5, color: WARN }}>
            {item.reason}
          </div>
        ) : null}

        {/*
          What happened when it was actually asked something. The tool's own
          error, verbatim — "Please set an Auth method in settings.json" IS the
          fix, and paraphrasing it into "could not reach Gemini" throws away
          the only useful part.
        */}
        {running ? (
          <div style={{ marginTop: 6, fontSize: 11.5, color: t(0.45) }}>
            Sending it a one-line prompt…
          </div>
        ) : result ? (
          <div
            style={{
              marginTop: 7,
              padding: "7px 9px",
              borderRadius: 9,
              fontSize: 11.5,
              background: result.ok ? "rgba(75,176,122,0.1)" : "rgba(224,168,60,0.1)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: result.ok ? "rgba(75,176,122,0.28)" : "rgba(224,168,60,0.3)",
              color: result.ok ? GOOD : WARN,
              textWrap: "pretty",
            }}
          >
            {result.ok ? (
              `Answered in ${(result.ms / 1000).toFixed(1)}s — "${result.reply.trim().slice(0, 60)}"`
            ) : (
              <>
                <div>{result.error}</div>
                {result.fix ? (
                  <div style={{ marginTop: 5, color: t(0.7), fontWeight: 600 }}>
                    {result.fix}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 7 }}>
        {item.available ? (
          <Button onClick={onTest} disabled={running}>
            {running ? "Testing…" : "Test"}
          </Button>
        ) : null}
        {item.available ? (
          chosen ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                fontWeight: 600,
                color: GOOD,
              }}
            >
              <CheckGlyph size={11} stroke={GOOD} />
              In use
            </span>
          ) : (
            <Button variant="accent" onClick={onChoose} disabled={saving}>
              {saving ? "Switching…" : "Use as brain"}
            </Button>
          )
        ) : (
          <Button onClick={onKeys}>Add a key</Button>
        )}
      </div>
    </div>
  );
}

function ToolRow({
  item,
  on,
  onToggle,
}: {
  item: ToolStatus;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        borderTop: `1px solid ${w(0.05)}`,
        opacity: item.present ? 1 : 0.72,
      }}
    >
      <Dot ok={item.present} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.id}</span>
          {item.present ? (
            <span style={{ fontFamily: font.mono, fontSize: 10.5, color: t(0.42) }}>
              {item.version}
            </span>
          ) : null}
        </div>
        <div style={{ marginTop: 2, fontSize: 11.5, color: t(0.45) }}>
          {TOOL_ROLE[item.id] ?? item.command}
        </div>
        {!item.present ? (
          <div style={{ marginTop: 5, fontSize: 11.5, color: WARN }}>
            Not installed — <code style={{ fontFamily: font.mono }}>{item.install}</code>
          </div>
        ) : null}
      </div>

      {item.present ? (
        <Toggle on={on} onToggle={onToggle} label={`Use ${item.id}`} />
      ) : (
        <span
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            color: t(0.35),
          }}
        >
          <CloseGlyph size={10} stroke={t(0.3)} />
          Missing
        </span>
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Group({
  icon,
  title,
  blurb,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  blurb: string;
  count: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 16 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}
      >
        {icon}
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: t(0.45),
          }}
        >
          {title}
        </span>
        <span style={{ flex: 1, height: 1, background: w(0.06) }} />
        <span style={{ fontFamily: font.mono, fontSize: 10.5, color: t(0.35) }}>
          {count}
        </span>
      </div>
      <div style={{ fontSize: 12, color: t(0.42), marginBottom: 10, textWrap: "pretty" }}>
        {blurb}
      </div>
      <div style={{ ...panel(18), padding: 0, overflow: "hidden" }}>{children}</div>
    </section>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flex: "none",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? GOOD : w(0.16),
        boxShadow: ok ? `0 0 8px ${GOOD}66` : "none",
      }}
    />
  );
}

function Tag({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 9.5,
        letterSpacing: "0.08em",
        padding: "2px 6px",
        borderRadius: 5,
        background: w(0.06),
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Banner({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        marginTop: 14,
        padding: "10px 13px",
        borderRadius: 12,
        fontSize: 12.5,
        background: `${tone}1f`,
        border: `1px solid ${tone}55`,
        color: tone,
        textWrap: "pretty",
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "16px", fontSize: 12.5, color: t(0.35) }}>{children}</div>
  );
}
