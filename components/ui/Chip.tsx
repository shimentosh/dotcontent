"use client";

import type { CSSProperties, ReactNode } from "react";

import { font, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { CloseIcon } from "@/components/ui/Icons";

export type Tone = "mute" | "accent" | "good" | "warn" | "bad";

/** The only five fills a chip is allowed to take. */
export const TONE: Record<Tone, { bg: string; fg: string }> = {
  mute: { bg: "rgba(255,255,255,0.07)", fg: "rgba(240,240,244,0.5)" },
  accent: { bg: "rgba(0,87,252,0.16)", fg: "#6a9dff" },
  good: { bg: "rgba(75,176,122,0.16)", fg: "#4bb07a" },
  warn: { bg: "rgba(201,154,63,0.16)", fg: "#c99a3f" },
  bad: { bg: "rgba(209,101,107,0.16)", fg: "#d1656b" },
};

/**
 * A status pill. Pass a `tone` for the five house states, or an explicit
 * bg/fg when the value carries its own colour from data.
 */
export function Chip({
  children,
  tone = "mute",
  bg,
  fg,
  mono = false,
  icon,
  pulse = false,
  title,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  bg?: string;
  fg?: string;
  /** Uppercase monospace, for machine-ish values like ACTIVE or DRAFT. */
  mono?: boolean;
  icon?: ReactNode;
  /** Set while the thing it labels is still running. */
  pulse?: boolean;
  /** Tooltip, for a chip whose label is abbreviated. */
  title?: string;
  style?: CSSProperties;
}) {
  const paint = TONE[tone];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: mono ? "3px 8px" : "3px 9px",
        borderRadius: 20,
        whiteSpace: "nowrap",
        fontFamily: mono ? font.mono : undefined,
        fontSize: mono ? 9.5 : 10.5,
        letterSpacing: mono ? "0.1em" : undefined,
        fontWeight: mono ? 500 : 600,
        background: bg ?? paint.bg,
        color: fg ?? paint.fg,
        animation: pulse ? "os-pulse 1.1s ease-in-out infinite" : undefined,
        ...style,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

/** A chip you can take off again — one active filter, one picked value. */
export function RemovableChip({
  label,
  onRemove,
  dot,
}: {
  label: string;
  onRemove: () => void;
  dot?: string;
}) {
  return (
    <Hov
      as="span"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      title={`Remove ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 24,
        padding: "0 8px",
        borderRadius: 7,
        fontSize: 11.5,
        cursor: "pointer",
        color: t(0.78),
        background: w(0.06),
        border: `1px solid ${w(0.1)}`,
        transition: `background 180ms ${spring}, color 180ms ${spring}`,
      }}
      hover={{ background: w(0.12), color: "#f0f0f4" }}
    >
      {dot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dot,
            flex: "none",
          }}
        />
      ) : null}
      {label}
      <CloseIcon size={9} stroke="currentColor" style={{ opacity: 0.65 }} />
    </Hov>
  );
}
