"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { font, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { Popover } from "@/components/ui/Popover";
import { CheckIcon, ChevronDown } from "@/components/ui/Icons";

export type SelectOption = {
  value: string;
  label: string;
  /** Options carrying the same group are listed under one heading. */
  group?: string;
  /** Secondary text on the right of the row. */
  hint?: string;
};

type Size = "sm" | "md";

const HEIGHT: Record<Size, number> = { sm: 32, md: 38 };

/**
 * A select that looks like the rest of the app.
 *
 * A native `<select>` draws its list with the operating system, which lands a
 * white Windows menu in the middle of a dark glass UI — so the list here is
 * ours: the same frosted panel every other menu uses, portalled out so no
 * parent can clip it.
 *
 * It keeps the keyboard behaviour the native control has: arrows move,
 * Enter picks, Escape closes, Home/End jump.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  size = "md",
  disabled = false,
  label,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: Size;
  disabled?: boolean;
  /** Accessible name, since the control is not a native <select>. */
  label?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const marker = useMemo(
    () => `select-${label ? label.toLowerCase().replace(/\W+/g, "-") : "menu"}`,
    [label],
  );

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;

  const selected = options.find((o) => o.value === value);

  // The panel is portalled to <body>, so it is matched by its marker rather
  // than by containment in the trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const inside =
        Boolean(target.closest(`[data-menu="${marker}"]`)) ||
        Boolean(ref.current?.contains(target));
      if (!inside) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [marker, open]);

  const openAt = (index: number) => {
    if (disabled) return;
    setActive(Math.max(0, index));
    setOpen(true);
  };

  const pick = (option: SelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    const at = options.findIndex((o) => o.value === value);

    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      openAt(at === -1 ? 0 : at);
      return;
    }
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      // Stop it here: inside a modal, the first Escape should shut the list,
      // not the dialog around it.
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const option = options[active];
      if (option) pick(option);
    }
  };

  // Precomputed rather than tracked while rendering: a variable mutated inside
  // the map would carry across renders.
  const rows = useMemo(
    () =>
      options.map((option, i) => ({
        option,
        head: Boolean(option.group) && option.group !== options[i - 1]?.group,
      })),
    [options],
  );

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <Hov
        onClick={() =>
          open
            ? setOpen(false)
            : openAt(options.findIndex((o) => o.value === value))
        }
        onKeyDown={onKeyDown}
        role="combobox"
        // Hov only supplies a tabIndex when it assigns the role itself, and
        // this one brings its own — without this the control cannot be reached
        // from the keyboard at all.
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={label}
        aria-disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: HEIGHT[size],
          padding: "0 10px 0 12px",
          borderRadius: size === "sm" ? 9 : 11,
          fontSize: size === "sm" ? 12 : 13,
          textAlign: "left",
          color: selected ? "#f0f0f4" : t(0.42),
          background: "rgba(0,0,0,0.3)",
          border: `1px solid ${open ? "rgba(0,87,252,0.55)" : w(0.1)}`,
          boxShadow: open ? "0 0 0 3px rgba(0,87,252,0.13)" : "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: `border-color 180ms ${spring}, box-shadow 180ms ${spring}, background 180ms ${spring}`,
        }}
        hover={disabled ? undefined : { borderColor: w(0.2) }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={11}
          stroke={t(0.45)}
          style={{
            flex: "none",
            transform: open ? "rotate(180deg)" : "none",
            transition: `transform 180ms ${spring}`,
          }}
        />
      </Hov>

      <Popover
        anchorRef={ref}
        open={open}
        width="anchor"
        offset={6}
        role="listbox"
        id={listId}
        aria-label={label}
        data-menu={marker}
      >
        {rows.map(({ option, head }, i) => {
          const on = option.value === value;
          const highlighted = i === active;

          return (
            <div key={option.value}>
              {head ? (
                <div
                  style={{
                    padding: "8px 9px 5px",
                    fontFamily: font.mono,
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    color: t(0.36),
                  }}
                >
                  {option.group}
                </div>
              ) : null}
              <Hov
                role="option"
                id={optionId(i)}
                aria-selected={on}
                onClick={() => pick(option)}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "7px 9px",
                  borderRadius: 9,
                  fontSize: 12.5,
                  cursor: "pointer",
                  color: on ? "#f0f0f4" : t(0.8),
                  background: highlighted ? w(0.09) : "transparent",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {option.label}
                </span>
                {option.hint ? (
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 10,
                      color: t(0.35),
                    }}
                  >
                    {option.hint}
                  </span>
                ) : null}
                <span
                  style={{
                    width: 12,
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {on ? <CheckIcon size={10} stroke="#6a9dff" /> : null}
                </span>
              </Hov>
            </div>
          );
        })}
      </Popover>
    </div>
  );
}
