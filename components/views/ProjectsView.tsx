"use client";

import { langLabel, PROJECT_STATUS } from "@/lib/data";
import { useStore } from "@/lib/store";
import {
  color,
  font,
  primary,
  primaryActive,
  primaryHover,
  rise,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { WorkspaceMark } from "@/components/ui/WorkspaceMark";
import { PencilIcon, PlusIcon, VoiceIcon } from "@/components/ui/Icons";

export function ProjectsView() {
  // The live list, not the constant: channel, status and voice are editable
  // now, and this screen would otherwise keep showing what they were seeded as.
  const { projectIdx, setProjectIdx, go, projects, openProjectSheet, newProject } =
    useStore();

  const pick = (i: number) => {
    setProjectIdx(i);
    go("/");
  };

  return (
    <div
      style={{
        ...rise(260),
        maxWidth: 1100,
        margin: "0 auto",
        padding: "40px 30px 60px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          marginBottom: 26,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: "0.14em",
              color: t(0.4),
            }}
          >
            YOUR ACCOUNT
          </div>
          <h1
            style={{
              fontFamily: font.tight,
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              margin: "9px 0 4px",
            }}
          >
            Workspaces
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: t(0.5) }}>
            One workspace per brand. Topics, packs, content and voice stay
            isolated.
          </p>
        </div>
        <Hov
          onClick={newProject}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 33,
            padding: "0 14px",
            borderRadius: 10,
            fontSize: 12.5,
            fontWeight: 600,
            ...primary,
          }}
          hover={primaryHover}
          active={primaryActive}
        >
          <PlusIcon size={13} stroke="#fff" />
          <span>New Workspace</span>
        </Hov>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        {projects.map((p, i) => {
          const current = i === projectIdx;
          return (
            <Hov
              key={p.handle}
              onClick={() => pick(i)}
              style={{
                padding: 17,
                borderRadius: 18,
                cursor: "pointer",
                background: w(0.045),
                border: `1px solid ${current ? "rgba(0,87,252,0.4)" : w(0.09)}`,
                backdropFilter: "blur(30px) saturate(155%)",
                boxShadow: `0 10px 30px rgba(0,0,0,0.3), inset 0 1px 0 ${w(0.07)}`,
                transition: "all 180ms",
              }}
              hover={{ background: w(0.085), transform: "translateY(-2px)" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  marginBottom: 15,
                }}
              >
                <WorkspaceMark project={p} size={34} radius={11} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.name}
                    </span>
                    <span
                      style={{
                        flex: "none",
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 20,
                        background: PROJECT_STATUS[p.status][1],
                        color: PROJECT_STATUS[p.status][2],
                      }}
                    >
                      {PROJECT_STATUS[p.status][0]}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: t(0.62),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.channel || "No channel name yet"}
                  </div>
                  <div style={{ fontSize: 11.5, color: t(0.42) }}>
                    {p.handle} · {langLabel(p.langs)}
                  </div>
                </div>
                <span
                  style={{
                    flex: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Hov
                    as="span"
                    aria-label={`Edit ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openProjectSheet(i);
                    }}
                    style={{
                      width: 26,
                      height: 26,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: w(0.06),
                      border: `1px solid ${w(0.08)}`,
                    }}
                    hover={{ background: w(0.15) }}
                  >
                    <PencilIcon size={11} stroke={t(0.65)} />
                  </Hov>
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      padding: "3px 7px",
                      borderRadius: 20,
                      background: current ? "rgba(0,87,252,0.18)" : w(0.07),
                      color: current ? color.accentText : t(0.5),
                    }}
                  >
                    {current ? "CURRENT" : "SWITCH"}
                  </span>
                </span>
              </div>

              <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
                {[
                  { v: p.topics, k: "Topics" },
                  { v: p.packs, k: "Packs" },
                  { v: p.content, k: "Content" },
                ].map((stat) => (
                  <div
                    key={stat.k}
                    style={{
                      flex: 1,
                      padding: "9px 10px",
                      borderRadius: 11,
                      background: "rgba(0,0,0,0.24)",
                      border: `1px solid ${w(0.06)}`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: font.tight,
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {stat.v}
                    </div>
                    <div style={{ fontSize: 10.5, color: t(0.4) }}>
                      {stat.k}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11.5,
                  color: t(0.5),
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    flex: "0 0 6px",
                    borderRadius: "50%",
                    background: p.dot,
                  }}
                />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.run}
                </span>

                {/* Whether this brand writes in anyone's voice yet, and the way
                    in to fix it. Straight to the editor rather than switching
                    workspace first — the answer to "no brand voice" is to write
                    one, not to go and look at it. */}
                <Hov
                  as="span"
                  aria-label={`Edit ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openProjectSheet(i);
                  }}
                  style={{
                    marginLeft: "auto",
                    flex: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 9px",
                    borderRadius: 20,
                    cursor: "pointer",
                    background: p.brandVoice.trim()
                      ? w(0.06)
                      : "rgba(201,154,63,0.16)",
                    color: p.brandVoice.trim() ? t(0.5) : color.warn,
                  }}
                  hover={{
                    background: p.brandVoice.trim()
                      ? w(0.13)
                      : "rgba(201,154,63,0.28)",
                  }}
                >
                  <VoiceIcon
                    size={11}
                    stroke={p.brandVoice.trim() ? t(0.5) : color.warn}
                  />
                  {p.brandVoice.trim() ? "Voice set" : "No brand voice"}
                </Hov>
              </div>
            </Hov>
          );
        })}
      </div>
    </div>
  );
}
