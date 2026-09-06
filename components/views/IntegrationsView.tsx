"use client";

import { Fragment, useState, type ReactNode } from "react";

import { ago } from "@/lib/packs-client";
import {
  patchMachineTools,
  patchWorkspaceWiring,
  useBrainTests,
  useWiringState,
  type BrainStatus,
  type ChosenMachine,
  type TestView,
  type ToolStatus,
} from "@/lib/integrations-client";
import { useStore } from "@/lib/store";
import { color, font, panel, t, w } from "@/lib/theme";
import {
  Button,
  Chip,
  EmptyState,
  ListCell,
  ListHeader,
  ListPanel,
  ListRow,
  Page,
  PageHeader,
  RowTile,
  Select,
  Toggle,
  Toolbar,
} from "@/components/ui";
import {
  BrainGlyph,
  CpuGlyph,
  KeyGlyph,
  WrenchGlyph,
} from "@/components/ui/DocIcons";
import { RefreshIcon } from "@/components/ui/Icons";

/**
 * What can run where.
 *
 * This page used to ask "what is on this machine", and answered by spawning
 * `claude --version` and `yt-dlp --version` inside the API process. That was
 * the right question exactly as long as the API process and the machine with
 * the binaries on it were the same computer. They are not: work happens on
 * enrolled desktops now, and on a server the old question has one permanent
 * answer — nothing installed — while the four laptops that really do have the
 * tools stay invisible.
 *
 * So it asks "what is on WHICH machine" instead, and the whole page is scoped
 * by two pickers it did not have: the machine at the top, and the workspace
 * the console is already switched to. Those are the two things migration 0016
 * separated — a fact about somebody's hardware and an editorial choice about a
 * brand — and one flat settings object could not tell them apart.
 *
 * Settings → Machines enrols them and owns their permissions; this page
 * answers a different question with the same vocabulary, deliberately, so the
 * two read as one console rather than as two lists of the same computers.
 */

const MODELS = "1.5fr 1.25fr 168px";
const TOOLS = "1.4fr 1fr 118px 62px";

/** What each tool is actually for, in this app's own terms. */
const TOOL_ROLE: Record<string, string> = {
  "yt-dlp": "Pulls a source reel down so a template can be told what it shows",
  ffmpeg: "Cuts stills out of that video for the identify step to read",
  ffprobe: "Reads the video's length, so the stills are evenly spaced",
  whisper: "Turns the spoken audio into a transcript research can quote",
  claude: "The headless Claude command, when Claude is the brain",
};

