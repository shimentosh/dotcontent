"use client";

import { useEffect, useState } from "react";

import { TOOL_CATEGORIES } from "@/lib/tools";
import { listAllTools, patchTool, type StoredTool } from "@/lib/tools-client";
import { useStore } from "@/lib/store";
import { font, ghost, ghostHover, rise, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Chip, Field, Select, TextInput } from "@/components/ui";
import { BackGlyph } from "@/components/ui/DocIcons";

/**
 * Every tool, and where each one appears.
 *
 * The bench at /tools is one workspace's; this is the whole set. Two screens
 * rather than a mode switch on one, because they answer different questions —
 * "what can I run here" and "where does this run" — and the second is edited
 * rarely enough that it does not belong in the way of the first.
 */

const meta = {
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.13em",
  color: t(0.35),
} as const;

export function ToolsManageView() {
  const { go, projects } = useStore();
  /*
   * Only workspaces the server knows about.
   *
   * The store opens on the design's sample workspaces, which carry an empty
   * id until the real ones arrive. Offering those as somewhere to assign a
   * tool means a tick that writes a row against a workspace that does not
   * exist — a foreign key error, reported as "something went wrong".
   */
  const real = projects.filter((p) => p.id);
  const [tools, setTools] = useState<StoredTool[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void listAllTools()
      .then(setTools)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  /*
   * Written straight through, and the row replaced with what came back.
   *
   * Optimistic local state would have to reproduce the server's rules about
   * scope and assignment; the server already knows them, and there is one row
   * in flight at a time on a screen nobody edits in bulk.
   */
  const save = async (slug: string, patch: Parameters<typeof patchTool>[1]) => {
    setSaving(slug);
    try {
      const next = await patchTool(slug, patch);
      setTools((list) => list.map((x) => (x.slug === slug ? next : x)));
    } catch {
      // The row keeps what it had, which is what the server still holds.
    } finally {
      setSaving(null);
    }
  };

  /** Ticking a workspace on a tool that was open to all pins it to that one. */
  const toggleWorkspace = (tool: StoredTool, id: string) => {
    const has = tool.workspaces.includes(id);
    const workspaces = has
      ? tool.workspaces.filter((x) => x !== id)
      : [...tool.workspaces, id];
    void save(tool.slug, {
      scope: "chosen",
      workspaces,
    });
  };

  return (
    <div
      style={{
        ...rise(240),
        maxWidth: 1060,
        margin: "0 auto",
        padding: "26px 30px 60px",
      }}
    >
      <Hov
        onClick={() => go("/tools")}
        href="/tools"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 14,
          fontSize: 12.5,
          fontWeight: 600,
          color: t(0.5),
          textDecoration: "none",
        }}
        hover={{ color: "#f0f0f4" }}
      >
        <BackGlyph size={13} stroke="currentColor" />
        Tools
      </Hov>

      <h1
        style={{
          fontFamily: font.tight,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          margin: "0 0 5px",
        }}
      >
        All tools
      </h1>
      <p style={{ margin: "0 0 24px", fontSize: 13.5, color: t(0.48) }}>
        Every tool this console has, what it is filed under, and which
        workspaces it stands in. A tool set to every workspace needs no ticks;
        tick one and it appears only where it is ticked.
      </p>

      {loaded && !tools.length ? (
        <p style={{ fontSize: 13, color: t(0.45) }}>
          No tools yet. The shipped ones are written in on the first request
          after an update — reload once.
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {tools.map((tool) => (
          <div
            key={tool.slug}
            style={{
              padding: 16,
              borderRadius: 15,
              background: w(0.04),
              border: `1px solid ${w(0.08)}`,
              opacity: tool.enabled ? 1 : 0.55,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14.5, fontWeight: 650 }}>
                {tool.name}
              </span>
              <Chip mono>{tool.category.toUpperCase()}</Chip>
              <Chip
                mono
                bg={
                  tool.scope === "all"
                    ? "rgba(0,87,252,0.16)"
                    : "rgba(255,255,255,0.07)"
                }
                fg={tool.scope === "all" ? "#6a9dff" : t(0.5)}
              >
                {tool.scope === "all"
                  ? "EVERY WORKSPACE"
                  : `${tool.workspaces.length} WORKSPACE${tool.workspaces.length === 1 ? "" : "S"}`}
              </Chip>
              {saving === tool.slug ? (
                <span style={{ ...meta, color: t(0.45) }}>SAVING…</span>
              ) : null}

              <Hov
                onClick={() => void save(tool.slug, { enabled: !tool.enabled })}
                style={{
                  marginLeft: "auto",
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
                {tool.enabled ? "Switch off" : "Switch on"}
              </Hov>
              <Hov
                onClick={() => go(`/tools/${tool.slug}`)}
                href={`/tools/${tool.slug}`}
                style={{
                  height: 29,
                  padding: "0 12px",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "inherit",
                  textDecoration: "none",
                  ...ghost,
                }}
                hover={ghostHover}
              >
                Open
              </Hov>
            </div>

            <p
              style={{
                margin: "10px 0 14px",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: t(0.5),
              }}
            >
              {tool.tagline}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 220px",
                gap: 12,
                alignItems: "start",
              }}
            >
              <Field label="Name" hint="what the bench calls it">
                <TextInput
                  defaultValue={tool.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== tool.name) void save(tool.slug, { name });
                  }}
                />
              </Field>
              <Field label="Category">
                <Select
                  label="Category"
                  value={tool.category}
                  onChange={(category) => void save(tool.slug, { category })}
                  options={[
                    ...(TOOL_CATEGORIES.includes(tool.category)
                      ? []
                      : [{ value: tool.category, label: tool.category }]),
                    ...TOOL_CATEGORIES.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </Field>
            </div>

            <div style={{ ...meta, margin: "6px 0 8px" }}>WHERE IT APPEARS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              <Hov
                onClick={() =>
                  void save(tool.slug, { scope: "all", workspaces: [] })
                }
                style={{
                  height: 29,
                  padding: "0 12px",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 600,
                  background:
                    tool.scope === "all" ? "rgba(0,87,252,0.2)" : w(0.05),
                  border: `1px solid ${tool.scope === "all" ? "rgba(0,87,252,0.4)" : w(0.08)}`,
                  color: tool.scope === "all" ? "#bcd3ff" : t(0.6),
                }}
                hover={{ background: w(0.1) }}
              >
                Every workspace
              </Hov>

              {real.map((p) => {
                const on = tool.scope === "chosen" && tool.workspaces.includes(p.id);
                return (
                  <Hov
                    key={p.id}
                    onClick={() => toggleWorkspace(tool, p.id)}
                    style={{
                      height: 29,
                      padding: "0 12px",
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 9,
                      fontSize: 12,
                      fontWeight: 600,
                      background: on ? "rgba(75,176,122,0.18)" : w(0.05),
                      border: `1px solid ${on ? "rgba(75,176,122,0.35)" : w(0.08)}`,
                      color: on ? "#4bb07a" : t(0.6),
                    }}
                    hover={{ background: w(0.1) }}
                  >
                    {p.name}
                  </Hov>
                );
              })}
              {!real.length ? (
                <span style={{ fontSize: 12, color: t(0.4) }}>
                  Workspaces are still loading.
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
