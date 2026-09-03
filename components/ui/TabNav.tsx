"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useStore } from "@/lib/store";
import { spring, t, w } from "@/lib/theme";
import { Hov } from "@/components/ui/Hov";

/**
 * The tabs across the top of an area with more than one screen in it.
 *
 * Deliberately not `Segmented`, which is the pill track used for picking one
 * of several views of the SAME list. These are different pages, and a page
 * that showed both controls in the same shape would be asking you to work out
 * which row navigates and which one filters. Underlined text tabs read as
 * "sections of this place"; the pill track reads as "a setting on this list".
 *
 * Which one is on comes from the path rather than from state, so it is right
 * on the first paint after a reload, on a deep link, and after the back
 * button.
 */
export type Tab = {
  href: string;
  label: string;
  /**
   * A glyph before the label.
   *
   * Takes `currentColor`, so it fades with the label on an inactive tab and
   * lights with it on the active one — one thing changing state, not two.
   */
  icon?: ReactNode;
  /** A count or other note, shown quieter than the label. */
  meta?: ReactNode;
};

export function TabNav({ tabs }: { tabs: readonly Tab[] }) {
  const pathname = usePathname();
  const { go } = useStore();

  /*
   * The longest matching href wins.
   *
   * "/content" is a prefix of "/content/series", so a plain startsWith would
   * light both — and light Content while you are plainly on Manage series.
   */
  const activeHref = tabs
    .filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: 20,
        borderBottom: `1px solid ${w(0.07)}`,
      }}
    >
      {tabs.map((tab) => {
        const on = tab.href === activeHref;
        return (
          <Hov
            key={tab.href}
            role="tab"
            aria-selected={on}
            onClick={() => go(tab.href)}
            href={tab.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "0 12px 9px",
              // Sits ON the panel's border rather than above it, so the active
              // tab and the rule below it are one line.
              marginBottom: -1,
              borderBottom: `2px solid ${on ? "#0057fc" : "transparent"}`,
              color: on ? "#f0f0f4" : t(0.5),
              fontSize: 13,
              fontWeight: on ? 650 : 550,
              textDecoration: "none",
              cursor: "pointer",
              transition: `color 180ms ${spring}, border-color 180ms ${spring}`,
            }}
            hover={on ? undefined : { color: t(0.8) }}
          >
            {tab.icon}
            {tab.label}
            {tab.meta !== undefined ? (
              <span
                style={{
                  fontSize: 11,
                  color: t(on ? 0.45 : 0.3),
                  fontWeight: 500,
                }}
              >
                {tab.meta}
              </span>
            ) : null}
          </Hov>
        );
      })}
    </div>
  );
}
