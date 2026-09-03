"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { layer } from "@/lib/theme";

type Pos = { top: number; left: number; width: number };

/**
 * A menu anchored under `anchorRef`, rendered into <body>.
 *
 * The sidebar and header both set `backdrop-filter`, which makes each of them
 * a backdrop root: a menu nested inside one can only blur that bar's own
 * pixels, so page content shows through sharp. Portalling out restores the
 * frosted panel the design asks for, and puts the menu above the scrolling
 * content.
 *
 * It carries the menu surface itself — the frosted panel, the border, the drop
 * shadow, the pop animation. Seven callers were each declaring their own copy
 * of that, and they had already drifted: two different opacities, two blur
 * radii, two animations, one with no shadow. `style` still overrides, for the
 * one that genuinely differs.
 *
 * Pass `width="anchor"` to match the trigger's width.
 */

/**
 * The material a floating menu is made of.
 *
 * Thicker than the page's panels on purpose: a menu can open over anything,
 * including a dense table, and has to stay legible over all of it.
 */
const SURFACE: CSSProperties = {
  zIndex: layer.menu,
  padding: 6,
  borderRadius: 13,
  background:
    "linear-gradient(180deg, rgba(38,38,46,0.86), rgba(22,22,28,0.9))",
  backdropFilter: "blur(46px) saturate(165%)",
  WebkitBackdropFilter: "blur(46px) saturate(165%)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.1)",
  borderTopColor: "rgba(255,255,255,0.18)",
  boxShadow: "0 22px 50px rgba(0,0,0,0.6)",
  animation: "os-pop 160ms ease-out",
};
export function Popover({
  anchorRef,
  open,
  align = "left",
  width,
  offset = 7,
  style,
  children,
  ...rest
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  align?: "left" | "right";
  width: number | "anchor";
  offset?: number;
  style?: CSSProperties;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const [pos, setPos] = useState<Pos | null>(null);

  const measure = useCallback((): Pos | null => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    const r = anchor.getBoundingClientRect();
    const w = width === "anchor" ? r.width : width;
    return {
      top: r.bottom + offset,
      left: align === "left" ? r.left : r.right - w,
      width: w,
    };
  }, [align, anchorRef, offset, width]);

  // Measured as the panel mounts, so the first paint is already in place.
  const place = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) setPos(measure());
    },
    [measure],
  );

  useEffect(() => {
    if (!open) return;
    const track = () => setPos(measure());
    window.addEventListener("resize", track);
    // Capture, so a menu anchored inside the scrolling page body follows its
    // trigger rather than hanging in place.
    window.addEventListener("scroll", track, true);
    return () => {
      window.removeEventListener("resize", track);
      window.removeEventListener("scroll", track, true);
    };
  }, [open, measure]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...rest}
      ref={place}
      style={{
        ...SURFACE,
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: pos?.width ?? (width === "anchor" ? undefined : width),
        // Hidden, not unmounted, until the first measure lands: a menu that
        // paints at 0,0 and then jumps is worse than one that appears a frame
        // late.
        visibility: pos ? "visible" : "hidden",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