export function IntegrationsView() {
  const { go, project } = useStore();
  /*
   * Empty means "whichever machine the server thinks is the live one".
   *
   * Not defaulted to the first row here, because the server already answers
   * that better than a browser can: it picks the most recently seen live
   * machine, which is the honest answer to "where can this run right now".
   */
  const [machineId, setMachineId] = useState("");
  const workspaceId = project?.id ?? "";
  const { wiring, setWiring, loading, checking, error, reload } = useWiringState(
    machineId,
    workspaceId,
  );
  const { tests, test } = useBrainTests();
  const [saving, setSaving] = useState("");
  const [refused, setRefused] = useState("");

  const machines = wiring?.machines ?? [];
  const machine = wiring?.machine ?? null;
  const brains = wiring?.brains ?? [];
  const tools = wiring?.tools ?? [];
  const enabled = wiring?.enabled ?? [];
  const ready = brains.filter((b) => b.available);
  const installed = tools.filter((x) => x.present);
  const chosenBrain = brains.find((b) => b.id === wiring?.brain);
  const noMachines = !loading && machines.length === 0;

  async function chooseBrain(id: string) {
    if (!wiring || !workspaceId) return;
    setSaving(id);
    setRefused("");
    try {
      const next = await patchWorkspaceWiring(workspaceId, { brain: id });
      setWiring({ ...wiring, brain: next.brain, apiFallback: next.apiFallback });
    } catch (e) {
      setRefused(
        e instanceof Error ? e.message : "That model could not be set for this workspace",
      );
    } finally {
      setSaving("");
    }
  }

  async function toggleFallback() {
    if (!wiring || !workspaceId) return;
    const apiFallback = !wiring.apiFallback;
    setWiring({ ...wiring, apiFallback });
    setRefused("");
    await patchWorkspaceWiring(workspaceId, { apiFallback }).catch((e: unknown) => {
      setWiring({ ...wiring, apiFallback: !apiFallback });
      setRefused(e instanceof Error ? e.message : "That switch did not save");
    });
  }

  async function toggleTool(id: string) {
    if (!wiring || !machine) return;
    const next = enabled.includes(id)
      ? enabled.filter((x) => x !== id)
      : [...enabled, id];
    setWiring({ ...wiring, enabled: next });
    await patchMachineTools(machine.id, next).catch((e: unknown) => {
      setWiring({ ...wiring, enabled });
      setRefused(e instanceof Error ? e.message : "That switch did not save");
    });
  }

  return (
    <Page width={1040}>
      <PageHeader
        title="Integrations"
        blurb={
          loading
            ? "Reading what the machines have reported…"
            : noMachines
              ? "Nothing can run yet — no machine has been enrolled."
              : `${ready.length} of ${brains.length} models usable on ${
                  machine?.name ?? "this machine"
                } · ${installed.length} of ${tools.length} tools installed there`
        }
        actions={
          <>
            {/*
              The two places the things on this page are actually owned: a
              machine's permissions belong to whoever owns the machine, and the
              keys belong to the server. Offered once here rather than as a
              button in every row that lacks one.
            */}
            <Button
              onClick={() => go("/settings")}
              icon={<KeyGlyph size={13} stroke="currentColor" />}
            >
              API keys
            </Button>
            <Button
              onClick={() => go("/settings")}
              icon={<CpuGlyph size={13} stroke="currentColor" />}
            >
              Machines
            </Button>
          </>
        }
      />

      <Toolbar>
        {machines.length ? (
          <>
            <Select
              label="Which machine"
              size="sm"
              // The pick, not the loaded answer: the rows underneath lag by a
              // request and the picker must not appear to snap back meanwhile.
              value={machineId || (machine?.id ?? "")}
              onChange={setMachineId}
              options={machines.map((m) => ({
                value: m.id,
                label: m.name,
                hint: m.live
                  ? "online"
                  : m.lastSeenAt
                    ? `seen ${ago(m.lastSeenAt)}`
                    : "never seen",
              }))}
              style={{ minWidth: 230 }}
            />
            <MachineChip machine={machine} />
          </>
        ) : null}

        <span style={{ flex: 1 }} />

        {project?.name ? (
          <span style={{ fontSize: 12, color: t(0.42) }}>
            model and fallback for{" "}
            <strong style={{ color: t(0.72), fontWeight: 600 }}>{project.name}</strong>
          </span>
        ) : null}

        <Button
          onClick={() => void reload()}
          disabled={checking}
          icon={<RefreshIcon size={12} stroke="currentColor" />}
        >
          {checking ? "Reading…" : "Check again"}
        </Button>
      </Toolbar>

      {error ? <Banner tone={color.bad}>{error}</Banner> : null}
      {refused ? <Banner tone={color.warn}>{refused}</Banner> : null}

      {/*
        The failure the old page could not express at all.

        "whisper is not installed" and "that laptop has been shut since
        Tuesday" are opposite problems: one is an install command, the other is
        somebody opening their laptop, and no amount of tool rows says the
        second. It is a banner rather than a row because it is true of every
        row underneath it at once.
      */}
      {machine && !machine.live ? (
        <Banner tone={color.warn}>
          {machine.lastSeenAt ? (
            <>
              <strong>{machine.name}</strong> has not been seen since{" "}
              {ago(machine.lastSeenAt)}. Its tools are still listed below because
              they are still installed — it is simply not there to run them, and
              nothing here can wake it. Open that machine, or pick another one
              above.
            </>
          ) : (
            <>
              <strong>{machine.name}</strong> has never checked in. It was
              enrolled, but its token has not been pasted into the desktop app on
              that computer yet, so it has never reported what it has.
            </>
          )}
        </Banner>
      ) : null}

      {/* ── The workspace's model ──────────────────────────────────────── */}
      <section style={{ ...panel(18), marginTop: 16, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "15px 17px",
          }}
        >
          <RowTile
            bg={
              loading
                ? w(0.06)
                : chosenBrain?.available
                  ? "rgba(75,176,122,0.16)"
                  : "rgba(209,101,107,0.14)"
            }
          >
            <BrainGlyph
              size={16}
              stroke={
                loading ? t(0.45) : chosenBrain?.available ? color.good : color.bad
              }
            />
          </RowTile>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
              {/* Not "no model is set" until we know: the first paint has read
                  nothing yet, and an alarm that clears itself is noise. */}
              {loading
                ? `Reading the model for ${project?.name ?? "this workspace"}…`
                : chosenBrain
                  ? `${chosenBrain.name} writes for ${project?.name ?? "this workspace"}`
                  : `No model is set for ${project?.name ?? "this workspace"}`}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: t(0.5), textWrap: "pretty" }}>
              {loading
                ? ""
                : chosenBrain?.available
                ? `${chosenBrain.using} · over the ${
                    chosenBrain.transport === "cli"
                      ? `${chosenBrain.command} CLI${
                          chosenBrain.cliVersion ? ` ${chosenBrain.cliVersion}` : ""
                        } on ${machine?.name ?? "the chosen machine"}`
                      : `API key from ${
                          chosenBrain.apiFrom === "env" ? "the environment" : "Settings"
                        }, spent by the server`
                  }`
                : (chosenBrain?.reason ??
                  "Pick one below. It is a property of this brand, not of the console — another workspace can want another model without either changing under the other.")}
            </div>
          </div>
        </div>

        {/*
          The one switch on this page that spends money, so it says what it
          costs in the same breath as offering itself.
        */}
        <Setting
          icon={<KeyGlyph size={13} stroke={t(0.45)} />}
          label="Let the server use an API key when no machine can take the work"
          hint={
            wiring?.apiFallback
              ? "On. When no enrolled machine is awake and able, the server writes the section itself with this workspace's stored key — real money per section, spent at the moment nobody is watching."
              : "Off. When no enrolled machine is awake and able, a run waits until one is. Nothing is spent, and nothing is written until somebody opens a laptop."
          }
          control={
            workspaceId ? (
              <Toggle
                on={wiring?.apiFallback === true}
                onToggle={() => void toggleFallback()}
                label="Let the server use an API key when no machine is free"
              />
            ) : null
          }
        />
      </section>

      {/* ── Models ─────────────────────────────────────────────────────── */}
      <Section
        icon={<BrainGlyph size={13} stroke={t(0.5)} />}
        title="Models"
        blurb={
          machine
            ? `A model is usable when its command is installed and switched on for ${machine.name}, or when a key is stored on the server. Test asks that machine to actually write two words.`
            : "A model is usable when its command is installed on a machine, or when a key is stored on the server."
        }
        count={`${ready.length}/${brains.length}`}
      >
        <ListPanel>
          <ListHeader
            columns={MODELS}
            labels={["MODEL", "HOW IT IS REACHED", ""]}
          />
          {brains.map((b) => (
            <Fragment key={b.id}>
              <BrainRow
                item={b}
                chosen={wiring?.brain === b.id}
                saving={saving === b.id}
                machine={machine}
                workspaceName={project?.name ?? "this workspace"}
                canSet={Boolean(workspaceId)}
                testing={tests[b.id]?.running === true}
                onTest={() => {
                  if (machine) void test(b.id, machine.id, machine.name);
                }}
                onChoose={() => void chooseBrain(b.id)}
              />
              {tests[b.id] ? <TestNote view={tests[b.id]} /> : null}
            </Fragment>
          ))}
          {loading ? <EmptyState compact title="Reading the models…" /> : null}
        </ListPanel>
      </Section>

      {/* ── Tools on the chosen machine ────────────────────────────────── */}
      <Section
        icon={<WrenchGlyph size={13} stroke={t(0.5)} />}
        title="Tools"
        blurb={
          machine
            ? `Binaries on ${machine.name}, as that machine reported them. A source video goes through these before a template ever sees it.`
            : "Binaries on an enrolled machine. Nothing runs on the server itself."
        }
        count={machine ? `${installed.length}/${tools.length}` : ""}
      >
        <ListPanel>
          {noMachines ? (
            /*
              The state almost everybody is in right now, and the one sentence
              that must not appear here is "nothing is installed". Nothing is
              installed anywhere the server can see, and that is not a fault
              with a tool — there is simply no machine yet.
            */
            <EmptyState
              icon={<CpuGlyph size={16} stroke={t(0.4)} />}
              title="No machines are enrolled"
              line="Runs happen on somebody's desktop — under their login, with their model CLI and their GPU — so until one is enrolled there is nowhere for this to be installed. Nothing runs on the server itself."
              action={
                <Button variant="primary" size="md" onClick={() => go("/settings")}>
                  Enrol one in Settings → Machines
                </Button>
              }
            />
          ) : (
            <>
              <ListHeader
                columns={TOOLS}
                labels={["TOOL", "ON THIS MACHINE", "REPORTED", "USE"]}
              />
              {tools.map((x) => (
                <Fragment key={x.id}>
                  <ToolRow
                    item={x}
                    machine={machine}
                    on={enabled.includes(x.id)}
                    onToggle={() => void toggleTool(x.id)}
                  />
                  {!x.present && machine ? (
                    <InstallNote item={x} machine={machine.name} />
                  ) : null}
                </Fragment>
              ))}
              {loading && !tools.length ? (
                <EmptyState compact title="Reading what it reported…" />
              ) : null}
            </>
          )}
        </ListPanel>
      </Section>

      {machine ? (
        <div style={{ ...panel(18), marginTop: 12, padding: 0, overflow: "hidden" }}>
          <Setting
            icon={<KeyGlyph size={13} stroke={t(0.45)} />}
            label={`The Claude CLI may open frame files on ${machine.name}`}
            hint={
              wiring?.canReadFrames
                ? "Granted. The one call that looks at a video's stills gets Read on that computer's disk."
                : "Not granted, which is the default. Without it Claude is handed the picture rather than the path. It is changed in Settings → Machines, by whoever owns the machine — a permission on somebody's filesystem is not the console's to switch from here."
            }
            control={
              <Chip tone={wiring?.canReadFrames ? "good" : "mute"}>
                {wiring?.canReadFrames ? "Granted" : "Off"}
              </Chip>
            }
          />
        </div>
      ) : null}

      {/*
        What "Check again" now means, said plainly, because the button used to
        do something else entirely and the word did not change.
      */}
      <p style={{ marginTop: 18, fontSize: 11.5, color: t(0.35), textWrap: "pretty" }}>
        Nothing on this page is probed here. Each machine looks at its own disk
        and reports what it found when its desktop app starts and every time it
        checks in — so Check again re-reads that report, and making a machine
        look afresh means restarting the worker on it. Test is the exception: it
        asks the machine to write, right now.
      </p>
    </Page>
  );
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

