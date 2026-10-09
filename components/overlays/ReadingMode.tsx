"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { ContentDoc, DocSection } from "@/lib/content-docs";
import { font, layer, spring } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { CloseIcon } from "@/components/ui/Icons";
import { ReadingText } from "@/components/overlays/ReadingText";

/** A block of the document as reading mode receives it. */
export type ReadingGroup = {
  key: string;
  label: string;
  sections: DocSection[];
};

/**
 * The three grounds a page can be read on.
 *
 * None of them is pure white or pure black. A white page on a lit screen is a
 * lamp pointed at the reader, and white text on true black smears at the edges
 * — the glyph glows into the ground and the eye keeps refocusing. Every ground
 * here is warm and every ink sits a little short of the extremes, which is the
 * whole of what makes a long page comfortable.
 */
export type ReadingTheme = "paper" | "sepia" | "night";

type Palette = {
  label: string;
  /** The page behind everything. */
  bg: string;
  /** The sheet the text sits on. */
  sheet: string;
  /** Body text. */
  ink: string;
  /** Headings — a shade firmer than the body. */
  strong: string;
  /** Labels, numbers, notes. */
  muted: string;
  /** Rules and dividers. */
  rule: string;
  /** The one colour on the page. */
  accent: string;
  /** The swatch shown in the theme switch. */
  swatch: string;
};

export const READING_THEMES: Record<ReadingTheme, Palette> = {
  paper: {
    label: "Paper",
    bg: "#efe9df",
    sheet: "#f7f3ec",
    ink: "#332e28",
    strong: "#1f1b17",
    muted: "#7d7264",
    rule: "#ded5c6",
    accent: "#9a6533",
    swatch: "#f7f3ec",
  },
  sepia: {
    label: "Sepia",
    bg: "#e2d5bd",
    sheet: "#ece1cc",
    ink: "#3c3226",
    strong: "#2a2219",
    muted: "#7f705a",
    rule: "#d2c3a5",
    accent: "#8a5423",
    swatch: "#e6d9c0",
  },
  night: {
    label: "Night",
    bg: "#131211",
    sheet: "#1a1917",
    ink: "#ddd3c4",
    strong: "#f0e8db",
    muted: "#8d8375",
    rule: "#2e2b27",
    accent: "#c9925c",
    swatch: "#1a1917",
  },
};

const SIZES = [16.5, 18, 19.5, 21.5] as const;

const STORE_KEY = "dotcontent.reading";

/** Bengali sits smaller than Latin at the same size, and needs more leading. */
const isBangla = (s: DocSection) => s.lang === "BN";

function readStored(): { theme: ReadingTheme; size: number } {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { theme: "paper", size: 1 };
    const saved = JSON.parse(raw) as { theme?: string; size?: number };
    return {
      theme:
        saved.theme && saved.theme in READING_THEMES
          ? (saved.theme as ReadingTheme)
          : "paper",
      size:
        typeof saved.size === "number" && saved.size >= 0 && saved.size < SIZES.length
          ? saved.size
          : 1,
    };
  } catch {
    // Private windows and blocked site data both throw rather than return null.
    return { theme: "paper", size: 1 };
  }
}

/**
 * The document, to be read rather than worked on.
 *
 * The page underneath is a workbench: every section carries a redo button, a
 * copy button and a state, because that page is where you decide whether the
 * thing is any good. None of that helps once you have decided to actually read
 * it — so this is the same text with the machinery taken away, one column, one
 * warm ground, at a size and measure meant for a page rather than a table.
 */
