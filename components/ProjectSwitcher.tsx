"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { PROJECT_STATUS } from "@/lib/data";
import { useStore } from "@/lib/store";
import { font, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { WorkspaceMark } from "@/components/ui/WorkspaceMark";
import { Popover } from "@/components/ui/Popover";
import { ChevronDown } from "@/components/ui/Icons";

const menuRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 9px",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 12.5,
};

const ellipsis: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/**
 * The workspace switcher, at the top of the sidebar. Its menu matches the
 * trigger's width so it reads as an extension of the sidebar column.
 */
export function ProjectSwitcher() {
  const {
    projectIdx,
    setProjectIdx,
    projectOpen,
    toggleProject,
    go,
    projects,
    project,
    newProject,
  } = useStore();

  const ref = useRef<HTMLDivElement>(null);

  // Packs, sections and artifacts all belong to one workspace, so switching
  // returns home rather than leaving you on another workspace's screen.
  const pick = (i: number) => {
    setProjectIdx(i);
    go("/");
  };

  useEffect(() => {
    if (!projectOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest('[data-menu="project"]')) ||
        Boolean(ref.current?.contains(target));
      if (!inside) toggleProject();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [projectOpen, toggleProject]);

  return (
    <div ref={ref} style={{ marginBottom: 8 }}>
      <Hov
        onClick={toggleProject}
        aria-expanded={projectOpen}
        aria-haspopup="menu"
        aria-label={`Workspace: ${project.name}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 48,
          padding: "0 10px",
          borderRadius: 13,
          cursor: "pointer",
          background: projectOpen ? w(0.1) : w(0.05),
          border: `1px solid ${projectOpen ? w(0.16) : w(0.08)}`,
          boxShadow: `inset 0 1px 0 ${w(0.06)}`,
          transition: "background 160ms, border-color 160ms",
        }}
        hover={{ background: w(0.09), borderColor: w(0.14) }}
      >
        <WorkspaceMark project={project} size={28} radius={9} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              ...ellipsis,
            }}
          >
            {project.name}
          </div>
          <div
            style={{
              marginTop: 1,
              fontSize: 10.5,
              color: t(0.42),
              ...ellipsis,
            }}
          >
            {project.handle} · {project.packs}{" "}
            {project.packs === "1" ? "template" : "templates"}
          </div>
        </div>
        <ChevronDown
          size={11}
          stroke={t(0.45)}
          style={{
            flex: "none",
            transform: projectOpen ? "rotate(180deg)" : "none",
            transition: "transform 160ms",
          }}
        />
      </Hov>

      <Popover
        anchorRef={ref}
        open={projectOpen}
        width="anchor"
        offset={6}
        data-menu="project"
      >
        <div
          style={{
            padding: "7px 9px 6px",
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            color: t(0.38),
          }}
        >
          WORKSPACES
        </div>

        {projects.map((p, i) => (
          <Hov
            key={p.handle}
            onClick={() => pick(i)}
            style={{
              ...menuRow,
              background: i === projectIdx ? w(0.09) : "transparent",
            }}
            hover={{ background: w(0.09) }}
          >
            <WorkspaceMark project={p} size={24} radius={8} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                {/* A dot rather than the word: the menu row has no space for a
                    chip, and paused-or-not is the only part of the status you
                    need while choosing where to work. */}
                <span
                  title={p.status}
                  style={{
                    width: 5,
                    height: 5,
                    flex: "0 0 5px",
                    borderRadius: "50%",
                    background: PROJECT_STATUS[p.status][2],
                  }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 600, ...ellipsis }}>
                  {p.name}
                </span>
              </div>
              <div style={{ fontSize: 10.5, color: t(0.4), ...ellipsis }}>
                {p.handle} · {p.packs}{" "}
                {p.packs === "1" ? "template" : "templates"}
              </div>
            </div>
            <span
              style={{
                width: 11,
                flex: "none",
                fontSize: 11,
                color: "#6a9dff",
              }}
            >
              {i === projectIdx ? "✓" : ""}
            </span>
          </Hov>
        ))}

        <div style={{ height: 1, margin: "5px 7px", background: w(0.09) }} />

        <Hov
          onClick={() => go("/workspaces")}
          style={{ ...menuRow, color: t(0.72) }}
          hover={{ background: w(0.09), color: "#f0f0f4" }}
        >
          Manage workspaces
        </Hov>
        {/* Opens the editor rather than dropping you on the list you were
            already choosing from — "+ New workspace" and "Manage workspaces"
            went to the same place, so one of them was a lie. */}
        <Hov
          onClick={newProject}
          style={{ ...menuRow, fontWeight: 600, color: "#0057fc" }}
          hover={{ background: "rgba(0,87,252,0.14)" }}
        >
          + New workspace
        </Hov>
      </Popover>
    </div>
  );
}
