"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { langLabel, PROJECT_STATUS, type Project } from "@/lib/data";
import { PACK_STATUS } from "@/lib/packs";
import { ago } from "@/lib/packs-client";
import { useStore } from "@/lib/store";
import { color, font, panel, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { WorkspaceMark } from "@/components/ui/WorkspaceMark";
import {
  AlertIcon,
  ChevronRight,
  ContentIcon,
  GlobeIcon,
  PackTinyIcon,
  PencilIcon,
  TargetIcon,
  TopicSparkIcon,
  VoiceIcon,
} from "@/components/ui/Icons";

/** "TUESDAY · 26 AUGUST", the way the design writes it. */
function formatToday(d: Date) {
  const day = d.toLocaleDateString("en-GB", { weekday: "long" }).toUpperCase();
  const rest = d
    .toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    .toUpperCase();
  return `${day} · ${rest}`;
}

const noSubscribe = () => () => {};

/**
 * The design writes small counts as words — "Three templates are mid-run". Now that
 * the line is computed rather than typed, it has to keep doing that: "3 packs
 * are mid-run" in the middle of a sentence is the tell that a number got loose.
 */
const WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];
const word = (n: number) => WORDS[n] ?? String(n);

/** "2 templates running" becomes 2. Anything without a leading count is nothing. */
function runningIn(project: Project) {
  const n = /^(\d+)\s+packs?\s+running/i.exec(project.run);
  return n ? Number(n[1]) : 0;
}

