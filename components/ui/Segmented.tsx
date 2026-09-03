"use client";

import type { CSSProperties, ReactNode } from "react";

import { spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

export type SegmentedOption<T extends string> = {
  value: T;
  label?: string;
  icon?: ReactNode;
  /** Tooltip and accessible name — required when there is no label. */
  title?: string;
};

/**
 * The pill row used for tabs, layout toggles, depth pickers and every other
 * "pick exactly one of these" control. Same track, same metrics, everywhere.
 *
 * `tone="accent"` fills the selected pill blue, for a choice that changes what
 * a following action will do; the default fills it with plain glass, for
 * choices that only change the view.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "neutral",
  size = "md",
  full = false,
  style,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tone?: "neutral" | "accent";
  size?: "sm" | "md";
  full?: boolean;
  style?: CSSProperties;
}) {
  const height = size === "sm" ? 24 : 28;

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 3,
        padding: 3,
        borderRadius: size === "sm" ? 10 : 11,
        background: "rgba(0,0,0,0.3)",
        border: `1px solid ${w(0.07)}`,
        width: full ? "100%" : undefined,
        ...style,
      }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Hov
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={on}
            aria-label={option.title ?? option.label}
            title={option.title}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              flex: full ? 1 : undefined,
              height,
              padding: option.label ? "0 12px" : "0 8px",
              minWidth: option.label ? undefined : 28,
              borderRadius: 8,
              fontSize: size === "sm" ? 11.5 : 12.5,
              fontWeight: 600,
              cursor: "pointer",
              background: on
                ? tone === "accent"
                  ? "rgba(0,87,252,0.28)"
                  : w(0.12)
                : "transparent",
              color: on
                ? tone === "accent"
                  ? "#bcd3ff"
                  : "#f0f0f4"
                : t(0.5),
              transition: `background 200ms ${spring}, color 200ms ${spring}`,
            }}
            hover={on ? undefined : { color: t(0.82), background: w(0.05) }}
          >
            {option.icon}
            {option.label}
          </Hov>
        );
      })}
    </div>
  );
}
