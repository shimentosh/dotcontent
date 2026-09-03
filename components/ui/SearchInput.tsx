"use client";

import { useState, type CSSProperties } from "react";

import { font, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { CloseIcon, SearchIcon } from "@/components/ui/Icons";

/**
 * The recessed search well: glyph, field, a clear button once there is
 * something to clear, and an optional key hint in its place.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label,
  hint,
  width,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the field. */
  label?: string;
  /** Keyboard hint shown while the field is empty, e.g. "/" or "⌘K". */
  hint?: string;
  width?: number | string;
  style?: CSSProperties;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 32,
        padding: "0 10px 0 11px",
        width,
        flex: width ? "none" : 1,
        minWidth: 0,
        borderRadius: 9,
        background: "rgba(0,0,0,0.28)",
        border: `1px solid ${focused ? "rgba(0,87,252,0.5)" : w(0.08)}`,
        boxShadow: focused ? "0 0 0 3px rgba(0,87,252,0.12)" : "none",
        transition: `border-color 180ms ${spring}, box-shadow 180ms ${spring}`,
        ...style,
      }}
    >
      <SearchIcon size={13} stroke={t(0.4)} style={{ flex: "none" }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#f0f0f4",
          fontSize: 12.5,
        }}
      />
      {value ? (
        <Hov
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{
            width: 20,
            height: 20,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 6,
            cursor: "pointer",
            color: t(0.45),
          }}
          hover={{ background: w(0.1), color: "#f0f0f4" }}
        >
          <CloseIcon size={10} stroke="currentColor" />
        </Hov>
      ) : hint ? (
        <span
          style={{
            flex: "none",
            fontFamily: font.mono,
            fontSize: 10,
            color: t(0.32),
            border: `1px solid ${w(0.12)}`,
            borderRadius: 5,
            padding: "1px 5px",
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}