function BrainRow({
  item,
  chosen,
  saving,
  machine,
  workspaceName,
  canSet,
  testing,
  onTest,
  onChoose,
}: {
  item: BrainStatus;
  chosen: boolean;
  saving: boolean;
  machine: ChosenMachine | null;
  workspaceName: string;
  canSet: boolean;
  testing: boolean;
  onTest: () => void;
  onChoose: () => void;
}) {
  return (
    <ListRow columns={MODELS} dim={!item.available}>
      <ListCell
        icon={
          <RowTile bg={item.available ? "rgba(75,176,122,0.16)" : w(0.06)}>
            <BrainGlyph size={14} stroke={item.available ? color.good : t(0.45)} />
          </RowTile>
        }
        title={item.name}
        after={
          <>
            <span style={{ fontSize: 11.5, fontWeight: 400, color: t(0.35) }}>
              {item.vendor}
            </span>
            {chosen ? <Chip tone="good">IN USE</Chip> : null}
          </>
        }
        subtitle={item.role}
      />

      <div style={{ minWidth: 0 }}>
        {/*
          Spelled out rather than summarised as "connected". Half of this row
          can be true of two different computers — the CLI is on the machine,
          the key is on the server — and "connected" hid exactly that.
        */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {item.command ? (
            <Chip mono tone={item.cli ? "good" : "mute"}>
              {item.cli
                ? `${item.command} ${item.cliVersion}`.trim()
                : `no ${item.command}`}
            </Chip>
          ) : null}
          <Chip mono tone={item.api ? "good" : "mute"}>
            {item.api ? `key · ${item.apiFrom}` : "no key"}
          </Chip>
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: item.available ? t(0.4) : color.warn, textWrap: "pretty" }}>
          {item.available ? item.using : item.reason}
        </div>
      </div>

      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {machine ? (
          <Button
            onClick={onTest}
            disabled={testing}
            title={`Ask ${machine.name} to write two words with ${item.name}`}
          >
            {testing ? "Asking…" : "Test"}
          </Button>
        ) : null}
        {/*
          Offered even when this machine cannot run it, which is not an
          oversight. A workspace's model is an editorial decision that outlives
          whichever laptops happen to be awake when it is made, and the server
          accepts it for exactly that reason — a run that cannot be routed says
          so at enqueue, by name, which is a better place to find out than a
          picker that would not let you choose.
        */}
        {chosen ? null : (
          <Button
            variant="accent"
            onClick={onChoose}
            disabled={saving || !canSet}
            title={
              item.available
                ? `Write ${workspaceName} with ${item.name}`
                : `Write ${workspaceName} with ${item.name} — no machine can run it yet, so runs will wait`
            }
          >
            {saving ? "Saving…" : "Use here"}
          </Button>
        )}
      </span>
    </ListRow>
  );
}