function num(value: string) {
  const n = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * A produced number.
 *
 * The overview used to say these as key/value lines — "Topics    18" — in the
 * same list as "Channel" and "Goal". That flattens two different kinds of fact
 * into one: what the workspace has MADE is a figure you scan and compare week
 * to week, while what it is SET UP with is a setting you read once and correct.
 * Rows made them indistinguishable, so the panel read as a database record.
 */
function Metric({
  label,
  value,
  hint,
  icon,
  tint,
  fg,
  live,
}: {
  label: string;
  value: number;
  hint: string;
  icon: ReactNode;
  tint: string;
  fg?: string;
  /** A pulsing dot beside the figure — something is happening right now. */
  live?: boolean;
}) {
  return (
    <div
      style={{
        padding: "13px 15px",
        borderRadius: 14,
        background: "rgba(0,0,0,0.24)",
        border: `1px solid ${w(0.06)}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 11,
        }}
      >
        <span
          style={{
            width: 21,
            height: 21,
            flex: "none",
            borderRadius: 7,
            display: "grid",
            placeItems: "center",
            background: tint,
          }}
        >
          {icon}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: t(0.58) }}>
          {label}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: font.tight,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: value > 0 && fg ? fg : t(0.92),
          }}
        >
          {value.toLocaleString()}
        </span>
        {live ? (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color.good,
              animation: "os-pulse 1.1s ease-in-out infinite",
            }}
          />
        ) : null}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: t(0.38) }}>{hint}</div>
    </div>
  );
}

/**
 * A thing the workspace is configured WITH, and whether it is configured at all.
 *
 * Every one of these is editable, so every one of these is a button into the
 * editor. An unset setting says so in amber rather than reading as a blank
 * value — "Not written yet" for a brand voice is the single most consequential
 * empty field on this page, and as a grey table row it looked like nothing.
 */
function Setup({
  label,
  value,
  icon,
  set,
  onEdit,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  set: boolean;
  onEdit: () => void;
}) {
  return (
    <Hov
      onClick={onEdit}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 14px",
        borderRadius: 14,
        cursor: "pointer",
        minWidth: 0,
        background: "rgba(0,0,0,0.24)",
        border: `1px solid ${set ? w(0.06) : "rgba(201,154,63,0.28)"}`,
        transition: "background 160ms, border-color 160ms",
      }}
      hover={{ background: w(0.07) }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          flex: "none",
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          background: set ? w(0.06) : "rgba(201,154,63,0.14)",
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 10.5,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: t(0.36),
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            fontSize: 12.5,
            fontWeight: 500,
            color: set ? t(0.88) : color.warn,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </span>
      </span>
      <PencilIcon size={11} stroke={t(0.3)} />
    </Hov>
  );
}

export function HomeView() {
  const { go, projectIdx, projects, project, openProjectSheet, packs, runs } =
    useStore();

  /*
   * The two lists under the workspace cards, from real rows.
   *
   * "Continue working" is the runs that are genuinely part-written — not
   * queued, not finished — newest first, because that is what "continue" means.
   * It used to be two fixed cards that were still there after the work was
   * done, which is the one thing a resume list must never do.
   */
  const continueItems = runs
    .filter((r) => {
      const done = r.sections.filter((x) => x.state === "done").length;
      return done > 0 && done < r.sections.length;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 2)
    .map((r) => {
      const done = r.sections.filter((x) => x.state === "done").length;
      const pct = Math.round((done / r.sections.length) * 100);
      const next = r.sections.find((x) => x.state !== "done");
      return {
        kicker: `TEMPLATE RUN · ${done} OF ${r.sections.length}`,
        title: r.title,
        pct: `${pct}%`,
        meta: next ? `Next up: ${next.title}` : "Ready to finish",
        href: `/runs/${r.id}`,
      };
    });

  /** The library, most recently reached for first. */
  const recentPacks = [...packs]
    .sort((a, b) => (b.runs ?? 0) - (a.runs ?? 0))
    .slice(0, 3);

  /*
   * What is actually waiting on you.
   *
   * A failed section is the only thing in this app that stops on its own and
   * needs a person; a workspace with no voice is the other, because every pack
   * inherits the voice and an empty one quietly writes in nobody's. The panel
   * used to list two fixed items that never went away however much you did.
   */
  const attention = [
    ...runs.flatMap((r) =>
      r.sections
        .filter((x) => x.state === "failed")
        .map((x) => ({
          title: `${x.title} failed`,
          meta: `${r.title} · ${x.error || "the model did not answer"}`,
          href: `/runs/${r.id}`,
        })),
    ),
    ...projects
      .filter((p) => !p.brandVoice.trim())
      .map((p) => ({
        title: `${p.name} has no brand voice`,
        meta: "Every template inherits it — templates run without one write in nobody's voice",
        href: "/workspaces",
      })),
  ].slice(0, 5);

  /** The last things that happened, newest first. */
  const activity = runs
    .flatMap((r) =>
      r.sections
        .filter((x) => x.state === "done" || x.state === "failed")
        .map((x) => ({
          dot: x.state === "done" ? "#4bb07a" : "#c9553f",
          text: `${x.title} ${x.state === "done" ? "written" : "failed"} for ${r.title}`,
          at: x.updatedAt,
        })),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4)
    .map((v) => ({ ...v, time: ago(v.at) }));

  // The date is a client-only value: the server renders the design's literal
  // string, the browser swaps in today's date without a hydration mismatch.
  const today = useSyncExternalStore(
    noSubscribe,
    () => formatToday(new Date()),
    () => "TUESDAY · 26 AUGUST",
  );

  const running = runningIn(project);
  const voiced = project.brandVoice.trim().length > 0;

  /*
   * The opening line, derived rather than typed.
   *
   * It was a fixed sentence — "Three packs are mid-run and two sections are
   * waiting on your review" — which stayed put whatever the workspace under it
   * was doing, and said the same thing after you switched to a project with
   * nothing running at all.
   */
  const clauses: string[] = [];
  if (running) {
    clauses.push(
      `${word(running).toLowerCase()} template${running === 1 ? "" : "s"} running`,
    );
  }
  if (attention.length) {
    clauses.push(
      `${word(attention.length).toLowerCase()} thing${
        attention.length === 1 ? "" : "s"
      } waiting on you`,
    );
  }
  const state = clauses.length
    ? clauses.join(" and ")
    : "nothing running, nothing waiting on you";

  return (
    <div
      style={{
        ...rise(260),
        maxWidth: 1180,
        margin: "0 auto",
        padding: "40px 30px 60px",
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: "0.14em",
          color: t(0.4),
        }}
      >
        {today}
      </div>
      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 38,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          margin: "10px 0 4px",
        }}
      >
        What are you creating?
      </h1>
      <p style={{ margin: "0 0 24px", fontSize: 14.5, color: t(0.5) }}>
        {/*
          It named neither the workspace nor, when both counts were zero, a true
          fact: "No packs are mid-run and no sections are waiting on your
          review" is a sentence assembled out of two blanks. Now it says which
          brand you are in first — you can be in any of four — and then only the
          clauses that are actually true of it.
        */}
        <strong style={{ fontWeight: 600, color: t(0.78) }}>
          {project.name}
        </strong>{" "}
        — {state}.
      </p>

      {/*
        The workspace you are in, as a page rather than a row.

        Home used to carry a four-row strip of every project — the sidebar
        switcher, rendered twice. But you work in one brand at a time, and the
        question here is "how is THIS one doing": what it publishes as, whether
        it is still running, what it has produced, whether it has a voice yet.
        Comparing brands is a different question, and /projects is where it gets
        asked.
      */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontFamily: font.tight,
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          Your workspace
        </h2>
        <span style={{ fontFamily: font.mono, fontSize: 11, color: t(0.4) }}>
          {projects.length - 1} more workspace{projects.length === 2 ? "" : "s"}
        </span>
        <Hov
          as="span"
          onClick={() => go("/workspaces")}
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: color.accent,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Switch workspace →
        </Hov>
      </div>

      <div style={{ ...panel(18), padding: 18, marginBottom: 34 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            paddingBottom: 15,
            borderBottom: `1px solid ${w(0.07)}`,
          }}
        >
          <WorkspaceMark project={project} size={42} radius={13} />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  fontFamily: font.tight,
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {project.name}
              </span>
              <span
                style={{
                  flex: "none",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: PROJECT_STATUS[project.status][1],
                  color: PROJECT_STATUS[project.status][2],
                }}
              >
                {PROJECT_STATUS[project.status][0]}
              </span>
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11.5,
                color: t(0.42),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {project.handle}
              {project.channel ? ` · ${project.channel}` : ""}
              {project.langs.length ? ` · ${langLabel(project.langs)}` : ""}
            </div>
          </div>

          <Hov
            as="span"
            onClick={() => openProjectSheet(projectIdx)}
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 12px",
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: w(0.06),
              border: `1px solid ${w(0.08)}`,
              color: t(0.75),
            }}
            hover={{ background: w(0.14) }}
          >
            <PencilIcon size={12} stroke={t(0.7)} />
            Edit workspace
          </Hov>
        </div>

        {/*
          Two bands, because there are two kinds of fact here and the flat
          key/value list treated them as one.

          PRODUCTION is what the workspace has made — figures you scan, compare
          and act on. SETUP is what it has been told — settings you read once,
          notice are missing, and go and fix. "Workspaces: 4 in this account" is
          in neither: it is a fact about the account, and it is already said in
          the line above this panel.
        */}
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: t(0.42),
            margin: "16px 0 10px",
          }}
        >
          PRODUCTION
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 10,
          }}
        >
          <Metric
            label="Topics"
            value={num(project.topics)}
            hint="parked and researched"
            icon={<TopicSparkIcon size={11} stroke={color.accentText} />}
            tint="rgba(0,87,252,0.18)"
          />
          <Metric
            label="Templates"
            value={num(project.packs)}
            hint={running ? `${running} running now` : "none running"}
            icon={<PackTinyIcon size={11} stroke={color.accentText} />}
            tint="rgba(0,87,252,0.18)"
            live={running > 0}
          />
          <Metric
            label="Content"
            value={num(project.content)}
            hint="made in this workspace"
            icon={<ContentIcon size={11} stroke={color.good} />}
            tint="rgba(75,176,122,0.16)"
          />
          <Metric
            label="Needs review"
            value={attention.length}
            hint={attention.length ? "waiting on you" : "nothing half-done"}
            icon={<AlertIcon size={11} stroke={color.warn} />}
            tint="rgba(201,154,63,0.16)"
            fg={color.warn}
          />
        </div>

        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: t(0.42),
            margin: "18px 0 10px",
          }}
        >
          SETUP
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 10,
          }}
        >
          <Setup
            label="Publishing as"
            value={
              project.channel
                ? project.langs.length
                  ? `${project.channel} · ${langLabel(project.langs)}`
                  : project.channel
                : "No channel name yet"
            }
            icon={
              <GlobeIcon
                size={13}
                stroke={project.channel ? t(0.6) : color.warn}
              />
            }
            set={Boolean(project.channel)}
            onEdit={() => openProjectSheet(projectIdx)}
          />
          <Setup
            label="Goal"
            value={project.goal || "No goal written yet"}
            icon={
              <TargetIcon
                size={13}
                stroke={project.goal ? color.accentText : color.warn}
              />
            }
            set={Boolean(project.goal)}
            onEdit={() => openProjectSheet(projectIdx)}
          />
          <Setup
            label="Brand voice"
            value={
              voiced
                ? `${project.brandVoice.trim().length.toLocaleString()} chars — every template inherits it`
                : "Not written yet"
            }
            icon={<VoiceIcon size={13} stroke={voiced ? t(0.6) : color.warn} />}
            set={voiced}
            onEdit={() => openProjectSheet(projectIdx)}
          />
        </div>
      </div>

      {/*
        Nothing half-written means no section at all, heading included. An
        empty "Continue working" is a promise the page cannot keep, and it took
        up the same space whether or not there was anything to resume.
      */}
      {continueItems.length ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <h2
              style={{
                fontFamily: font.tight,
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                margin: 0,
              }}
            >
              Continue working
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 34,
            }}
          >
            {continueItems.map((c) => (
              <Hov
                key={c.href}
                onClick={() => go(c.href)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "15px 16px",
                  borderRadius: 16,
                  cursor: "pointer",
                  background: w(0.045),
                  border: `1px solid ${w(0.08)}`,
                  backdropFilter: "blur(30px) saturate(155%)",
                  boxShadow: `0 8px 24px rgba(0,0,0,0.28), inset 0 1px 0 ${w(0.06)}`,
                  transition: "all 180ms",
                }}
                hover={{ background: w(0.08) }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: font.mono,
                      fontSize: 9.5,
                      letterSpacing: "0.13em",
                      color: t(0.38),
                      marginBottom: 5,
                    }}
                  >
                    {c.kicker}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 7,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.title}
                  </div>
                  <div
                    style={{
                      height: 3,
                      borderRadius: 2,
                      background: w(0.09),
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 2,
                        background: "linear-gradient(90deg,#0057fc,#6a9dff)",
                        width: c.pct,
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 7, fontSize: 11.5, color: t(0.45) }}>
                    {c.meta}
                  </div>
                </div>
                <ChevronRight size={16} stroke={t(0.35)} />
              </Hov>
            ))}
          </div>
        </>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.35fr 1fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        <div style={{ ...panel(18), padding: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "12px 12px 10px",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                display: "grid",
                placeItems: "center",
                background: "rgba(0,87,252,0.18)",
              }}
            >
              <PackTinyIcon size={12} stroke={color.accentText} />
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>
              Recent templates
            </span>
            <Hov
              as="span"
              onClick={() => go("/packs")}
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: color.accent,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              View all →
            </Hov>
          </div>
          {recentPacks.map((p) => (
            <Hov
              key={p.id}
              onClick={() => go(`/pack/${p.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 12px",
                borderRadius: 13,
                cursor: "pointer",
                transition: "background 160ms",
              }}
              hover={{ background: w(0.06) }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: font.mono,
                  fontSize: 11,
                  fontWeight: 500,
                  background: w(0.07),
                  border: `1px solid ${w(0.09)}`,
                  color: t(0.7),
                }}
              >
                {p.n}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: t(0.42) }}>
                  {p.sections} sections · {p.used}
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 20,
                  background: PACK_STATUS[p.status].bg,
                  color: PACK_STATUS[p.status].fg,
                }}
              >
                {p.status}
              </div>
            </Hov>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...panel(18), padding: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "12px 12px 10px",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(201,154,63,0.18)",
                }}
              >
                <AlertIcon size={12} stroke={color.warn} />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                Needs attention
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  fontFamily: font.mono,
                  color: t(0.4),
                }}
              >
                {attention.length}
              </span>
            </div>
            {attention.map((a) => (
              <Hov
                key={a.title}
                onClick={() => go(a.href)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 13,
                  cursor: "pointer",
                }}
                hover={{ background: w(0.06) }}
              >
                <div
                  style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}
                >
                  {a.title}
                </div>
                <div style={{ fontSize: 11.5, color: t(0.44) }}>{a.meta}</div>
              </Hov>
            ))}
          </div>

          <div style={{ ...panel(18), padding: 6 }}>
            <div
              style={{
                padding: "12px 12px 8px",
                fontSize: 13.5,
                fontWeight: 700,
              }}
            >
              Recent activity
            </div>
            {activity.map((v) => (
              <div
                key={v.text + v.at}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "8px 12px",
                }}
              >
                <span
                  style={{
                    marginTop: 5,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    flex: "0 0 6px",
                    background: v.dot,
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: t(0.72),
                    lineHeight: 1.45,
                  }}
                >
                  {v.text}
                </div>
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10,
                    color: t(0.32),
                  }}
                >
                  {v.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
