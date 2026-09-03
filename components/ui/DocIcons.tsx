import type { CSSProperties, ReactNode } from "react";

/**
 * Glyphs for the document screens. Self-contained rather than added to
 * Icons.tsx, so these screens do not depend on that file's shape.
 */

type P = {
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  style?: CSSProperties;
};

function I({
  size = 16,
  stroke = "currentColor",
  strokeWidth = 1.7,
  style,
  children,
}: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* --- section kinds ------------------------------------------------------ */

export const GlobeGlyph = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
  </I>
);

export const ScanGlyph = (p: P) => (
  <I {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="12" r="3" />
  </I>
);

export const HashGlyph = (p: P) => (
  <I {...p}>
    <path d="M9 4 7.5 20M16.5 4 15 20M4 9h16M3.5 15h16" />
  </I>
);

export const ClapperGlyph = (p: P) => (
  <I {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="m3 11 18-1.5" />
    <path d="m7 7.4 1.6 3.3M12 7 13.6 10.3" />
  </I>
);

export const CardGlyph = (p: P) => (
  <I {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 10h6M7 14h4" />
  </I>
);

export const SocialGlyph = (p: P) => (
  <I {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="3.6" />
    <path d="M17 7h.01" />
  </I>
);

export const SeoGlyph = (p: P) => (
  <I {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="4" />
    <path d="m10 9.5 5 2.5-5 2.5Z" />
  </I>
);

export const CtaGlyph = (p: P) => (
  <I {...p}>
    <path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5L8 9H5a1 1 0 0 0-1 1Z" />
    <path d="M18 9.5a4 4 0 0 1 0 5" />
  </I>
);

export const TopicGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v3.4M12 17.6V21M3 12h3.4M17.6 12H21" />
    <path d="m6.2 6.2 2.4 2.4M15.4 15.4l2.4 2.4M17.8 6.2l-2.4 2.4M8.6 15.4l-2.4 2.4" />
  </I>
);

export const SpeechGlyph = (p: P) => (
  <I {...p}>
    <path d="M20 14a3 3 0 0 1-3 3H9l-4 3.5V6a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3Z" />
    <path d="M8.5 8h8M8.5 12h5" />
  </I>
);

/* --- chrome ------------------------------------------------------------- */

export const DocGlyph = (p: P) => (
  <I {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </I>
);

export const StackGlyph = (p: P) => (
  <I {...p}>
    <path d="M3 8l9-4.5L21 8l-9 4.5L3 8Z" />
    <path d="M3 12.5 12 17l9-4.5" />
    <path d="M3 16.5 12 21l9-4.5" />
  </I>
);

export const ListGlyph = (p: P) => (
  <I {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </I>
);

/** An open book — reading mode, and nothing else. */
export const ReadGlyph = (p: P) => (
  <I {...p}>
    <path d="M12 6.5C10.5 5.2 8.4 4.6 5.5 4.6A1.5 1.5 0 0 0 4 6.1v10.4a1.4 1.4 0 0 0 1.4 1.4c2.8 0 4.9.6 6.6 1.9" />
    <path d="M12 6.5c1.5-1.3 3.6-1.9 6.5-1.9A1.5 1.5 0 0 1 20 6.1v10.4a1.4 1.4 0 0 1-1.4 1.4c-2.8 0-4.9.6-6.6 1.9" />
    <path d="M12 6.5v13.3" />
  </I>
);

/** Two paths joining into one — merging a shelf into another. */
export const MergeGlyph = (p: P) => (
  <I {...p}>
    <path d="M7 4v3.2a4 4 0 0 0 1.7 3.3l6.6 4.5A4 4 0 0 1 17 18.3V20" />
    <path d="M17 4v3.2a4 4 0 0 1-1.7 3.3l-6.6 4.5A4 4 0 0 0 7 18.3V20" />
  </I>
);

export const CopyGlyph = (p: P) => (
  <I {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </I>
);

export const RedoGlyph = (p: P) => (
  <I {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </I>
);

export const RedoWithGlyph = (p: P) => (
  <I {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
    <path d="m14 7 3 3" />
  </I>
);

export const DownloadGlyph = (p: P) => (
  <I {...p}>
    <path d="M12 4v11" />
    <path d="m8 11 4 4 4-4" />
    <path d="M4 19h16" />
  </I>
);

export const BackGlyph = (p: P) => (
  <I strokeWidth={2} {...p}>
    <path d="M20 12H5" />
    <path d="m11 6-6 6 6 6" />
  </I>
);

export const CaretRight = (p: P) => (
  <I strokeWidth={2} {...p}>
    <path d="m9 6 6 6-6 6" />
  </I>
);

export const CaretDown = (p: P) => (
  <I strokeWidth={2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </I>
);

export const CheckGlyph = (p: P) => (
  <I strokeWidth={2.4} {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </I>
);

export const FindGlyph = (p: P) => (
  <I strokeWidth={2} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4.5-4.5" />
  </I>
);

export const WrenchGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <path d="M15.5 3.5a5.5 5.5 0 0 0-6.7 7L3.5 15.8a2 2 0 0 0 2.8 2.8l5.3-5.3a5.5 5.5 0 0 0 7-6.7l-3 3-2.6-2.6Z" />
  </I>
);

export const KeyGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9M17.5 12v3M20 12v2.5" />
  </I>
);

export const AbilityGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9Z" />
  </I>
);

export const BrainGlyph = (p: P) => (
  <I strokeWidth={1.7} {...p}>
    <path d="M12 5.2a3 3 0 0 0-5.7-.6A2.8 2.8 0 0 0 4 9.4a3 3 0 0 0 .6 4.8A2.9 2.9 0 0 0 7.5 19a2.8 2.8 0 0 0 4.5-.9Z" />
    <path d="M12 5.2a3 3 0 0 1 5.7-.6A2.8 2.8 0 0 1 20 9.4a3 3 0 0 1-.6 4.8A2.9 2.9 0 0 1 16.5 19a2.8 2.8 0 0 1-4.5-.9Z" />
    <path d="M12 5.2v13" />
  </I>
);

export const PlugGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <path d="M9 3v6M15 3v6" />
    <path d="M6.5 9h11v2.5a5.5 5.5 0 0 1-11 0Z" />
    <path d="M12 17v4" />
  </I>
);

export const ClockGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.4 2" />
  </I>
);

export const TagGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <path d="M11.6 3.2H4.8a1.6 1.6 0 0 0-1.6 1.6v6.8c0 .4.2.8.5 1.1l7.4 7.4a1.6 1.6 0 0 0 2.3 0l6.4-6.4a1.6 1.6 0 0 0 0-2.3l-7.4-7.4a1.6 1.6 0 0 0-1.1-.5Z" />
    <path d="M7.6 7.6h.01" />
  </I>
);

/* --- status and filters ------------------------------------------------- */

export const UsedGlyph = (p: P) => (
  <I strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.6 2.6L16 9.6" />
  </I>
);

export const ReadyGlyph = (p: P) => (
  <I strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 1.8" />
  </I>
);

export const IgnoredGlyph = (p: P) => (
  <I strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 15.5 7-7" />
  </I>
);

/* A circle with the line broken in it — the same family as the other status
   marks, and readable at 12px where a warning triangle is a smudge. */
export const FailedGlyph = (p: P) => (
  <I strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5" />
    <path d="M12 16h.01" />
  </I>
);

export const PulseGlyph = (p: P) => (
  <I strokeWidth={1.9} {...p}>
    <path d="M3 12h3.5l2-5 3 10 2.5-5H21" />
  </I>
);

export const FunnelGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <path d="M3.5 5h17l-6.5 7.5V20l-4-2.2v-5.3Z" />
  </I>
);

export const SortGlyph = (p: P) => (
  <I strokeWidth={1.9} {...p}>
    <path d="M7 4v16M7 20l-3-3M7 20l3-3" />
    <path d="M17 20V4M17 4l-3 3M17 4l3 3" />
  </I>
);

export const GridGlyph = (p: P) => (
  <I strokeWidth={1.8} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </I>
);

export const CloseGlyph = (p: P) => (
  <I strokeWidth={2.2} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </I>
);

export const CpuGlyph = (p: P) => (
  <I strokeWidth={1.7} {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
    <rect x="10" y="10" width="4" height="4" rx="1" />
    <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
  </I>
);

export const BriefcaseGlyph = (p: P) => (
  <I strokeWidth={1.7} {...p}>
    <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
    <path d="M3 12.5h18" />
  </I>
);

/** The glyph for a section kind. */
export const KIND_GLYPH = {
  research: GlobeGlyph,
  tags: HashGlyph,
  script: ClapperGlyph,
  caption: CardGlyph,
  social: SocialGlyph,
  seo: SeoGlyph,
  cta: CtaGlyph,
} as const;

export { ScanGlyph as ResearchGlyph };

/** The glyph for a usage status. */
export const USAGE_GLYPH = {
  used: UsedGlyph,
  ready: ReadyGlyph,
  ignored: IgnoredGlyph,
  writing: PulseGlyph,
  failed: FailedGlyph,
  // An idea is a topic with nothing behind it yet — the same glyph the topic
  // list has always used for one.
  idea: TopicGlyph,
} as const;

/** The glyph for an output, used instead of a text label. */
export const OUTPUT_GLYPH = {
  en: ClapperGlyph,
  bn: SpeechGlyph,
  social: SocialGlyph,
  seo: SeoGlyph,
  tags: HashGlyph,
} as const;

/** The glyph for a topic category. */
export const CATEGORY_GLYPH: Record<string, typeof CpuGlyph> = {
  AI: CpuGlyph,
  Business: BriefcaseGlyph,
};