/**
 * A test, and where it happened.
 *
 * The panel names the machine on purpose: a model that works on one
 * teammate's laptop and not on another's is a thing this page can finally
 * express, and the sentence is meaningless without the address on it.
 */
function TestNote({ view }: { view: TestView }) {
  if (view.running) {
    return (
      <Note tone={color.mute}>
        {view.machine ? `Waiting for ${view.machine} to answer…` : "Queueing the test…"}
        {view.note ? (
          <div style={{ marginTop: 4, color: color.warn }}>{view.note}</div>
        ) : null}
      </Note>
    );
  }
  if (view.ok) {
    return (
      <Note tone={color.good}>
        {view.machine} answered in {(view.ms / 1000).toFixed(1)}s
        {view.transport ? ` over the ${view.transport}` : ""} — &ldquo;
        {view.reply.trim().slice(0, 60)}&rdquo;
      </Note>
    );
  }
  return (
    <Note tone={color.warn}>
      {/*
        The tool's own error, verbatim: "Please set an Auth method in
        settings.json" IS the fix, and paraphrasing it into "could not reach
        Gemini" throws away the only useful part.
      */}
      <div>{view.error || "It did not answer."}</div>
      {view.fix ? (
        <div style={{ marginTop: 5, color: t(0.72), fontWeight: 600 }}>{view.fix}</div>
      ) : null}
    </Note>
  );
}

