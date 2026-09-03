import type { CSSProperties } from "react";

/** Font stacks. The variables are bound to next/font faces in app/layout.tsx. */
export const font = {
  sans: "var(--font-inter), Inter, system-ui, sans-serif",
  tight: "var(--font-inter-tight), Inter, sans-serif",
  mono: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
  /** Inter carries no Bengali glyphs; Bangla copy has to opt into this. */
  bangla: "var(--font-noto-bengali), 'Noto Sans Bengali', sans-serif",
  /** Long-form reading only — see reading mode. */
  read: "var(--font-source-serif), Georgia, 'Times New Roman', serif",
} as const;

/**
 * What sits above what.
 *
 * These were scattered inline — a menu at 45, a modal at 70, a sheet at 60 —
 * and the numbers had never been compared to each other. A Select opened
 * inside a dialog painted UNDER the dialog, because a menu that normally opens
 * over the page had been given a number for that job only. A floating menu is
 * always the newest thing on screen and always belongs on top of whatever
 * opened it, which is only obvious when the layers are written down together.
 */
export const layer = {
  /** The sidebar and the top bar. */
  chrome: 30,
  /** Slide-over sheets: run setup, project, add section. */
  sheet: 60,
  /** Centred dialogs, and the command palette. */
  modal: 70,
  /** A confirm, which can be raised BY a dialog. */
  confirm: 80,
  /** Reading mode, which takes the whole window. */
  reading: 90,
  /** Menus, popovers, selects — above anything that can open one. */
  menu: 120,
} as const;

/** Text on the dark ground, at a given opacity. */
export const t = (a: number) => `rgba(240,240,244,${a})`;
/** A white veil, at a given opacity. */
export const w = (a: number) => `rgba(255,255,255,${a})`;

/**
 * One hue carries the whole product: #0057fc, the accent, for anything active
 * or clickable. Everything else is neutral, apart from three muted signals
 * that only appear when a state genuinely needs calling out.
 */
export const color = {
  bg: "#06060a",
  text: "#f0f0f4",

  /** Filled controls, checked boxes, the focus ring. */
  accent: "#0057fc",
  /** The accent as text or an icon on the dark ground, where solid is too dim. */
  accentText: "#6a9dff",
  /** The same, brighter — for a filled accent chip's own label. */
  accentBright: "#a8c7ff",

  /** Done. */
  good: "#4bb07a",
  /** Wants a look. */
  warn: "#c99a3f",
  /** Broke. */
  bad: "#d1656b",
  /** Idle, archived, ignored — no hue at all. */
  mute: "rgba(240,240,244,0.5)",
} as const;

/**
 * macOS-style spring. Overshoots almost imperceptibly, settles fast — the
 * curve AppKit uses for sheets and popovers.
 */
export const spring = "cubic-bezier(0.32, 0.72, 0, 1)";

/* ── The scale ─────────────────────────────────────────────────────────────
   One 4px step, and four radii. A console earns its density by never having a
   stray value in it: two panels 13px and 14px apart do not read as deliberate,
   they read as unfinished. Everything spatial below is a multiple of 4.       */

export const sp = {
  /** Between a glyph and its label. */
  xs: 4,
  /** Inside a control. */
  sm: 8,
  /** Between rows of one thing. */
  md: 12,
  /** Between a block and the next block. */
  lg: 16,
  /** Between sections of a page. */
  xl: 24,
  /** Between a page's major bands. */
  xxl: 32,
} as const;

export const radius = {
  /** Tags and swatches. */
  tag: 4,
  /** Buttons, inputs, rows. */
  control: 6,
  /** Panels and tables. */
  panel: 10,
  /** Sheets and menus — the only things allowed to look soft. */
  sheet: 14,
} as const;

/**
 * The hairline.
 *
 * Structure in this redesign is carried by lines rather than by shadows: a
 * table is a real grid of rules, not a stack of floating cards. `hair` divides
 * rows, `edge` bounds a surface, `strong` marks a boundary you are meant to
 * read as a break.
 */
export const line = {
  hair: `1px solid ${w(0.05)}`,
  edge: `1px solid ${w(0.07)}`,
  strong: `1px solid ${w(0.12)}`,
  accent: `1px solid rgba(0,87,252,0.5)`,
} as const;

/* ── Materials ─────────────────────────────────────────────────────────────
   The previous design was frosted glass all the way down: every panel blurred
   and saturated whatever passed behind it. It photographs well and it reads
   badly at this density — thirty rows of text over a live gradient is thirty
   rows fighting their own background, and a hairline drawn on glass is a
   hairline you cannot see.

   So the material is now flat. The aurora stays as the room's ambient light,
   but surfaces sit ON it rather than refract it: a near-transparent fill, one
   hairline, no blur, no ambient shadow. Elevation is reserved for things that
   genuinely float — menus, sheets — which are opaque instead, because a menu
   that shows the table through it is a menu you have to read twice.           */

/**
 * A panel: the flat surface behind a table, a list, or a group of fields.
 *
 * The radius argument survives from the glass version so call sites did not
 * all have to change, but it is clamped — nothing in a console is rounder than
 * `radius.panel`, and the old 16–18px corners were most of why the screens
 * read as cards on a marketing page.
 */
export const panel = (r: number = radius.panel, lift = false): CSSProperties => ({
  borderRadius: Math.min(r, radius.panel),
  background: w(0.022),
  border: line.edge,
  ...(lift ? { boxShadow: "0 18px 44px -20px rgba(0,0,0,0.75)" } : null),
});

/** A recessed well — inputs, code, anything you type or read into. */
export const well = (r: number = radius.control): CSSProperties => ({
  borderRadius: r,
  background: "rgba(0,0,0,0.28)",
  border: line.hair,
});

