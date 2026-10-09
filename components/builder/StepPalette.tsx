"use client";

import { useMemo, useState, type ReactNode } from "react";

import { SECTION_TYPE_GROUPS } from "@/lib/data";
import { font, primary, spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { TextInput } from "@/components/ui/Field";
import {
  CaptionIcon,
  CtaIcon,
  HookIcon,
  PlanIcon,
  PlusIcon,
  ReplyIcon,
  ResearchIcon,
  ScriptIcon,
  SearchIcon,
  TitleIcon,
  ToolsIcon,
} from "@/components/ui/Icons";
import { DocGlyph, HashGlyph, SocialGlyph, SpeechGlyph } from "@/components/ui/DocIcons";

/** What you drag out of the palette, as the canvas reads it. */
export const STEP_DRAG = "application/x-dotcontent-step";

/**
 * A glyph and a colour per kind of step.
 *
 * Colour is doing real work here rather than decoration: the flow is a column
 * of near-identical cards, and the tile is the only thing that says at a
 * glance whether step 7 is a script or a piece of research. The palette and
 * the canvas take their tile from the same table, so a step looks the same
 * where you picked it up as where you put it down.
 */
const LOOK: Record<string, { icon: ReactNode; bg: string; fg: string }> = {
  Script: { icon: <ScriptIcon size={14} stroke="currentColor" />, bg: "rgba(0,87,252,0.16)", fg: "#6a9dff" },
  Hook: { icon: <HookIcon size={14} stroke="currentColor" />, bg: "rgba(201,154,63,0.16)", fg: "#d3a54f" },
  Caption: { icon: <CaptionIcon size={14} stroke="currentColor" />, bg: "rgba(75,176,122,0.16)", fg: "#4bb07a" },
  Title: { icon: <TitleIcon size={14} stroke="currentColor" />, bg: "rgba(154,109,215,0.18)", fg: "#a97fe0" },
  Description: { icon: <CaptionIcon size={14} stroke="currentColor" />, bg: "rgba(90,164,196,0.18)", fg: "#6fb3cf" },
  CTA: { icon: <CtaIcon size={14} stroke="currentColor" />, bg: "rgba(209,101,107,0.16)", fg: "#d1656b" },
  Research: { icon: <ResearchIcon size={14} stroke="currentColor" />, bg: "rgba(96,182,168,0.18)", fg: "#63bdad" },
  Plan: { icon: <PlanIcon size={14} stroke="currentColor" />, bg: "rgba(126,136,158,0.2)", fg: "#9aa6bd" },
  Hashtags: { icon: <HashGlyph size={14} stroke="currentColor" />, bg: "rgba(129,140,224,0.18)", fg: "#8f9ae8" },
  Article: { icon: <DocGlyph size={14} stroke="currentColor" />, bg: "rgba(0,87,252,0.12)", fg: "#8ab4ff" },
  "Social post": { icon: <SocialGlyph size={14} stroke="currentColor" />, bg: "rgba(214,120,168,0.16)", fg: "#de8ab6" },
  Email: { icon: <SpeechGlyph size={14} stroke="currentColor" />, bg: "rgba(110,190,220,0.16)", fg: "#7cc4de" },
  "First comment": { icon: <ReplyIcon size={14} stroke="currentColor" />, bg: "rgba(160,190,90,0.16)", fg: "#a9c46a" },
};

const FALLBACK = {
  icon: <ToolsIcon size={14} stroke="currentColor" />,
  bg: w(0.07),
  fg: t(0.6),
};

export const lookOf = (name: string) => LOOK[name] ?? FALLBACK;

/** The tinted square a step wears, in the palette and on the canvas. */
export function StepTile({ name, size = 28 }: { name: string; size?: number }) {
  const look = lookOf(name);
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: size / 3,
        background: look.bg,
        color: look.fg,
      }}
    >
      {look.icon}
    </span>
  );
}

/**
 * The steps you can add, always on screen.
 *
 * It used to be a centred modal you opened, searched, and dismissed — the flow
 * you were building vanished behind it at the moment you were deciding what
 * should come next in it. A builder keeps its parts on the bench: the canvas
 * on the left, everything you can put on it on the right, and no step between
 * wanting a thing and dragging it where it goes.
 */
export function StepPalette({
  onAdd,
}: {
  /** Click-to-add, which lands at the end. Dragging chooses the place. */
  onAdd: (name: string, type: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");

  /*
   * Searches the description as well as the name: the box asks what you want
   * to produce, so "opening line" has to find Hook.
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

  const addCustom = () => {
    const name = custom.trim();
    if (!name) return;
    onAdd(name, "Custom");
    setCustom("");
  };

  return (
    <aside
      aria-label="Steps"
      style={{
        position: "sticky",
        top: 12,
        alignSelf: "start",
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100vh - 120px)",
        borderRadius: 15,
        overflow: "hidden",
        background: w(0.04),
        border: `1px solid ${w(0.09)}`,
      }}
    >
      <div style={{ padding: "13px 13px 11px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
          Steps
        </div>
        <div style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.5, color: t(0.42) }}>
          Drag one onto the flow, or click to add it at the end.
        </div>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
            padding: "0 10px",
            height: 32,
            borderRadius: 9,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${w(0.09)}`,
          }}
        >
          <SearchIcon size={12} stroke={t(0.38)} />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search steps"
            style={{
              height: 30,
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 12.5,
            }}
          />
        </span>
      </div>

      <div style={{ overflowY: "auto", padding: "0 8px 6px" }}>
        {groups.map((group) => (
          <div key={group.name}>
            <div
              style={{
                padding: "9px 5px 6px",
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: "0.14em",
                color: t(0.3),
              }}
            >
              {group.name}
            </div>

            {group.items.map((item) => (
              <Hov
                key={item.name}
                draggable
                onDragStart={(e) => {
                  const payload = JSON.stringify({
                    name: item.name,
                    type: item.name,
                  });
                  // Two types: our own, which the canvas listens for, and
                  // plain text so a drop anywhere else is harmless rather
                  // than mysterious.
                  e.dataTransfer.setData(STEP_DRAG, payload);
                  e.dataTransfer.setData("text/plain", item.name);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(item.name, item.name)}
                title={item.makes}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 7px",
                  borderRadius: 10,
                  cursor: "grab",
                  transition: `background 140ms ${spring}`,
                }}
                hover={{ background: w(0.07) }}
                active={{ cursor: "grabbing" }}
              >
                <StepTile name={item.name} />
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {item.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: t(0.4),
                      lineHeight: 1.4,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.makes}
                  </div>
                </span>
              </Hov>
            ))}
          </div>
        ))}

        {groups.length === 0 ? (
          <div style={{ padding: "10px 6px", fontSize: 11.5, color: t(0.4) }}>
            Nothing matches. Name it yourself below — a step is a name and a
            prompt, and the name can be anything.
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          gap: 7,
          padding: 10,
          borderTop: `1px solid ${w(0.08)}`,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <TextInput
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustom();
          }}
          placeholder="Your own step"
          style={{ height: 32, fontSize: 12 }}
        />
        <Hov
          onClick={addCustom}
          aria-label="Add your own step"
          style={{
            display: "grid",
            placeItems: "center",
            width: 32,
            height: 32,
            flex: "none",
            borderRadius: 9,
            ...primary,
            opacity: custom.trim() ? 1 : 0.4,
            cursor: custom.trim() ? "pointer" : "default",
          }}
        >
          <PlusIcon size={13} stroke="#fff" strokeWidth={2.4} />
        </Hov>
      </div>
    </aside>
  );
}