function ToolRow({
  item,
  machine,
  on,
  onToggle,
}: {
  item: ToolStatus;
  machine: ChosenMachine | null;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <ListRow columns={TOOLS} dim={!item.present}>
      <ListCell
        icon={
          <RowTile bg={item.present ? "rgba(75,176,122,0.16)" : w(0.06)}>
            <WrenchGlyph size={13} stroke={item.present ? color.good : t(0.45)} />
          </RowTile>
        }
        title={<span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{item.id}</span>}
        after={
          item.present ? (
            <Chip mono tone="mute">
              {item.version || "installed"}
            </Chip>
          ) : (
            <Chip tone="warn">Not installed</Chip>
          )
        }
        subtitle={TOOL_ROLE[item.id] ?? item.command}
      />

      <span style={{ fontSize: 11.5, color: t(0.45), textWrap: "pretty" }}>
        {item.present
          ? on
            ? `Switched on for ${machine?.name ?? "this machine"}`
            : "Installed, but switched off — no job that needs it is offered here"
          : item.error}
      </span>

      {/*
        A last-seen line rather than a live spinner. Nothing here is being
        watched happen; this is when the machine last said so.
      */}
      <span style={{ fontSize: 11.5, color: t(0.4) }}>
        {machine?.lastSeenAt ? ago(machine.lastSeenAt) : "never"}
      </span>

      <Toggle
        on={item.present && on}
        disabled={!item.present}
        onToggle={onToggle}
        label={`Let ${machine?.name ?? "this machine"} use ${item.id}`}
        size="sm"
      />
    </ListRow>
  );
}