/**
 * Floating surfaces. Opaque on purpose: a popover is a different plane, and
 * the fastest way to say so is to stop the plane underneath showing through.
 */
export const overlay: CSSProperties = {
  background: "#0d0d13",
  border: line.strong,
  boxShadow: "0 28px 64px -24px rgba(0,0,0,0.9)",
};

/* ── Controls ──────────────────────────────────────────────────────────── */

/** The blue primary action. Flat: one fill, one top highlight, no glow. */
export const primary: CSSProperties = {
  color: "#fff",
  cursor: "pointer",
  background: color.accent,
  border: `1px solid ${w(0.16)}`,
  boxShadow: `inset 0 1px 0 ${w(0.2)}`,
  transition: `filter 140ms ${spring}, transform 140ms ${spring}`,
};

// Shades of the accent are reached with a filter rather than a second hex, so
// the palette stays exactly as many colours as it claims to be.
export const primaryHover: CSSProperties = { filter: "brightness(1.14)" };
export const primaryActive: CSSProperties = {
  filter: "brightness(0.94)",
  transform: "translateY(0.5px)",
};

/** The neutral secondary action. */
export const ghost: CSSProperties = {
  background: w(0.045),
  border: line.edge,
  cursor: "pointer",
  transition: `background 140ms ${spring}, border-color 140ms ${spring}`,
};

export const ghostHover: CSSProperties = {
  background: w(0.085),
  borderColor: w(0.14),
};

/** The small inline "Edit" / "Run Again" style buttons under an output. */
export const softButton: CSSProperties = {
  fontSize: 11,
  fontWeight: 550,
  padding: "5px 10px",
  borderRadius: radius.control,
  background: w(0.04),
  border: line.hair,
  color: t(0.8),
  cursor: "pointer",
  transition: `background 140ms ${spring}, border-color 140ms ${spring}`,
};

export const softButtonHover: CSSProperties = {
  background: w(0.09),
  borderColor: w(0.13),
};

/** The accented variant of the same. */
export const softButtonAccent: CSSProperties = {
  ...softButton,
  color: color.accentText,
  background: "rgba(0,87,252,0.12)",
  border: "1px solid rgba(0,87,252,0.28)",
};

export const softButtonAccentHover: CSSProperties = {
  background: "rgba(0,87,252,0.2)",
  borderColor: "rgba(0,87,252,0.45)",
};

/* ── Type ──────────────────────────────────────────────────────────────────
   Four sizes and one numeric style. The old scale ran from 38px display type
   down to 9.5px labels with a dozen stops in between; at console density the
   jumps stopped meaning anything. A page now has one 20px line at the top and
   then everything is 12.5px, which is what makes the 20px line read as a
   heading at all.                                                            */

export const type = {
  /** The one line at the top of a screen that names it. */
  display: {
    fontFamily: font.tight,
    fontSize: 20,
    fontWeight: 640,
    letterSpacing: "-0.022em",
    lineHeight: 1.15,
  } as CSSProperties,
  /** A band or panel heading inside a screen. */
  title: {
    fontFamily: font.tight,
    fontSize: 13.5,
    fontWeight: 640,
    letterSpacing: "-0.012em",
  } as CSSProperties,
  /** Everything else. */
  body: { fontSize: 12.5, lineHeight: 1.5 } as CSSProperties,
  /** Secondary copy, meta lines, hints. */
  small: { fontSize: 11.5, lineHeight: 1.45, color: t(0.5) } as CSSProperties,
  /** Figures: monospaced and tabular so a column of them lines up. */
  num: {
    fontFamily: font.mono,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  } as CSSProperties,
} as const;

/** Small monospace section label, e.g. "PACK OVERVIEW". */
export const kicker = (size = 9.5): CSSProperties => ({
  fontFamily: font.mono,
  fontSize: size,
  fontWeight: 400,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: t(0.36),
});

/**
 * A status tag.
 *
 * Square, monospaced and upper-case rather than the old rounded pill: a pill
 * is a thing you click, and none of these are. Keeping the same `(bg, fg)`
 * signature means every status map in lib/data.ts still drives them.
 */
export const chip = (bg: string, fg: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontFamily: font.mono,
  fontSize: 9.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "3px 6px",
  borderRadius: radius.tag,
  background: bg,
  color: fg,
  whiteSpace: "nowrap",
});

/* ── Grids ─────────────────────────────────────────────────────────────────
   Tables are the primary layout of this app, so they are a primitive rather
   than something each screen re-invents. Head and row take the same column
   template, which is the only way the two stay aligned.                      */

/** The column-header rule above a table. */
export const tableHead = (cols: string): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: cols,
  alignItems: "center",
  gap: sp.md,
  height: 26,
  padding: `0 ${sp.md}px`,
  borderBottom: line.edge,
  ...kicker(9),
  color: t(0.3),
});

/** One row of it. Rows are 36px: three lines of 12.5px copy per 100px. */
export const tableRow = (cols: string, height = 36): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: cols,
  alignItems: "center",
  gap: sp.md,
  minHeight: height,
  padding: `0 ${sp.md}px`,
  borderBottom: line.hair,
  fontSize: 12.5,
  transition: `background 120ms ${spring}`,
});

export const rowHover: CSSProperties = { background: w(0.04) };

/**
 * The page enter animation applied to every routed view.
 *
 * Four pixels rather than ten: at this density a long travel reads as the page
 * arriving late. `prefers-reduced-motion` is honoured globally in globals.css.
 */
export const rise = (ms: number): CSSProperties => ({
  animation: `os-rise ${Math.min(ms, 200)}ms ${spring}`,
});

/** Shared page container widths from the design. */
export const page = (maxWidth: number, padding: string): CSSProperties => ({
  maxWidth,
  margin: "0 auto",
  padding,
});
