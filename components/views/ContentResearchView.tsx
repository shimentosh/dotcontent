"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import {
  DEPTHS,
  RESEARCH_STEPS,
  briefToText,
  buildBrief,
  findTool,
  looksLikeUrl,
  type ResearchBrief,
  type ResearchDepth,
  type ResearchLang,
} from "@/lib/tools";
import { useStore } from "@/lib/store";
import {
  font,
  ghost,
  ghostHover,
  primary,
  rise,
  spring,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import {
  AlertIcon,
  CheckIcon,
  ChevronLeft,
  CopyIcon,
  LinkIcon,
  PlayIcon,
  RefreshIcon,
  ResearchIcon,
  TopicSparkIcon,
} from "@/components/ui/Icons";

/** How long each step of the simulated run holds, in milliseconds. */
const STEP_MS = 420;

const NO_TOPIC = "none";

const kicker = {
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.14em",
  color: t(0.38),
} as const;

export function ContentResearchView() {
  const { go, seriesList } = useStore();
  const tool = findTool("content-research");

  // ?q= lets another screen hand the tool its subject — the Research button on
  // a topic arrives here already filled in.
  const params = useSearchParams();
  const [subject, setSubject] = useState(params.get("q") ?? "");
  const [notes, setNotes] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>("Standard");
  const [lang, setLang] = useState<ResearchLang>("EN");
  const [topic, setTopic] = useState(NO_TOPIC);

  /** -1 while idle, then the index of the step in flight. */
  const [step, setStep] = useState(-1);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [copied, setCopied] = useState(false);
  const [attached, setAttached] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const running = step >= 0;
  const ready = subject.trim().length > 1 && !running;

  const run = () => {
    if (!ready) return;
    if (timer.current) clearInterval(timer.current);
    setBrief(null);
    setCopied(false);
    setAttached(null);
    setStep(0);

    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      if (i < RESEARCH_STEPS.length) {
        setStep(i);
        return;
      }
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setStep(-1);
      setBrief(buildBrief(subject, depth, lang, notes));
    }, STEP_MS);
  };

  const copy = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(briefToText(brief));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied — the brief is on screen either way.
      setCopied(false);
    }
  };

  const isUrl = looksLikeUrl(subject);

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1060,
        margin: "0 auto",
        padding: "28px 30px 60px",
      }}
    >
      <Hov
        as="span"
        onClick={() => go("/tools")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 14,
          fontSize: 12.5,
          color: t(0.45),
          cursor: "pointer",
        }}
        hover={{ color: "#f0f0f4" }}
      >
        <ChevronLeft size={13} stroke="currentColor" />
        Tools
      </Hov>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 38,
            height: 38,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 12,
            background: "rgba(0,87,252,0.16)",
            border: "1px solid rgba(0,87,252,0.3)",
          }}
        >
          <ResearchIcon size={19} stroke="#6a9dff" />
        </span>
        <h1
          style={{
            fontFamily: font.tight,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: 0,
          }}
        >
          Content Research
        </h1>
      </div>
      <p style={{ margin: "0 0 22px", fontSize: 13.5, color: t(0.48) }}>
        {tool?.tagline}
      </p>

      <div
        style={{
          padding: 22,
          borderRadius: 18,
          background: `linear-gradient(165deg, ${w(0.07)} 0%, ${w(0.042)} 55%, ${w(0.028)} 100%)`,
          border: `1px solid ${w(0.075)}`,
          borderTopColor: w(0.14),
          backdropFilter: "blur(30px) saturate(155%)",
          WebkitBackdropFilter: "blur(30px) saturate(155%)",
          boxShadow: `0 1px 2px rgba(0,0,0,0.3), 0 12px 34px -10px rgba(0,0,0,0.45), inset 0 1px 0 ${w(0.1)}`,
        }}
      >
        <Field
          label="Subject"
          hint={
            subject.trim()
              ? isUrl
                ? "reads as a website"
                : "reads as a topic"
              : "a website URL, or a topic in plain words"
          }
        >
          <div style={{ position: "relative" }}>
            {subject.trim() ? (
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {isUrl ? (
                  <LinkIcon size={13} stroke={t(0.4)} />
                ) : (
                  <TopicSparkIcon size={13} stroke={t(0.4)} />
                )}
              </span>
            ) : null}
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
              placeholder="remove.bg  ·  or  ·  AI agents for creators"
              style={{ paddingLeft: subject.trim() ? 32 : 12 }}
            />
          </div>
        </Field>

        <Field label="What do you want out of it?" hint="optional">
          <TextArea
            mono={false}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. one honest verdict, aimed at people who have never paid for a tool"
          />
        </Field>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <Segmented
            label="Depth"
            options={DEPTHS}
            value={depth}
            onChange={(v) => setDepth(v as ResearchDepth)}
          />
          <Segmented
            label="Brief language"
            options={["EN", "BN"]}
            value={lang}
            onChange={(v) => setLang(v as ResearchLang)}
          />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>
              Attach to topic
            </div>
            <Select
              size="sm"
              label="Attach to topic"
              value={topic}
              onChange={setTopic}
              options={[
                { value: NO_TOPIC, label: "Keep it loose" },
                // Real topics in this workspace. It listed the sample
                // documents, so research could be attached to a topic that
                // does not exist and never to one that does.
                ...seriesList.flatMap((series) =>
                  series.topics.map((x) => ({
                    value: x.id,
                    label: x.name,
                    group: series.name,
                  })),
                ),
              ]}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingTop: 16,
            borderTop: `1px solid ${w(0.06)}`,
          }}
        >
          <Hov
            onClick={run}
            aria-disabled={!ready}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 34,
              padding: "0 16px",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              opacity: ready ? 1 : 0.4,
              ...primary,
            }}
          >
            {running ? (
              <RefreshIcon
                size={12}
                stroke="#fff"
                style={{ animation: "os-spin 900ms linear infinite" }}
              />
            ) : (
              <PlayIcon size={11} />
            )}
            {running ? "Researching…" : brief ? "Run again" : "Run research"}
          </Hov>
          <span style={{ fontSize: 12, color: t(0.4) }}>
            {running
              ? RESEARCH_STEPS[Math.max(0, step)]
              : `${depth} pass · ${tool?.runtime}`}
          </span>
        </div>

        {running ? (
          <div style={{ marginTop: 16, display: "grid", gap: 7 }}>
            {RESEARCH_STEPS.map((s, i) => {
              const done = i < step;
              const now = i === step;
              return (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontSize: 12.5,
                    color: done ? t(0.5) : now ? "#f0f0f4" : t(0.3),
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      borderRadius: "50%",
                      background: done
                        ? "rgba(75,176,122,0.16)"
                        : now
                          ? "rgba(0,87,252,0.28)"
                          : w(0.06),
                      animation: now
                        ? "os-pulse 1.1s ease-in-out infinite"
                        : "none",
                    }}
                  >
                    {done ? <CheckIcon size={8} stroke="#4bb07a" /> : null}
                  </span>
                  {s}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {brief ? (
        <div
          style={{
            marginTop: 16,
            borderRadius: 18,
            overflow: "hidden",
            background: `linear-gradient(165deg, ${w(0.06)} 0%, ${w(0.035)} 60%, ${w(0.024)} 100%)`,
            border: `1px solid ${w(0.075)}`,
            borderTopColor: w(0.14),
            backdropFilter: "blur(30px) saturate(155%)",
            WebkitBackdropFilter: "blur(30px) saturate(155%)",
            boxShadow: `0 1px 2px rgba(0,0,0,0.3), 0 12px 34px -10px rgba(0,0,0,0.45)`,
            animation: `os-rise 240ms ${spring} both`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "14px 18px",
              borderBottom: `1px solid ${w(0.06)}`,
            }}
          >
            {brief.kind === "url" ? (
              <LinkIcon size={14} stroke={t(0.5)} />
            ) : (
              <TopicSparkIcon size={14} stroke={t(0.5)} />
            )}
            <span style={{ fontSize: 14, fontWeight: 650 }}>{brief.name}</span>
            <span
              style={{
                fontSize: 10,
                fontFamily: font.mono,
                letterSpacing: "0.1em",
                padding: "3px 7px",
                borderRadius: 6,
                background: w(0.07),
                color: t(0.5),
              }}
            >
              {brief.depth.toUpperCase()} · {brief.lang}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
              <Hov
                onClick={copy}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 600,
                  ...ghost,
                }}
                hover={ghostHover}
              >
                <CopyIcon size={12} stroke="currentColor" />
                {copied ? "Copied" : "Copy brief"}
              </Hov>
              {topic !== NO_TOPIC ? (
                <Hov
                  onClick={() =>
                    setAttached(
                      seriesList
                        .flatMap((series) => series.topics)
                        .find((x) => x.id === topic)?.name ?? null,
                    )
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 9,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#6a9dff",
                    background: "rgba(0,87,252,0.14)",
                    border: "1px solid rgba(0,87,252,0.3)",
                    cursor: "pointer",
                  }}
                  hover={{ background: "rgba(0,87,252,0.22)" }}
                >
                  {attached ? `Attached to ${attached}` : "Attach to topic"}
                </Hov>
              ) : null}
            </div>
          </div>

          <div style={{ padding: "16px 18px 20px" }}>
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 13.5,
                lineHeight: 1.6,
                color: t(0.8),
              }}
            >
              {brief.summary}
            </p>
            {brief.intent ? (
              <p style={{ margin: "0 0 6px", fontSize: 12.5, color: t(0.45) }}>
                Wanted: {brief.intent}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                margin: "14px 0 18px",
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(201,154,63,0.12)",
                border: "1px solid rgba(201,154,63,0.28)",
                fontSize: 12,
                lineHeight: 1.55,
                color: "#c99a3f",
              }}
            >
              <AlertIcon size={13} stroke="currentColor" style={{ flex: "none", marginTop: 1 }} />
              <span>
                Nothing below is confirmed. Content OS has no crawler wired up
                yet, so this is the shape of the research — what to check, where
                to look — not fetched facts.
              </span>
            </div>

            <Block title="VERIFY BEFORE WRITING">
              {brief.verify.map((v) => (
                <Row key={v} mark="open">
                  {v}
                </Row>
              ))}
            </Block>

            <Block title="ANGLES">
              {brief.angles.map((a, i) => (
                <Row key={a} mark={String(i + 1).padStart(2, "0")}>
                  {a}
                </Row>
              ))}
            </Block>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 18,
              }}
            >
              <Block title="OPEN QUESTIONS">
                {brief.questions.map((q) => (
                  <Row key={q} mark="?">
                    {q}
                  </Row>
                ))}
              </Block>

              <Block
                title={brief.kind === "url" ? "PAGES TO READ" : "WHERE TO LOOK"}
              >
                {/* By position — two lines of a brief may read the same. */}
                {brief.look.map((l, i) => (
                  <Row key={i} mark="→" mono>
                    {l}
                  </Row>
                ))}
              </Block>
            </div>

            <div style={{ ...kicker, marginTop: 4, marginBottom: 8 }}>
              KEYWORDS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {brief.keywords.map((k) => (
                <span
                  key={k}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 7,
                    fontSize: 11.5,
                    background: w(0.06),
                    border: `1px solid ${w(0.08)}`,
                    color: t(0.7),
                  }}
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Depth / language pickers — the same segmented control twice. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          gap: 3,
          padding: 3,
          borderRadius: 10,
          background: "rgba(0,0,0,0.3)",
          border: `1px solid ${w(0.07)}`,
        }}
      >
        {options.map((o) => {
          const on = o === value;
          return (
            <Hov
              key={o}
              onClick={() => onChange(o)}
              aria-pressed={on}
              style={{
                flex: 1,
                height: 26,
                display: "grid",
                placeItems: "center",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: on ? "rgba(0,87,252,0.28)" : "transparent",
                color: on ? "#bcd3ff" : t(0.5),
                transition: `background 200ms ${spring}, color 200ms ${spring}`,
              }}
              hover={on ? undefined : { color: t(0.8), background: w(0.05) }}
            >
              {o}
            </Hov>
          );
        })}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...kicker, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "grid", gap: 7 }}>{children}</div>
    </div>
  );
}

function Row({
  mark,
  mono,
  children,
}: {
  mark: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span
        style={{
          width: 20,
          flex: "none",
          fontFamily: font.mono,
          fontSize: 10,
          color: mark === "open" ? t(0.3) : t(0.42),
        }}
      >
        {mark === "open" ? "○" : mark}
      </span>
      <span
        style={{
          fontSize: mono ? 11.5 : 12.5,
          fontFamily: mono ? font.mono : font.sans,
          lineHeight: 1.55,
          color: t(mono ? 0.6 : 0.78),
          wordBreak: mono ? "break-all" : "normal",
        }}
      >
        {children}
      </span>
    </div>
  );
}
