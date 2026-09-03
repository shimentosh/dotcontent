"use client";

import type { RefObject } from "react";

import { RUN_INPUTS, placeholder } from "@/lib/run-inputs";
import { font, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

/**
 * The values a prompt can drop into itself, offered rather than documented.
 *
 * `{{part_number}}` worked long before anything said it did. A note under the
 * box saying "you can use {{part_number}}" would have been an improvement; a
 * row you click to put it where the cursor is skips the step where you retype
 * it slightly wrong and spend the afternoon working out why the model keeps
 * writing the braces out.
 *
 * Inserting through the textarea's own `setRangeText` rather than by rebuilding
 * the string: it keeps undo working and leaves the caret after what was
 * inserted, which is where you were about to type.
 */
export function PlaceholderChips({
  target,
  onInsert,
  note = "Click to insert. Each one is replaced when the run starts.",
}: {
  /** The box to insert into. */
  target: RefObject<HTMLTextAreaElement | null>;
  /** Told the box's new value, so React state keeps up with the DOM. */
  onInsert: (value: string) => void;
  note?: string;
}) {
  const insert = (key: string) => {
    const box = target.current;
    if (!box) return;

    const text = placeholder(key);
    box.focus();
    // Replaces the selection when there is one, which is what you expect if
    // you highlighted the old placeholder before clicking a different one.
    box.setRangeText(text, box.selectionStart, box.selectionEnd, "end");
    onInsert(box.value);
  };

  return (
    <div style={{ margin: "-8px 0 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {RUN_INPUTS.map((input) => (
          <Hov
            key={input.key}
            as="span"
            onClick={() => insert(input.key)}
            title={input.from}
            aria-label={`Insert ${input.label}`}
            style={{
              display: "flex",
              alignItems: "center",
              height: 24,
              padding: "0 9px",
              borderRadius: 7,
              fontFamily: font.mono,
              fontSize: 10.5,
              color: t(0.6),
              background: w(0.05),
              border: `1px solid ${w(0.08)}`,
              cursor: "pointer",
            }}
            hover={{ background: w(0.11), color: "#f0f0f4" }}
          >
            {placeholder(input.key)}
          </Hov>
        ))}
      </div>
      <div style={{ marginTop: 7, fontSize: 11, color: t(0.36) }}>{note}</div>
    </div>
  );
}
