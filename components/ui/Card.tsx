"use client";

import type { CSSProperties, ReactNode } from "react";

import { spring, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

/** The glass card behind every grid tile — packs, topics, tools. */
export function Card({
  children,
  onClick,
  href,
  highlight = false,
  padding = 17,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** Where the card goes — makes it a real link, openable in a new tab. */
  href?: string;
  /** Just arrived — outlined, then settles. */
  highlight?: boolean;
  padding?: number;
  style?: CSSProperties;
}) {
  return (
    <Hov
      onClick={onClick}
      href={href}
      style={{
        display: "flex",
        flexDirection: "column",
        padding,
        color: "inherit",
        textDecoration: "none",
        borderRadius: 17,
        cursor: onClick ? "pointer" : "default",
        background: highlight
          ? "rgba(0,87,252,0.12)"
          : `linear-gradient(165deg, ${w(0.075)} 0%, ${w(0.042)} 60%, ${w(0.028)} 100%)`,
        border: `1px solid ${highlight ? "rgba(0,87,252,0.45)" : w(0.075)}`,
        borderTopColor: highlight ? "rgba(0,87,252,0.45)" : w(0.14),
        backdropFilter: "blur(30px) saturate(155%)",
        WebkitBackdropFilter: "blur(30px) saturate(155%)",
        boxShadow: `0 1px 2px rgba(0,0,0,0.3), 0 12px 30px -10px rgba(0,0,0,0.45), inset 0 1px 0 ${w(0.1)}`,
        transition: `transform 220ms ${spring}, border-color 220ms ${spring}, background 300ms ${spring}`,
        ...style,
      }}
      hover={
        onClick
          ? { transform: "translateY(-2px)", borderColor: "rgba(0,87,252,0.4)" }
          : { borderColor: w(0.16) }
      }
    >
      {children}
    </Hov>
  );
}

/** A grid of cards that reflows on its own. */
export function CardGrid({
  children,
  min = 320,
  columns,
}: {
  children: ReactNode;
  /** Minimum card width before the grid drops a column. */
  min?: number;
  /** Fixed column count, when a screen wants exactly three. */
  columns?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns
          ? `repeat(${columns},1fr)`
          : `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
