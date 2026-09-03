"use client";

import { t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

/**
 * An on/off switch.
 *
 * One setting, two states, and no third — that is the whole reason this is a
 * switch rather than a `Segmented` of two. It flips on click, so it belongs to
 * things that take effect immediately; anything that needs a Save belongs in a
 * form control instead.
 *
 * `label` is required and becomes the accessible name and the tooltip: a bare
 * switch announces itself as "switch, on" and nothing else, which tells a
 * screen reader user what it is and never what it does.
 */
export function Toggle({
  on,
  onToggle,
  label,
  disabled = false,
  size = "md",
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  /** `sm` for a switch sitting in a row of chips; `md` in a settings list. */
  size?: "sm" | "md";
}) {
  const metrics =
    size === "sm"
      ? { width: 32, height: 19, knob: 13 }
      : { width: 40, height: 23, knob: 17 };

  return (
    <Hov
      onClick={disabled ? undefined : onToggle}
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      aria-label={label}
      title={label}
      style={{
        width: metrics.width,
        height: metrics.height,
        flex: "none",
        borderRadius: 20,
        padding: 3,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        background: on ? "rgba(0,87,252,0.55)" : w(0.1),
        // Longhands, not the `border` shorthand: `Hov` merges hover styles one
        // key at a time, and a shorthand left half-overwritten falls back to
        // currentColor — which is how every bordered control in this app once
        // flashed white on the way out of a hover.
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: on ? "rgba(0,87,252,0.7)" : w(0.1),
        transition: "background 160ms, border-color 160ms",
      }}
      hover={disabled ? undefined : { borderColor: on ? "rgba(0,87,252,0.9)" : w(0.2) }}
    >
      <span
        style={{
          width: metrics.knob,
          height: metrics.knob,
          borderRadius: "50%",
          background: on ? "#f0f0f4" : t(0.65),
          boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
          transition: "background 160ms",
        }}
      />
    </Hov>
  );
}
