"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  ghost,
  ghostHover,
  primary,
  primaryActive,
  primaryHover,
  spring,
  t,
  w,
} from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

export type ButtonVariant = "primary" | "ghost" | "accent" | "quiet" | "danger";
export type ButtonSize = "sm" | "md";

const HEIGHT: Record<ButtonSize, number> = { sm: 30, md: 34 };
const PAD: Record<ButtonSize, string> = { sm: "0 12px", md: "0 15px" };
const TEXT: Record<ButtonSize, number> = { sm: 12, md: 12.5 };

const VARIANT: Record<
  ButtonVariant,
  { base: CSSProperties; hover: CSSProperties }
> = {
  primary: { base: primary, hover: primaryHover },
  ghost: { base: ghost, hover: ghostHover },
  /** Tinted rather than filled — a secondary action that still reads as ours. */
  accent: {
    base: {
      color: "#6a9dff",
      background: "rgba(0,87,252,0.14)",
      border: "1px solid rgba(0,87,252,0.3)",
      cursor: "pointer",
    },
    hover: { background: "rgba(0,87,252,0.24)" },
  },
  /** No chrome until you touch it. */
  quiet: {
    base: {
      color: t(0.6),
      background: "transparent",
      border: `1px solid transparent`,
      cursor: "pointer",
    },
    hover: { background: w(0.08), color: "#f0f0f4" },
  },
  danger: {
    base: {
      color: "#d1656b",
      background: "rgba(209,101,107,0.12)",
      border: "1px solid rgba(209,101,107,0.25)",
      cursor: "pointer",
    },
    hover: { background: "rgba(209,101,107,0.22)" },
  },
};

/**
 * Every button in the app.
 *
 * Variants carry the palette, sizes carry the metrics — so two buttons on
 * different screens cannot drift a pixel apart, which is what happened while
 * each view spread `primary` into its own inline style.
 */
export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "sm",
  icon,
  iconRight,
  disabled = false,
  full = false,
  label,
  title,
  style,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  disabled?: boolean;
  /** Stretch to the width of its container. */
  full?: boolean;
  /** Accessible name — required when there is no text. */
  label?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const v = VARIANT[variant];
  return (
    <Hov
      onClick={disabled ? undefined : onClick}
      // Hov only assigns button semantics to something it can click, so a
      // disabled button would otherwise stop being a button at all.
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={label}
      title={title ?? label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        height: HEIGHT[size],
        padding: PAD[size],
        width: full ? "100%" : undefined,
        borderRadius: 9,
        fontSize: TEXT[size],
        fontWeight: 600,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: `background 200ms ${spring}, border-color 200ms ${spring}, color 200ms ${spring}`,
        ...v.base,
        ...style,
      }}
      hover={disabled ? undefined : v.hover}
      active={variant === "primary" && !disabled ? primaryActive : undefined}
    >
      {icon}
      {children}
      {iconRight}
    </Hov>
  );
}

/**
 * A square button holding one glyph. The label is required: an icon on its own
 * says nothing to a screen reader, and nothing on hover either.
 */
export function IconButton({
  children,
  onClick,
  label,
  variant = "ghost",
  size = 26,
  disabled = false,
  stopPropagation = false,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  variant?: Extract<ButtonVariant, "ghost" | "quiet" | "accent" | "danger">;
  size?: number;
  disabled?: boolean;
  /**
   * Set inside a clickable row, so the row does not also fire — including when
   * the row is an anchor, whose navigation is a default rather than a bubble.
   */
  stopPropagation?: boolean;
  style?: CSSProperties;
}) {
  const v = VARIANT[variant];
  return (
    <Hov
      as="span"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={
        disabled
          ? undefined
          : (e) => {
              if (stopPropagation) {
                e.stopPropagation();
                /*
                 * And the default, because these rows are real anchors.
                 *
                 * `stopPropagation` only stops React's synthetic bubbling; the
                 * browser still follows the enclosing <a href>. So Edit on a
                 * row opened the row instead of the edit sheet, and the button
                 * looked broken while doing exactly what it was told.
                 */
                e.preventDefault();
              }
              onClick?.();
            }
      }
      style={{
        width: size,
        height: size,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: 7,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: `background 200ms ${spring}, color 200ms ${spring}`,
        ...(variant === "ghost"
          ? {
              background: w(0.07),
              border: `1px solid ${w(0.09)}`,
              color: t(0.6),
            }
          : v.base),
        ...style,
      }}
      hover={
        disabled
          ? undefined
          : variant === "ghost"
            ? { background: w(0.14), color: "#f0f0f4" }
            : v.hover
      }
    >
      {children}
    </Hov>
  );
}
