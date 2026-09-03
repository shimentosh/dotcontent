"use client";

import { useMemo, useState } from "react";

import { SECTION_TYPE_GROUPS } from "@/lib/data";
import { font, primary, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { TextInput } from "@/components/ui/Field";
import { PlusIcon, SearchIcon } from "@/components/ui/Icons";

/**
 * Choosing what the next step produces, in the flow rather than over it.
 *
 * This was a centred modal: the flow you were building disappeared behind a
 * dimmed backdrop at the exact moment you were deciding what should come next
 * in it, and the new step always landed at the end no matter where you had
 * been looking. Opening it here — at the point in the chain you pressed — keeps
 * the steps either side of the gap on screen, which is the context the choice
 * is made in.
 *
 * Searches what a type MAKES as well as what it is called: the box asks what
 * you want to produce, so "opening line" has to find Hook.
 */
export function StepPicker({
  onPick,
  onCancel,
}: {
  onPick: (name: string, type: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTION_TYPE_GROUPS;
    return SECTION_TYPE_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) || i.makes.toLowerCase().includes(q),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const addCustom = () => {
    const name = custom.trim();
    if (name) onPick(name, "Custom");
  };

  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        background: w(0.05),
        border: `1px solid ${w(0.14)}`,
        boxShadow: `0 18px 40px rgba(0,0,0,0.35)`,
        animation: `os-pop 180ms ${spring} both`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 12px",
          borderBottom: `1px solid ${w(0.08)}`,
        }}
      >
        <SearchIcon size={13} stroke={t(0.4)} />
        <TextInput
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") {
              const first = groups[0]?.items[0];
              if (first) onPick(first.name, first.name);
            }
          }}
          placeholder="What do you want this step to produce?"
          style={{
            height: 30,
            background: "transparent",
            border: "none",
            padding: 0,
          }}
        />
        <Hov
          onClick={onCancel}
          aria-label="Cancel"
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: t(0.45),
            padding: "4px 8px",
            borderRadius: 8,
            cursor: "pointer",
          }}
          hover={{ background: w(0.08), color: "#f0f0f4" }}
        >
          Cancel
        </Hov>
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto", padding: "6px 0 2px" }}>
        {groups.map((group) => (
          <div key={group.name}>
            <div
              style={{
                padding: "8px 13px 5px",
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: "0.14em",
                color: t(0.32),
              }}
            >
              {group.name}
            </div>
            {group.items.map((item) => (
              <Hov
                key={item.name}
                onClick={() => onPick(item.name, item.name)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "104px 1fr",
                  gap: 10,
                  alignItems: "baseline",
                  padding: "8px 13px",
                  cursor: "pointer",
                  borderLeft: "2px solid transparent",
                }}
                hover={{ background: w(0.06), borderLeftColor: "#0057fc" }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {item.name}
                </span>
                <span style={{ fontSize: 12, color: t(0.45) }}>
                  {item.makes}
                </span>
              </Hov>
            ))}
          </div>
        ))}

        {groups.length === 0 ? (
          <div style={{ padding: "14px 13px", fontSize: 12.5, color: t(0.42) }}>
            Nothing matches “{query.trim()}”. Describe it below instead — a
            step is a name and a prompt, and the name can be anything.
          </div>
        ) : null}
      </div>

      {/* Anything the list does not cover. A step is a name and a prompt, so
          there is no reason the name has to come from a list. */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 10,
          borderTop: `1px solid ${w(0.08)}`,
          background: "rgba(0,0,0,0.18)",
        }}
      >
        <TextInput
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustom();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Or describe it — “Reply to every comment”"
        />
        <Hov
          onClick={addCustom}
          aria-disabled={!custom.trim()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 34,
            padding: "0 13px",
            borderRadius: 10,
            fontSize: 12.5,
            fontWeight: 600,
            flex: "none",
            ...primary,
            opacity: custom.trim() ? 1 : 0.4,
            cursor: custom.trim() ? "pointer" : "default",
          }}
        >
          <PlusIcon size={12} stroke="#fff" />
          Add
        </Hov>
      </div>
    </div>
  );
}
