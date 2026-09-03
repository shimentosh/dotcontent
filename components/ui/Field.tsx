"use client";

import {
  useState,
  type CSSProperties,
  type Ref,
  type ReactNode,
  type TextareaHTMLAttributes,
  type InputHTMLAttributes,
} from "react";

import { font, t, w } from "@/lib/theme";

const base: CSSProperties = {
  width: "100%",
  color: "#f0f0f4",
  background: "rgba(0,0,0,0.3)",
  /*
   * Longhands, not the `border` shorthand — the same trap `Hov`'s
   * `expandBorder` exists to work around, in the one component that hand-rolls
   * its own focus styles instead of going through it.
   *
   * `focused` below sets `borderColor`. React writes inline styles one key at a
   * time, so on blur it REMOVES `borderColor` and leaves the shorthand's
   * declaration behind with nothing to colour it — the border falls back to
   * `currentColor` and every input in the app flashes white text-colour once
   * you have touched it. Keeping the longhand present in every render leaves
   * React a value to update rather than a key to delete.
   */
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: w(0.1),
  borderRadius: 11,
  outline: "none",
  transition: "border-color 150ms, box-shadow 150ms, background 150ms",
};

const focused: CSSProperties = {
  background: "rgba(0,0,0,0.4)",
  borderColor: "rgba(0,87,252,0.55)",
  boxShadow: "0 0 0 3px rgba(0,87,252,0.13)",
};

/** Label, optional hint, and whatever control sits under them. */
export function Field({
  label,
  hint,
  counter,
  children,
}: {
  label: string;
  hint?: string;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        {hint ? (
          <span style={{ fontSize: 11.5, color: t(0.4) }}>{hint}</span>
        ) : null}
        {counter ? (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: font.mono,
              fontSize: 10,
              color: t(0.32),
            }}
          >
            {counter}
          </span>
        ) : null}
      </div>
      {children}
    </label>
  );
}

export function TextInput({
  style,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const [on, setOn] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => {
        setOn(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setOn(false);
        rest.onBlur?.(e);
      }}
      style={{
        ...base,
        height: 38,
        padding: "0 12px",
        fontSize: 13,
        ...(on ? focused : null),
        ...style,
      }}
    />
  );
}

/** The prompt boxes: monospace and resizable. */
/*
 * Takes a ref, because a caller now writes into the box rather than only
 * reading it back: the placeholder chips insert at the caret, and the caret
 * belongs to the element.
 */
export function TextArea({
  mono = true,
  style,
  boxRef,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
  boxRef?: Ref<HTMLTextAreaElement>;
}) {
  const [on, setOn] = useState(false);
  return (
    <textarea
      ref={boxRef}
      {...rest}
      onFocus={(e) => {
        setOn(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setOn(false);
        rest.onBlur?.(e);
      }}
      style={{
        ...base,
        padding: "11px 13px",
        fontFamily: mono ? font.mono : font.sans,
        fontSize: mono ? 12 : 13,
        lineHeight: 1.65,
        resize: "vertical",
        ...(on ? focused : null),
        ...style,
      }}
    />
  );
}