/** The other failure: it is missing THERE, so the command is run THERE. */
function InstallNote({ item, machine }: { item: ToolStatus; machine: string }) {
  return (
    <Note tone={color.warn}>
      <div style={{ marginBottom: 6 }}>
        Not installed on <strong>{machine}</strong>. Run this in a terminal on
        that computer, then restart its worker so it reports again.
      </div>
      <code
        style={{
          display: "block",
          fontFamily: font.mono,
          fontSize: 11.5,
          color: t(0.72),
          background: "rgba(0,0,0,0.34)",
          border: `1px solid ${w(0.08)}`,
          borderRadius: 8,
          padding: "6px 9px",
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {item.install}
      </code>
    </Note>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/** A strip under the row it belongs to: a test result, an install command. */
function Note({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 18px 12px 64px",
        borderTop: `1px solid ${w(0.04)}`,
        background: w(0.02),
        fontSize: 11.5,
        color: tone,
        textWrap: "pretty",
      }}
    >
      {children}
    </div>
  );
}

/** One labelled switch with the sentence that says what it costs. */
function Setting({
  icon,
  label,
  hint,
  control,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  control: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 17px",
        borderTop: `1px solid ${w(0.05)}`,
      }}
    >
      <span style={{ flex: "none", display: "grid", placeItems: "center" }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div>
        <div style={{ marginTop: 2, fontSize: 11.5, color: t(0.42), textWrap: "pretty" }}>
          {hint}
        </div>
      </div>
      {control ? <div style={{ flex: "none" }}>{control}</div> : null}
    </div>
  );
}

/** Online, shut, or never here — three states the page must not collapse. */
function MachineChip({ machine }: { machine: ChosenMachine | null }) {
  if (!machine) return null;
  if (machine.live)
    return (
      <Chip tone="good" pulse>
        Online
      </Chip>
    );
  if (!machine.lastSeenAt)
    return (
      <Chip tone="warn" title="Enrolled, but its token has not been pasted in yet">
        Never seen
      </Chip>
    );
  return (
    <Chip tone="mute" title="Installed and known, just not switched on now">
      Seen {ago(machine.lastSeenAt)}
    </Chip>
  );
}

function Section({
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
    <section style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
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
      {children}
    </section>
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
