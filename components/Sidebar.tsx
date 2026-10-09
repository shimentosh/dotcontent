"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { font, spring, t, w } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { useWiringState } from "@/lib/integrations-client";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Hov } from "@/components/ui/Hov";
import {
  ContentIcon,
  HomeIcon,
  IntegrationsIcon,
  Logo,
  PacksIcon,
  SettingsIcon,
  ToolsIcon,
} from "@/components/ui/Icons";

/** Which sidebar entry a given path belongs to. */
export function navKey(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/content")) return "content";
  // `/runs/<id>` belongs here too: a run is a template doing its work, and the
  // nav should not go blank while you watch one.
  if (
    pathname.startsWith("/pack") ||
    pathname.startsWith("/builder") ||
    pathname.startsWith("/runs")
  )
    return "templates";
  if (pathname.startsWith("/tools")) return "tools";
  if (pathname.startsWith("/integrations")) return "integrations";
  if (pathname.startsWith("/settings")) return "settings";
  return "";
}

function NavItem({
  icon,
  label,
  count,
  href,
  active,
}: {
  icon: ReactNode;
  label: string;
  count?: string;
  href: string;
  active: boolean;
}) {
  const { go } = useStore();
  return (
    <Hov
      onClick={() => go(href)}
      href={href}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        height: 38,
        padding: "0 11px",
        position: "relative",
        borderRadius: 11,
        cursor: "pointer",
        textDecoration: "none",
        fontSize: 13.5,
        fontWeight: active ? 590 : 500,
        transition: `background 220ms ${spring}, color 220ms ${spring}`,
        // The selected row is a raised glass chip, not a flat wash: top-lit
        // gradient, hairline, contact shadow.
        background: active
          ? `linear-gradient(180deg, ${w(0.16)}, ${w(0.085)})`
          : "transparent",
        border: `1px solid ${active ? w(0.1) : "transparent"}`,
        borderTopColor: active ? w(0.2) : "transparent",
        color: active ? "#fff" : t(0.62),
        boxShadow: active
          ? `inset 0 1px 0 ${w(0.16)}, 0 2px 10px rgba(0,0,0,0.3)`
          : "none",
      }}
      hover={{ background: w(0.07) }}
    >
      {/* The accent rail macOS puts against a selected sidebar row. */}
      {active ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: -1,
            top: "50%",
            width: 3,
            height: 17,
            marginTop: -8.5,
            borderRadius: 3,
            background: "linear-gradient(180deg,#6a9dff,#0057fc)",
            boxShadow: "0 0 10px rgba(0,87,252,0.85)",
          }}
        />
      ) : null}
      {icon}
      <span>{label}</span>
      {count ? (
        <span style={{ marginLeft: "auto", fontSize: 11, color: t(0.35) }}>
          {count}
        </span>
      ) : null}
    </Hov>
  );
}

/** A muted nav row for the pinned footer. */
function FootItem({
  icon,
  label,
  href,
  active,
  badge,
}: {
  icon: ReactNode;
  label: string;
  href: string;
  active: boolean;
  badge?: string;
}) {
  const { go } = useStore();
  return (
    <Hov
      onClick={() => go(href)}
      href={href}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        height: 34,
        textDecoration: "none",
        padding: "0 11px",
        borderRadius: 10,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 590 : 500,
        transition: `background 220ms ${spring}, color 220ms ${spring}`,
        background: active ? w(0.09) : "transparent",
        color: active ? "#fff" : t(0.55),
      }}
      hover={{ background: w(0.06), color: t(0.85) }}
    >
      {icon}
      <span>{label}</span>
      {badge ? (
        <span
          style={{
            marginLeft: "auto",
            fontFamily: font.mono,
            fontSize: 9.5,
            padding: "1px 6px",
            borderRadius: 20,
            background: w(0.07),
            color: t(0.45),
          }}
        >
          {badge}
        </span>
      ) : null}
    </Hov>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const key = navKey(pathname);
  // The badges are counts of what is actually there. They were fixed numbers
  // from the design, and a nav that says 214 next to an empty list is the one
  // place a person checks before believing anything else on the screen.
  const { topicCount, packs } = useStore();
  /*
   * The Integrations badge counts what actually answered a probe.
   *
   * It used to count a set of ids someone could toggle, which meant the badge
   * said 9 on a machine with none of them installed — and said it again after
   * a reload, because the set was seeded from a constant.
   */
  const { wiring } = useWiringState();
  const reachable = wiring
    ? wiring.brains.filter((b) => b.available).length +
      wiring.tools.filter((x) => x.present).length
    : 0;

  return (
    <aside
      style={{
        position: "relative",
        zIndex: 2,
        width: 248,
        flex: "0 0 248px",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "14px 12px",
        // The macOS sidebar material: thinner and more transparent than the
        // content panels so the aurora reads through it, with saturation
        // pushed hard to pick that colour up.
        background: `linear-gradient(180deg, ${w(0.062)}, ${w(0.028)})`,
        backdropFilter: "blur(48px) saturate(165%)",
        WebkitBackdropFilter: "blur(48px) saturate(165%)",
        borderRight: `1px solid ${w(0.07)}`,
        boxShadow: `inset -1px 0 0 ${w(0.03)}, 1px 0 34px rgba(0,0,0,0.3)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px 12px",
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(150deg,#0057fc,#00348f)",
            boxShadow: `0 4px 14px rgba(0,87,252,0.45), inset 0 1px 0 ${w(0.35)}`,
          }}
        >
          <Logo size={14} stroke="#fff" />
        </div>
        <div
          style={{
            fontFamily: font.tight,
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "-0.02em",
          }}
        >
          dotcontent
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontFamily: font.mono,
            fontSize: 9,
            letterSpacing: "0.1em",
            color: t(0.4),
            border: `1px solid ${w(0.12)}`,
            borderRadius: 5,
            padding: "2px 5px",
          }}
        >
          2.4
        </div>
      </div>

      <ProjectSwitcher />

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <NavItem
          icon={<HomeIcon />}
          label="Home"
          href="/"
          active={key === "home"}
        />
        <NavItem
          icon={<ContentIcon />}
          label="Content"
          count={String(topicCount)}
          href="/content"
          active={key === "content"}
        />
        <NavItem
          icon={<PacksIcon />}
          label="Templates"
          count={String(packs.length)}
          href="/packs"
          active={key === "templates"}
        />
        <NavItem
          icon={<ToolsIcon />}
          label="Tools"
          count="1"
          href="/tools"
          active={key === "tools"}
        />
      </nav>

      {/*
        Integrations and Settings are chores, not places you work. They sit in
        a pinned footer so the working nav above stays short, and so they land
        where the eye already goes for account-level things.
      */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `1px solid ${w(0.06)}`,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <FootItem
          icon={<IntegrationsIcon size={15} />}
          label="Integrations"
          href="/integrations"
          active={key === "integrations"}
          badge={reachable ? String(reachable) : undefined}
        />
        <FootItem
          icon={<SettingsIcon size={15} />}
          label="Settings"
          href="/settings"
          active={key === "settings"}
        />
      </div>

    </aside>
  );
}
