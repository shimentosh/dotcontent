"use client";

import type { CSSProperties, ReactNode } from "react";

import { font, panel, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";
import { FindGlyph } from "@/components/ui/DocIcons";

/**
 * The narrow column of things you can switch between, beside what you are
 * looking at.
 *
 * Written out three times before it was worth extracting — the reader's topics
 * rail, the copy of it on an unwritten topic, and the series rail on Content —
 * and the three had already started to differ in padding and in what a match
 * of nothing says. One rail, three callers.
 *
 * It is not a `ListPanel`: a list is the content of a screen, a rail is how you
 * get between screens' worth of it. A row is a name and a number and nothing
 * else — one line by default, two when `wrap` is on and the names are long.
 */

export type RailItem = {
  id: string;
  label: string;
  /** The number on the right — usually how much is in it. */
  count?: ReactNode;
  /** Carries the row's state through its colour. */
  icon?: ReactNode;
  /** Where the row goes, when it goes somewhere — makes it a real link. */
  href?: string;
};

export function Rail({
  label,
  items,
  activeId,
  onPick,
  filter,
  onFilter,
  filterLabel,
  count,
  wrap = false,
  empty = "No match.",
  style,
}: {
  /** The kicker at the top: TOPICS, SERIES. */
  label: string;
  items: readonly RailItem[];
  activeId?: string;
  onPick?: (id: string) => void;
  /** Pass both to get the filter well; omit both to leave it out. */
  filter?: string;
  onFilter?: (value: string) => void;
  /** The filter box's accessible name — it has no visible label. */
  filterLabel?: string;
  /** The header's right-hand number. Defaults to how many rows there are. */
  count?: ReactNode;
  /**
   * Let a long name take a second line instead of ending in an ellipsis.
   *
   * For a rail of twenty topics, one line each is what makes it scannable. For
   * a rail of six series called things like "Powerful websites you know", one
   * line each turns three different shelves into three identical rows.
   */
  wrap?: boolean;
  empty?: string;
  style?: CSSProperties;
}) {
  return (
    /*
      A named group, not a bare div.

      The rows are controls that only make sense together, and without a name
      on the group a screen reader reads seven unlabelled links in a row with
      nothing saying they are the series. It is also the one stable handle a
      test has for "the rail" as opposed to "some column".
    */
    <div
      role="group"
      aria-label={label}
      style={{ padding: 8, ...panel(16, false), ...style }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 6px 10px",
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            color: t(0.4),
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: font.mono,
            fontSize: 10,
            color: t(0.3),
          }}
        >
          {count ?? items.length}
        </span>
      </div>

      {onFilter ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 30,
            padding: "0 9px",
            borderRadius: 9,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${w(0.08)}`,
            marginBottom: 8,
          }}
        >
          <FindGlyph size={12} stroke={t(0.38)} />
          <input
            value={filter ?? ""}
            onChange={(e) => onFilter(e.target.value)}
            placeholder={filterLabel}
            aria-label={filterLabel}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f0f0f4",
              fontSize: 12,
            }}
          />
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <Hov
              key={item.id}
              href={item.href}
              onClick={onPick ? () => onPick(item.id) : undefined}
              aria-current={active ? "true" : undefined}
              style={{
                display: "flex",
                alignItems: wrap ? "flex-start" : "center",
                gap: 8,
                padding: "7px 8px",
                borderRadius: 9,
                cursor: "pointer",
                color: "inherit",
                textDecoration: "none",
                background: active ? w(0.09) : "transparent",
                borderLeft: `2px solid ${active ? "#0057fc" : "transparent"}`,
              }}
              hover={{ background: w(0.07) }}
            >
              <span
                style={{
                  flex: "none",
                  display: "flex",
                  // Level with the first line of a name that takes two.
                  paddingTop: wrap ? 2 : 0,
                }}
              >
                {item.icon}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  color: active ? "#f0f0f4" : t(0.66),
                  lineHeight: wrap ? 1.35 : undefined,
                  ...(wrap
                    ? { overflowWrap: "anywhere" as const }
                    : {
                        whiteSpace: "nowrap" as const,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }),
                }}
              >
                {item.label}
              </span>
              {item.count !== undefined ? (
                <span
                  style={{
                    flex: "none",
                    fontFamily: font.mono,
                    fontSize: 10,
                    color: t(0.3),
                    paddingTop: wrap ? 2 : 0,
                  }}
                >
                  {item.count}
                </span>
              ) : null}
            </Hov>
          );
        })}

        {items.length === 0 ? (
          <div style={{ padding: "10px 8px", fontSize: 12, color: t(0.35) }}>
            {empty}
          </div>
        ) : null}
      </div>
    </div>
  );
}
