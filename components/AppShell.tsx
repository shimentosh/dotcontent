"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { useStore } from "@/lib/store";
import { ApiDownBanner } from "@/components/ApiDownBanner";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { AddSectionSheet } from "@/components/overlays/AddSectionSheet";
import { CommandPalette } from "@/components/overlays/CommandPalette";
import { ConfirmDialog } from "@/components/overlays/ConfirmDialog";
import { ProjectSheet } from "@/components/overlays/ProjectSheet";
import { RunSetupSheet } from "@/components/overlays/RunSetupSheet";

/** Pages that render without the console around them. */
const BARE = ["/login", "/signup"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { settings } = useStore();

  /*
   * Reduced motion, applied to the document.
   *
   * On <html> rather than as inline styles: the aurora's drift lives in a
   * stylesheet keyframe, and there is no inline style that can reach into a
   * class-driven animation on four sibling elements.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (settings?.reduceMotion) root.setAttribute("data-reduce-motion", "on");
    else root.removeAttribute("data-reduce-motion");
  }, [settings?.reduceMotion]);

  /*
   * No sidebar on the way in.
   *
   * The workspace switcher, the nav counts and the command palette all read
   * data that needs a session, so on the sign-in page they would render empty
   * and then 401 in the background. The aurora stays: it is the app's face,
   * and the first screen is where that matters most.
   */
  if (BARE.includes(pathname)) {
    return (
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "#06060a",
          overflow: "hidden",
        }}
      >
        <div aria-hidden className="os-aurora">
          <span className="os-blob os-blob-a" />
          <span className="os-blob os-blob-b" />
          <span className="os-blob os-blob-c" />
          <span className="os-blob os-blob-d" />
        </div>
        <div aria-hidden className="os-grain" />
        <div style={{ position: "relative", zIndex: 2 }}>{children}</div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        background: "#06060a",
        overflow: "hidden",
      }}
    >
      {/*
        Glass reads as flat grey unless something saturated sits behind it to
        refract. The previous backdrop put every light source at the very top
        edge, so panels below the fold sat on bare #06060a and the blur had
        nothing to work with. These blobs spread down the full viewport and
        drift slowly, so content passes over live colour as it scrolls.
      */}
      <div aria-hidden className="os-aurora">
        <span className="os-blob os-blob-a" />
        <span className="os-blob os-blob-b" />
        <span className="os-blob os-blob-c" />
        <span className="os-blob os-blob-d" />
      </div>

      {/*
        Fine luminance noise. Real macOS materials are never perfectly smooth —
        a little grain stops the wide blurred gradients from banding, and is
        most of why this reads as "material" rather than "gradient".
      */}
      <div aria-hidden className="os-grain" />

      <Sidebar />

      <main
        style={{
          position: "relative",
          zIndex: 2,
          flex: 1,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <ApiDownBanner />
        <Header />
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          {children}
        </div>
      </main>

      <RunSetupSheet />
      <AddSectionSheet />
      <ProjectSheet />
      <CommandPalette />
      <ConfirmDialog />
    </div>
  );
}
