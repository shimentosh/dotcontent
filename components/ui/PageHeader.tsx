"use client";

import type { ReactNode } from "react";

import { font, rise, t } from "@/lib/theme";

/** The shell every routed page sits in: one width, one padding, one rhythm. */
export function Page({
  children,
  width = 1180,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      style={{
        ...rise(240),
        maxWidth: width,
        margin: "0 auto",
        padding: "34px 30px 60px",
      }}
    >
      {children}
    </div>
  );
}

/** Title, one line on what the screen is for, and the page-level actions. */
export function PageHeader({
  title,
  blurb,
  actions,
  icon,
}: {
  title: string;
  blurb?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
        marginBottom: 20,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {icon}
          <h1
            style={{
              fontFamily: font.tight,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              margin: 0,
            }}
          >
            {title}
          </h1>
        </div>
        {blurb ? (
          <p style={{ margin: "5px 0 0", fontSize: 13.5, color: t(0.48) }}>
            {blurb}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** The strip under a page header: filters left, counts and view controls right. */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 18,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}
