"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { font, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Popover } from "@/components/ui/Popover";
import { CheckIcon, ChevronDown } from "@/components/ui/Icons";

export type FilterOption = {
  value: string;
  label: string;
  /** How many rows would still be here if this value were picked. */
  count: number;
  /** Optional swatch, used by the status filter. */
  dot?: string;
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "7px 9px",
  borderRadius: 9,
  cursor: "pointer",
  fontSize: 12.5,
};

/**
 * A chip that opens a checklist of values. Open state is owned by the caller
 * so that only one of these can be open at a time.
 */
export function FilterMenu({
  label,
  icon,
  options,
  selected,
  open,
  onOpen,
  onToggle,
  onClear,
}: {
  label: string;
  icon: ReactNode;
  options: FilterOption[];
  selected: string[];
  open: boolean;
  onOpen: (next: boolean) => void;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const marker = `filter-${label.toLowerCase()}`;
  const active = selected.length > 0;

  // The panel is portalled out to <body>, so it is matched by its marker
  // rather than by containment in the chip.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest(`[data-menu="${marker}"]`)) ||
        Boolean(ref.current?.contains(target));
      if (!inside) onOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [marker, onOpen, open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Hov
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 30,
          padding: "0 10px",
          borderRadius: 9,
          fontSize: 12,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          color: active ? "#6a9dff" : t(0.72),
          background: active ? "rgba(0,87,252,0.14)" : open ? w(0.1) : w(0.05),
          border: `1px solid ${active ? "rgba(0,87,252,0.35)" : w(0.08)}`,
          transition: "background 150ms, border-color 150ms, color 150ms",
        }}
        hover={{
          background: active ? "rgba(0,87,252,0.2)" : w(0.1),
          borderColor: active ? "rgba(0,87,252,0.45)" : w(0.16),
        }}
      >
        {icon}
        <span>{label}</span>
        {active ? (
          <span
            style={{
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              display: "grid",
              placeItems: "center",
              borderRadius: 5,
              fontFamily: font.mono,
              fontSize: 9.5,
              color: "#fff",
              background: "#0057fc",
            }}
          >
            {selected.length}
          </span>
        ) : null}
        <ChevronDown
          size={10}
          stroke="currentColor"
          style={{
            opacity: 0.7,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 160ms",
          }}
        />
      </Hov>

      <Popover
        anchorRef={ref}
        open={open}
        align="right"
        width={228}
        offset={7}
        role="menu"
        data-menu={marker}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "7px 9px 6px",
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 9.5,
              letterSpacing: "0.14em",
              color: t(0.38),
            }}
          >
            {label.toUpperCase()}
          </span>
          {active ? (
            <Hov
              as="span"
              onClick={onClear}
              style={{
                marginLeft: "auto",
                fontSize: 10.5,
                fontWeight: 600,
                color: t(0.45),
                cursor: "pointer",
              }}
              hover={{ color: "#6a9dff" }}
            >
              Clear
            </Hov>
          ) : null}
        </div>

        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <Hov
              key={o.value}
              onClick={() => onToggle(o.value)}
              role="menuitemcheckbox"
              aria-checked={on}
              style={{
                ...row,
                color: o.count === 0 && !on ? t(0.35) : t(0.85),
                background: on ? w(0.08) : "transparent",
              }}
              hover={{ background: w(0.09) }}
            >
              <span
                style={{
                  width: 15,
                  height: 15,
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 5,
                  background: on ? "#0057fc" : w(0.06),
                  border: `1px solid ${on ? "#0057fc" : w(0.14)}`,
                  transition: "background 140ms, border-color 140ms",
                }}
              >
                {on ? <CheckIcon size={9} stroke="#fff" /> : null}
              </span>
              {o.dot ? (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    flex: "none",
                    borderRadius: "50%",
                    background: o.dot,
                  }}
                />
              ) : null}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {o.label}
              </span>
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  color: t(0.35),
                }}
              >
                {o.count}
              </span>
            </Hov>
          );
        })}
      </Popover>
    </div>
  );
}
