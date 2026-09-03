"use client";

import type { PackDraft } from "@/lib/data";
import { font, t, w } from "@/lib/theme";
import { StepTile } from "@/components/builder/StepPalette";

/**
 * The template as it stands, beside the step you are editing.
 *
 * The first and last steps of the builder are two text boxes on a screen wide
 * enough for six, and what you are actually assembling — the flow — was only
 * visible on the middle step. Keeping it here means the rail, the work and the
 * thing being built are on screen the whole way through, which is the
 * difference between a wizard and a bench.
 */
export function TemplateSummary({ draft }: { draft: PackDraft }) {
  const written = draft.sections.filter((s) => s.brief.trim()).length;

  return (
    <aside
      aria-label="This template"
      style={{
        position: "sticky",
        top: 12,
        alignSelf: "start",
        maxHeight: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        borderRadius: 15,
        overflow: "hidden",
        background: w(0.04),
        border: `1px solid ${w(0.09)}`,
      }}
    >
      <div style={{ padding: "13px 13px 12px" }}>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.14em",
            color: t(0.32),
          }}
        >
          AS THE LIBRARY SHOWS IT
        </div>
        <div
          style={{
            marginTop: 7,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: draft.name.trim() ? "#f0f0f4" : t(0.3),
          }}
        >
          {draft.name.trim() || "Untitled template"}
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 11.5,
            lineHeight: 1.5,
            color: draft.summary.trim() ? t(0.5) : t(0.28),
          }}
        >
          {draft.summary.trim() || "No one-line description yet"}
        </div>
      </div>

      <div
        style={{
          padding: "10px 13px 8px",
          borderTop: `1px solid ${w(0.07)}`,
          fontFamily: font.mono,
          fontSize: 9,
          letterSpacing: "0.14em",
          color: t(0.32),
        }}
      >
        THE FLOW
      </div>

      <div style={{ overflowY: "auto", padding: "0 9px 10px" }}>
        {draft.sections.length === 0 ? (
          <div style={{ padding: "4px 4px 8px", fontSize: 11.5, color: t(0.35) }}>
            No steps yet. The Sections step is where they go.
          </div>
        ) : (
          draft.sections.map((s, i) => {
            const empty = !s.brief.trim();
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "5px 4px",
                }}
              >
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10,
                    color: t(0.3),
                    width: 16,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <StepTile name={s.type} size={22} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 550,
                    color: empty ? t(0.45) : "#f0f0f4",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.name || "Untitled"}
                </span>
                {empty ? (
                  <span
                    title="No prompt written yet"
                    style={{
                      marginLeft: "auto",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#c99a3f",
                      flex: "none",
                    }}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          marginTop: "auto",
          padding: "10px 13px",
          borderTop: `1px solid ${w(0.08)}`,
          background: "rgba(0,0,0,0.2)",
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: "0.08em",
          color: t(0.4),
        }}
      >
        {draft.sections.length} STEP{draft.sections.length === 1 ? "" : "S"} ·{" "}
        <span style={{ color: written === draft.sections.length ? "#4bb07a" : "#c99a3f" }}>
          {written} WITH A PROMPT
        </span>
      </div>
    </aside>
  );
}
