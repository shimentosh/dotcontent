"use client";

import { useMemo, useState } from "react";

import { SECTION_TYPE_GROUPS } from "@/lib/data";
import { useStore } from "@/lib/store";
import { font, layer, primary, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { TextInput } from "@/components/ui/Field";
import { PlusIcon, SearchIcon } from "@/components/ui/Icons";

export function AddSectionSheet() {
  const {
    addSectionOpen,
    addSectionTarget,
    addSectionPackId,
    closeAddSection,
    addDraftSection,
    addPackSection,
  } =
    useStore();

  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");

  /*
   * Searches the description as well as the name.
   *
   * The box asks "what do you want to produce?", so typing "opening line"
   * should find Hook — and it only can if what a type MAKES is searchable,
   * not just what it happens to be called.
   */
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

  if (!addSectionOpen) return null;

  /*
   * One sheet, two places to put the section.
   *
   * The builder is editing an unsaved draft, so it appends locally. The pack
   * screen is looking at a saved pack, so it appends and writes through. This
   * used to close without doing either from the pack screen, which made Add a
   * Section a button that opened a menu and then forgot what you chose.
   */
  const pick = (name: string, type: string) => {
    setQuery("");
    setCustom("");
    if (addSectionTarget === "draft") addDraftSection(name, type);
    else if (addSectionPackId) addPackSection(addSectionPackId, name, type);
    closeAddSection();
  };

  return (
    <Hov
      interactive={false}
      onClick={closeAddSection}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: layer.sheet,
        background: "rgba(4,4,8,0.55)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "grid",
        placeItems: "center",
        padding: 30,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add section"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "78vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 22,
          background: "rgba(26,26,32,0.74)",
          backdropFilter: "blur(50px) saturate(155%)",
          WebkitBackdropFilter: "blur(50px) saturate(155%)",
          border: `1px solid ${w(0.13)}`,
          boxShadow: `0 40px 90px rgba(0,0,0,0.6), inset 0 1px 0 ${w(0.12)}`,
          overflow: "hidden",
          animation: "os-pop 180ms ease-out",
        }}
      >
        <div
          style={{ padding: "16px 20px", borderBottom: `1px solid ${w(0.09)}` }}
        >
          <div
            style={{
              fontFamily: font.tight,
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Add a section
          </div>
          {/* The type is a label on the row. What the section actually does is
              the prompt you write for it next — worth saying here, because the
              old list of nineteen implied the choice was doing more. */}
          <div
            style={{
              margin: "3px 0 11px",
              fontSize: 12,
              color: t(0.45),
              textWrap: "pretty",
            }}
          >
            Pick what it produces. You write its prompt next — that is the part
            that does the work.
          </div>
          <div style={{ position: "relative" }}>
            <SearchIcon
              size={13}
              stroke={t(0.4)}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            />
            <TextInput
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you want to produce?"
              style={{ height: 34, paddingLeft: 32 }}
            />
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "12px 14px 16px" }}>
          {groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                  color: t(0.36),
                  padding: "0 6px 8px",
                }}
              >
                {g.name}
              </div>
              {/*
                Rows, not a wall of pills.

                Nineteen pills fitted on one screen and told you nothing; nine
                rows do not fit as neatly and tell you what each one hands
                back, which is the only question being asked here.
              */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {g.items.map((item) => (
                  <Hov
                    as="span"
                    key={item.name}
                    onClick={() => pick(item.name, item.name)}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: "1px solid transparent",
                    }}
                    hover={{
                      background: "rgba(0,87,252,0.14)",
                      borderColor: "rgba(0,87,252,0.36)",
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        minWidth: 82,
                        fontSize: 12.5,
                        fontWeight: 650,
                      }}
                    >
                      {item.name}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        color: t(0.46),
                        lineHeight: 1.45,
                        textWrap: "pretty",
                      }}
                    >
                      {item.makes}
                    </span>
                  </Hov>
                ))}
              </div>
            </div>
          ))}

          {groups.length === 0 ? (
            <div
              style={{
                padding: "8px 6px 14px",
                fontSize: 12.5,
                color: t(0.42),
              }}
            >
              Nothing here produces “{query.trim()}” — describe it below and it
              becomes a section of its own.
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 10,
              borderRadius: 12,
              border: "1px dashed rgba(0,87,252,0.4)",
              background: "rgba(0,87,252,0.08)",
            }}
          >
            <TextInput
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  pick(custom.trim(), "Custom Text");
                }
              }}
              placeholder="Describe something custom — “Reply to every comment”"
              style={{ height: 34 }}
            />
            <Hov
              onClick={() => custom.trim() && pick(custom.trim(), "Custom Text")}
              style={{
                flex: "none",
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 13px",
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 600,
                opacity: custom.trim() ? 1 : 0.45,
                ...primary,
              }}
            >
              <PlusIcon size={12} stroke="#fff" />
              Add
            </Hov>
          </div>
        </div>
      </div>
    </Hov>
  );
}
