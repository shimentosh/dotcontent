import type { CSSProperties } from "react";

import type { Project } from "@/lib/data";
import { w } from "@/lib/theme";
import { WorkspacesIcon } from "@/components/ui/Icons";

/**
 * A workspace's mark, wherever one is drawn.
 *
 * It was a bare gradient square repeated in four files — the switcher, the home
 * hero, the workspaces list and the editor's own header. A coloured rectangle
 * with nothing in it does not read as a brand's mark; it reads as an image that
 * failed to load, and it left no obvious place for an actual picture to go.
 *
 * So: the photo when there is one, and the workspace glyph on the tint when
 * there is not. One component, so a photo uploaded in the editor shows up in
 * all four places at once rather than three of them.
 */
export function WorkspaceMark({
  project,
  size = 34,
  radius,
  style,
}: {
  project: Pick<Project, "name" | "tint" | "photo">;
  size?: number;
  /** Defaults to a corner that stays proportional as the mark scales. */
  radius?: number;
  style?: CSSProperties;
}) {
  const r = radius ?? Math.max(7, Math.round(size * 0.32));

  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: r,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        background: project.tint,
        boxShadow: `inset 0 1px 0 ${w(0.3)}`,
        ...style,
      }}
    >
      {project.photo ? (
        /* A plain <img>: the source is a data URL the editor already downscaled,
           so next/image has nothing to optimise and would only add a wrapper
           element inside a fixed-size square. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={project.photo}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <WorkspacesIcon
          size={Math.max(10, Math.round(size * 0.44))}
          stroke="rgba(255,255,255,0.92)"
        />
      )}
    </span>
  );
}