export function ReadingMode({
  open,
  onClose,
  doc,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  doc: ContentDoc;
  groups: ReadingGroup[];
}) {
  /*
   * Read from storage as the initial value rather than in an effect: an effect
   * would render the default ground first and repaint to the chosen one, which
   * on this screen is a flash of the wrong colour across the whole window.
   */
  const [{ theme, size }, setPref] = useState(() =>
    typeof window === "undefined"
      ? { theme: "paper" as ReadingTheme, size: 1 }
      : readStored(),
  );
  const setTheme = (next: ReadingTheme) => setPref((p) => ({ ...p, theme: next }));
  const setSize = (next: (n: number) => number) =>
    setPref((p) => ({ ...p, size: next(p.size) }));

  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ theme, size }));
    } catch {
      // A remembered preference is a nicety; failing to store it is not an error.
    }
  }, [open, theme, size]);

  /*
   * The page scrolls inside this element, not the window, so the keys that
   * read a long document — space, page down, the arrows — do nothing until
   * something inside it holds focus. It takes focus itself on open.
   */
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) surface.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // The page underneath must not scroll while this is over it.
    const held = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = held;
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const c = READING_THEMES[theme];
  const body = SIZES[size];

  const written = groups
    .map((g) => ({
      ...g,
      sections: g.sections.filter(
        (s) => s.state === "written" && s.body.length > 0,
      ),
    }))
    .filter((g) => g.sections.length > 0);

  return createPortal(
    <div
      ref={surface}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Reading ${doc.topic}`}
      style={{
        outline: "none",
        position: "fixed",
        inset: 0,
        zIndex: layer.reading,
        background: c.bg,
        color: c.ink,
        overflowY: "auto",
        animation: `os-fade 200ms ${spring} both`,
      }}
    >
      <Bar palette={c}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: c.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {doc.topic}
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(Object.keys(READING_THEMES) as ReadingTheme[]).map((key) => {
            const p = READING_THEMES[key];
            const on = key === theme;
            return (
              <Hov
                key={key}
                onClick={() => setTheme(key)}
                aria-label={`${p.label} background`}
                title={p.label}
                aria-pressed={on}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: p.swatch,
                  border: `1px solid ${on ? c.accent : c.rule}`,
                  boxShadow: on ? `0 0 0 2px ${c.accent}33` : undefined,
                  transition: `box-shadow 160ms ${spring}, border-color 160ms ${spring}`,
                }}
                hover={{ borderColor: c.accent }}
              />
            );
          })}
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            border: `1px solid ${c.rule}`,
            borderRadius: 9,
            overflow: "hidden",
          }}
        >
          <Step
            palette={c}
            label="Smaller text"
            disabled={size === 0}
            onClick={() => setSize((n) => Math.max(0, n - 1))}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>A</span>
          </Step>
          <span style={{ width: 1, alignSelf: "stretch", background: c.rule }} />
          <Step
            palette={c}
            label="Larger text"
            disabled={size === SIZES.length - 1}
            onClick={() => setSize((n) => Math.min(SIZES.length - 1, n + 1))}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>A</span>
          </Step>
        </span>

        <Hov
          onClick={onClose}
          aria-label="Close reading mode"
          title="Close (Esc)"
          style={{
            width: 30,
            height: 30,
            display: "grid",
            placeItems: "center",
            borderRadius: 9,
            cursor: "pointer",
            color: c.muted,
            border: `1px solid ${c.rule}`,
            transition: `background 160ms ${spring}, color 160ms ${spring}`,
          }}
          hover={{ background: c.sheet, color: c.strong }}
        >
          <CloseIcon size={12} stroke="currentColor" />
        </Hov>
      </Bar>

      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "46px 26px 140px",
          fontFamily: font.read,
          fontSize: body,
          lineHeight: 1.72,
        }}
      >
        <header style={{ marginBottom: 40 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: font.read,
              fontSize: body * 2,
              lineHeight: 1.18,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: c.strong,
            }}
          >
            {doc.topic}
          </h1>
          <p
            style={{
              margin: "10px 0 0",
              fontFamily: font.sans,
              fontSize: 13,
              color: c.muted,
            }}
          >
            {doc.pack}
            {doc.part ? ` · ${doc.part}` : ""}
          </p>
          <span
            style={{
              display: "block",
              width: 54,
              height: 2,
              marginTop: 22,
              background: c.accent,
              opacity: 0.55,
            }}
          />
        </header>

        {written.length === 0 ? (
          <p style={{ color: c.muted, fontFamily: font.sans, fontSize: 14 }}>
            Nothing has been written yet. Sections appear here as they finish.
          </p>
        ) : (
          written.map((group) => (
            <section key={group.key} style={{ marginBottom: 46 }}>
              <h2
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: "0 0 22px",
                  fontFamily: font.sans,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: c.accent,
                }}
              >
                {group.label}
                <span style={{ flex: 1, height: 1, background: c.rule }} />
              </h2>

              {group.sections.map((s) => (
                <div key={s.n} style={{ marginBottom: 34 }}>
                  <h3
                    style={{
                      margin: "0 0 10px",
                      fontFamily: font.sans,
                      fontSize: body * 0.82,
                      fontWeight: 650,
                      letterSpacing: "-0.005em",
                      color: c.strong,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: body * 0.62,
                        marginRight: 9,
                        color: c.muted,
                      }}
                    >
                      {s.n}
                    </span>
                    {s.name}
                  </h3>

                  {/*
                    The sections are written in markdown, so they are read as
                    markdown. Bengali carries its own family and leading —
                    its matras run into the line above at Latin leading, and
                    the script reads a size smaller at the same px.
                  */}
                  <ReadingText
                    lines={s.body}
                    palette={c}
                    metrics={{ size: body, bangla: isBangla(s) }}
                  />
                </div>
              ))}
            </section>
          ))
        )}
      </article>
    </div>,
    document.body,
  );
}

/** The bar that stays put: it is the only way out, so it does not scroll away. */
function Bar({
  palette,
  children,
}: {
  palette: Palette;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 18px",
        background: palette.bg,
        borderBottom: `1px solid ${palette.rule}`,
      }}
    >
      {children}
    </div>
  );
}

function Step({
  palette,
  label,
  disabled,
  onClick,
  children,
}: {
  palette: Palette;
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Hov
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      style={{
        width: 32,
        height: 28,
        display: "grid",
        placeItems: "center",
        fontFamily: font.sans,
        cursor: disabled ? "default" : "pointer",
        color: disabled ? palette.rule : palette.muted,
        transition: `background 160ms ${spring}, color 160ms ${spring}`,
      }}
      hover={disabled ? undefined : { background: palette.sheet, color: palette.strong }}
    >
      {children}
    </Hov>
  );
}
