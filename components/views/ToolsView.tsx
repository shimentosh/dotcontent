"use client";

import { useEffect, useMemo, useState } from "react";

import { TOOLS } from "@/lib/tools";
import { listTools, type StoredTool } from "@/lib/tools-client";
import { useStore } from "@/lib/store";
import { font, ghost, ghostHover, primary, rise, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { ClapperGlyph } from "@/components/ui/DocIcons";
import {
  ArrowRightIcon,
  ResearchIcon,
  ToolsIcon,
} from "@/components/ui/Icons";

/**
 * The bench, as this workspace sees it.
 *
 * The list is fetched rather than imported: which tools stand here is a
 * property of the workspace now, not of the release. The shipped definitions
 * are still the fallback for the first paint and for a console whose API is
 * unreachable — a bench that renders empty because a fetch failed looks like a
 * feature that was taken away.
 */

const GLYPH: Record<string, typeof ResearchIcon> = {
  "content-research": ResearchIcon,
  "content-researcher": ClapperGlyph,
};

const meta = {
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.13em",
  color: t(0.35),
} as const;

/** The shipped list, in the shape the screen reads, for the first paint. */
const FALLBACK: StoredTool[] = TOOLS.map((tool, i) => ({
  ...tool,
  scope: "all" as const,
  enabled: true,
  position: i,
  workspaces: [],
  updatedAt: "",
}));

export function ToolsView() {
  const { go, project } = useStore();
  const [tools, setTools] = useState<StoredTool[]>(FALLBACK);

  useEffect(() => {
    if (!project?.id) return;
    void listTools(project.id)
      .then(setTools)
      // Silent, and the shipped list stays on screen: the bench is still
      // useful, and every card on it still opens.
      .catch(() => {});
  }, [project?.id]);

  /** Grouped, in the order the categories first appear. */
  const groups = useMemo(() => {
    const out: { category: string; tools: StoredTool[] }[] = [];
    for (const tool of tools) {
      const group = out.find((g) => g.category === tool.category);
      if (group) group.tools.push(tool);
      else out.push({ category: tool.category || "Tools", tools: [tool] });
    }
    return out;
  }, [tools]);

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1060,
        margin: "0 auto",
        padding: "34px 30px 60px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
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
            Tools
          </h1>
          <p style={{ margin: "0 0 24px", fontSize: 13.5, color: t(0.48) }}>
            One job each, run on demand. A pack produces a whole topic — a tool
            answers the one question in front of it and hands the answer back.
            This is {project?.name ?? "this workspace"}&rsquo;s bench.
          </p>
        </div>
        <Hov
          onClick={() => go("/tools/manage")}
          href="/tools/manage"
          style={{
            height: 33,
            padding: "0 14px",
            display: "grid",
            placeItems: "center",
            borderRadius: 10,
            fontSize: 12.5,
            fontWeight: 600,
            color: "inherit",
            textDecoration: "none",
            ...ghost,
          }}
          hover={ghostHover}
        >
          All tools
        </Hov>
      </div>

      {groups.map((group) => (
        <div key={group.category} style={{ marginBottom: 26 }}>
          <div
            style={{
              ...meta,
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: 11,
            }}
          >
            {group.category.toUpperCase()}
            <span style={{ flex: 1, height: 1, background: w(0.07) }} />
            {group.tools.length}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 12,
            }}
          >
            {group.tools.map((tool) => {
              const Glyph = GLYPH[tool.slug] ?? ToolsIcon;
              return (
                <Hov
                  key={tool.slug}
                  onClick={() => go(`/tools/${tool.slug}`)}
                  href={`/tools/${tool.slug}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: 18,
                    borderRadius: 17,
                    cursor: "pointer",
                    color: "inherit",
                    textDecoration: "none",
                    background: `linear-gradient(165deg, ${w(0.075)} 0%, ${w(0.042)} 60%, ${w(0.028)} 100%)`,
                    border: `1px solid ${w(0.075)}`,
                    borderTopColor: w(0.14),
                    backdropFilter: "blur(30px) saturate(155%)",
                    WebkitBackdropFilter: "blur(30px) saturate(155%)",
                    boxShadow: `0 1px 2px rgba(0,0,0,0.3), 0 12px 30px -10px rgba(0,0,0,0.45), inset 0 1px 0 ${w(0.1)}`,
                    transition: `transform 220ms ${spring}, border-color 220ms ${spring}, box-shadow 220ms ${spring}`,
                  }}
                  hover={{
                    transform: "translateY(-2px)",
                    borderColor: "rgba(0,87,252,0.4)",
                    boxShadow: `0 1px 2px rgba(0,0,0,0.3), 0 18px 38px -12px rgba(0,0,0,0.55), inset 0 1px 0 ${w(0.12)}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        flex: "none",
                        display: "grid",
                        placeItems: "center",
                        borderRadius: 11,
                        background: "rgba(0,87,252,0.16)",
                        border: "1px solid rgba(0,87,252,0.3)",
                      }}
                    >
                      <Glyph size={17} stroke="#6a9dff" />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14.5,
                          fontWeight: 650,
                          letterSpacing: "-0.015em",
                        }}
                      >
                        {tool.name}
                      </div>
                      <div style={{ ...meta, marginTop: 3 }}>
                        RUNS IN {tool.runtime.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  <p
                    style={{
                      margin: "13px 0 15px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: t(0.55),
                    }}
                  >
                    {tool.tagline}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      paddingTop: 13,
                      borderTop: `1px solid ${w(0.06)}`,
                    }}
                  >
                    {[
                      ["TAKES", tool.takes],
                      ["RETURNS", tool.returns],
                      ["FEEDS", tool.feeds],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 10 }}>
                        <span style={{ ...meta, width: 58, flex: "none" }}>
                          {k}
                        </span>
                        <span style={{ fontSize: 12, color: t(0.65) }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: "auto",
                      paddingTop: 16,
                    }}
                  >
                    {/* `/tools/[tool]` has existed the whole time; the button
                        that is meant to reach it simply had no handler. */}
                    <Hov
                      as="span"
                      onClick={(e) => {
                        e.stopPropagation();
                        go(`/tools/${tool.slug}`);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        height: 31,
                        padding: "0 13px",
                        borderRadius: 9,
                        fontSize: 12.5,
                        fontWeight: 600,
                        ...primary,
                      }}
                    >
                      Open tool
                      <ArrowRightIcon size={12} stroke="#fff" />
                    </Hov>
                  </div>
                </Hov>
              );
            })}
          </div>
        </div>
      ))}

      {!tools.length ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 9,
            minHeight: 220,
            padding: 18,
            borderRadius: 17,
            border: `1px dashed ${w(0.12)}`,
            textAlign: "center",
          }}
        >
          <ToolsIcon size={18} stroke={t(0.3)} />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t(0.5) }}>
            No tools on this bench
          </div>
          <div style={{ fontSize: 12, color: t(0.33), maxWidth: 260 }}>
            Every tool is assigned to other workspaces. All tools shows which,
            and puts one here.
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 22,
          padding: "12px 14px",
          borderRadius: 12,
          background: w(0.03),
          border: `1px solid ${w(0.06)}`,
          fontSize: 12.5,
          color: t(0.5),
        }}
      >
        <span style={{ flex: 1 }}>
          Research a topic before a pack runs, and section 01 stops guessing.
        </span>
        <Hov
          as="span"
          onClick={() => go("/content")}
          style={{
            height: 29,
            padding: "0 12px",
            display: "grid",
            placeItems: "center",
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            ...ghost,
          }}
          hover={ghostHover}
        >
          Go to Topics
        </Hov>
      </div>
    </div>
  );
}
