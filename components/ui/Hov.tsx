"use client";

import {
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type MouseEvent,
} from "react";

/*
 * `button` is here for forms.
 *
 * Everywhere else a div with role="button" is enough, but a form only
 * submits on Enter if it contains a real submit button — so a sign-in page
 * built out of divs is one where the return key does nothing.
 */
type Tag =
  | "div"
  | "span"
  | "aside"
  | "header"
  | "main"
  | "p"
  | "section"
  | "a"
  | "button";

const BORDER_LONGHANDS = ["borderColor", "borderWidth", "borderStyle"] as const;

/**
 * React writes inline styles one key at a time. When a base style uses the
 * `border` shorthand and a hover style sets `borderColor`, leaving hover
 * clears `borderColor` without rewriting the shorthand — so the border falls
 * back to `currentColor` and every card lights up white once touched.
 *
 * Expanding the shorthand up front keeps the longhand present in every
 * render, leaving React with a value to update rather than a key to remove.
 */
function expandBorder(
  style: CSSProperties | undefined,
  overrides: (CSSProperties | undefined)[],
): CSSProperties | undefined {
  if (!style || typeof style.border !== "string") return style;

  const overridden = overrides.some(
    (o) => o && BORDER_LONGHANDS.some((k) => k in o),
  );
  if (!overridden) return style;

  const parts = /^\s*(\S+)\s+(\S+)\s+(.+?)\s*$/.exec(style.border);
  if (!parts) return style;

  const expanded: CSSProperties = { ...style };
  delete expanded.border;
  expanded.borderWidth = parts[1];
  expanded.borderStyle = parts[2];
  expanded.borderColor = parts[3];
  return expanded;
}

export interface HovProps extends HTMLAttributes<HTMLElement> {
  as?: Tag;
  /**
   * Where this goes, when it goes somewhere.
   *
   * Given an href the element renders as a real anchor: middle-click and
   * ⌘/Ctrl-click open a new tab, right-click offers "Open link in new tab",
   * and the browser shows the destination on hover. A plain left click is
   * still handled by `onClick`, so in-app navigation stays a client-side
   * push rather than a full page load.
   */
  href?: string;
  /** Styles merged in while the pointer is over the element. */
  hover?: CSSProperties;
  /** Styles merged in while the pointer is held down. */
  active?: CSSProperties;
  /**
   * Clickable elements get button semantics and keyboard activation. Set false
   * for things like modal backdrops that should not be reachable by tab.
   */
  interactive?: boolean;
  /** For `as="button"` — "submit" is the one that makes a form send. */
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}

/**
 * A plain element with hover and press styles applied inline.
 *
 * The design canvas expressed these as `style-hover` / `style-active`
 * attributes; inline React styles have no pseudo-classes, so they are tracked
 * as state here. Doing it this way keeps every declaration next to the element
 * it belongs to, exactly as the source design had it.
 */
export function Hov({
  as = "div",
  href,
  style,
  hover,
  active,
  interactive = true,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  onKeyDown,
  onClick,
  ...rest
}: HovProps) {
  const [isHover, setHover] = useState(false);
  const [isActive, setActive] = useState(false);
  const Tag = (href ? "a" : as) as ElementType;

  const clickable = Boolean(onClick) && interactive;
  const base = expandBorder(style, [hover, active]);

  /**
   * An anchor already announces itself as a link and is already focusable, so
   * it gets neither a button role nor a tabIndex — and the click only becomes
   * ours when the browser was not asked to do something else with it.
   */
  const onAnchorClick = (e: MouseEvent<HTMLElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    onClick?.(e);
  };

  return (
    <Tag
      {...rest}
      {...(href ? { href } : null)}
      {/* A real button is already a button, and already focusable. */
      ...(!href && as !== "button" && clickable && rest.role === undefined
        ? { role: "button", tabIndex: 0 }
        : null)}
      style={{
        ...base,
        ...(isHover ? hover : null),
        ...(isActive ? active : null),
      }}
      onClick={href ? onAnchorClick : onClick}
      onMouseEnter={(e: MouseEvent<HTMLElement>) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e: MouseEvent<HTMLElement>) => {
        setHover(false);
        setActive(false);
        onMouseLeave?.(e);
      }}
      onMouseDown={(e: MouseEvent<HTMLElement>) => {
        if (active) setActive(true);
        onMouseDown?.(e);
      }}
      onMouseUp={(e: MouseEvent<HTMLElement>) => {
        setActive(false);
        onMouseUp?.(e);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
