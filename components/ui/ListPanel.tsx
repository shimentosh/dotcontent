"use client";

import type { CSSProperties, ReactNode } from "react";

import { font, panel, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

/**
 * The list every index screen uses: one frosted panel, a monospace column
 * header, optional group dividers, and rows that click through.
 *
 * A page passes one `columns` template and uses it for the header and every
 * row, so nothing can fall out of alignment.
 */
export function ListPanel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...panel(18), overflow: "hidden", ...style }}>{children}</div>
  );
}

export function ListHeader({
  columns,
  labels,
}: {
  columns: string;
  /** One per column; pass an empty string for a column that holds actions. */
  labels: readonly string[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns,
        gap: 14,
        padding: "10px 18px",
        borderBottom: `1px solid ${w(0.07)}`,
        background: w(0.02),
        fontFamily: font.mono,
        fontSize: 9.5,
        letterSpacing: "0.13em",
        color: t(0.38),
      }}
    >
      {labels.map((label, i) => (
        <span key={label || `col-${i}`}>{label}</span>
      ))}
    </div>
  );
}

/** The divider that starts a group of rows — a category, a shelf, a date. */
export function ListGroup({
  icon,
  label,
  meta,
  children,
  style,
}: {
  icon?: ReactNode;
  label: string;
  /** Right-hand note, usually a count. */
  meta?: ReactNode;
  /** Controls belonging to the group as a whole. */
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "10px 18px",
        background: w(0.015),
        ...style,
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 9.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: t(0.55),
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: w(0.055) }} />
      {meta ? <span style={{ fontSize: 11, color: t(0.32) }}>{meta}</span> : null}
      {children}
    </div>
  );
}

export function ListRow({
  columns,
  onClick,
  href,
  highlight = false,
  dim = false,
  children,
}: {
  columns: string;
  onClick?: () => void;
  /** Where the row goes — makes it a real link, openable in a new tab. */
  href?: string;
  /** Just arrived — flashes, then settles. */
  highlight?: boolean;
  /** Ignored or archived: present, but stepped back. */
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <Hov
      onClick={onClick}
      href={href}
      style={{
        display: "grid",
        gridTemplateColumns: columns,
        color: "inherit",
        textDecoration: "none",
        gap: 14,
        alignItems: "center",
        padding: "12px 18px",
        borderTop: `1px solid ${w(0.04)}`,
        cursor: onClick ? "pointer" : "default",
        opacity: dim ? 0.62 : 1,
        background: highlight ? "rgba(0,87,252,0.1)" : "transparent",
        boxShadow: highlight ? "inset 2px 0 0 #0057fc" : undefined,
        transition: `background 400ms ${spring}, box-shadow 400ms ${spring}, opacity 200ms ${spring}`,
      }}
      hover={onClick ? { background: w(0.055), opacity: 1 } : undefined}
    >
      {children}
    </Hov>
  );
}

/** The title-and-subtitle pair that starts most rows. */
export function ListCell({
  icon,
  title,
  subtitle,
  after,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Sits next to the title, e.g. a part number. */
  after?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      {icon}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            fontSize: 13.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
          {after}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 2,
              fontSize: 11.5,
              color: t(0.42),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The tinted tile that carries a row glyph or number. */
export function RowTile({
  children,
  bg,
  size = 34,
}: {
  children: ReactNode;
  bg?: string;
  size?: number;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 11,
        display: "grid",
        placeItems: "center",
        fontFamily: font.mono,
        fontSize: 10.5,
        background: bg ?? w(0.06),
        border: `1px solid ${w(0.07)}`,
      }}
    >
      {children}
    </span>
  );
}

/** Mono value in a numeric column, so digits line up down the list. */
export function ListStat({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: font.mono, fontSize: 12.5, color: t(0.72) }}>
      {children}
    </span>
  );
}

/** Nothing to show — say why, and offer the way out. */
export function EmptyState({
  icon,
  title,
  line,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  line?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 18px",
          borderTop: `1px solid ${w(0.04)}`,
          fontSize: 12.5,
          color: t(0.4),
        }}
      >
        <span>{line ?? title}</span>
        {action}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "44px 18px 48px",
        textAlign: "center",
      }}
    >
      {icon ? (
        <span
          style={{
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            borderRadius: 12,
            background: w(0.05),
            border: `1px solid ${w(0.08)}`,
          }}
        >
          {icon}
        </span>
      ) : null}
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
      {line ? (
        <div style={{ fontSize: 12.5, color: t(0.42), maxWidth: 340 }}>
          {line}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}
