import type { ReactNode } from "react";

type IconProps = {
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
};

function Line({
  size = 16,
  stroke = "currentColor",
  strokeWidth = 1.6,
  style,
  children,
}: IconProps & { children: ReactNode }) {
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

function Solid({
  size = 16,
  fill = "currentColor",
  style,
  children,
}: {
  size?: number;
  fill?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const Logo = (p: IconProps) => (
  <Line strokeWidth={2.2} {...p}>
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </Line>
);

export const HomeIcon = (p: IconProps) => (
  <Line {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </Line>
);

export const TopicsIcon = (p: IconProps) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </Line>
);

export const TopicSparkIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </Line>
);

export const ContentIcon = (p: IconProps) => (
  <Line {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Line>
);

export const PacksIcon = (p: IconProps) => (
  <Line {...p}>
    <path d="M3 8l9-4.5L21 8l-9 4.5L3 8Z" />
    <path d="M3 12.5 12 17l9-4.5" />
    <path d="M3 16.5 12 21l9-4.5" />
  </Line>
);

export const PackShortIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M3 8l9-4.5L21 8l-9 4.5L3 8Z" />
    <path d="M3 12.5 12 17l9-4.5" />
  </Line>
);

export const PackTinyIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="M3 8l9-4.5L21 8l-9 4.5L3 8Z" />
  </Line>
);

export const WorkspacesIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </Line>
);

export const LibraryIcon = (p: IconProps) => (
  <Line {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
    <path d="M12 4h3.5A1.5 1.5 0 0 1 17 5.5v13A1.5 1.5 0 0 1 15.5 20H12V4Z" />
    <path d="M19.5 6.5 21 18" />
  </Line>
);

export const PromptsIcon = (p: IconProps) => (
  <Line {...p}>
    <path d="m8 8-4 4 4 4" />
    <path d="m16 8 4 4-4 4" />
    <path d="M13 5l-2 14" />
  </Line>
);

export const BoltIcon = (p: IconProps) => (
  <Line {...p}>
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
  </Line>
);

export const IntegrationsIcon = (p: IconProps) => (
  <Line {...p}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </Line>
);

export const SettingsIcon = (p: IconProps) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-2.87-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a2 2 0 0 1-1.6-1.96 2 2 0 0 1 1.6-1.96 1.7 1.7 0 0 0 1.14-2.87l-.06-.06A2 2 0 1 1 8.51 5.3l.06.06A1.7 1.7 0 0 0 11.44 4.2V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.87 1.16l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 22.4 11a2 2 0 0 1 0 4Z" />
  </Line>
);

export const ChevronDown = (p: IconProps) => (
  <Line strokeWidth={2.2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Line>
);

export const ChevronRight = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="m9 6 6 6-6 6" />
  </Line>
);

export const ChevronLeft = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="m15 6-6 6 6 6" />
  </Line>
);

export const SearchIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4.5-4.5" />
  </Line>
);

export const PlusIcon = (p: IconProps) => (
  <Line strokeWidth={2.4} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Line>
);

export const BellIcon = (p: IconProps) => (
  <Line strokeWidth={1.7} {...p}>
    <path d="M18 8A6 6 0 1 0 6 8c0 7-3 8-3 8h18s-3-1-3-8" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </Line>
);

export const PencilIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
  </Line>
);

export const AlertIcon = (p: IconProps) => (
  <Line strokeWidth={2.2} {...p}>
    <path d="M12 8v5M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </Line>
);

export const RefreshIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </Line>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="m5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Line>
);

/* Ordering a list by hand. A full shaft rather than a bare chevron: at 12px
   in a row of controls a chevron reads as "expand", not as "move". */
export const ArrowUpIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Line>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </Line>
);

export const TrashIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M4 7h16" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7v12A1.5 1.5 0 0 0 8 20.5h8a1.5 1.5 0 0 0 1.5-1.5V7" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Line>
);

/* --- Project status ----------------------------------------------------- */

/** Active — a filled ring, the way a live indicator reads. */
export const LiveIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
  </Line>
);

/** Planning — the same ring, drawn as a dashed outline: set up, not running. */
export const PlanIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 1 6 2.5" />
    <path d="M20.2 9a8.5 8.5 0 0 1 0 6" />
    <path d="M18 18a8.5 8.5 0 0 1-6 2.5" />
    <path d="M9 20.2a8.5 8.5 0 0 1-5.2-5.2" />
    <path d="M3.5 12a8.5 8.5 0 0 1 2.5-6" />
  </Line>
);

export const PauseIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10 9.5v5M14 9.5v5" />
  </Line>
);

export const ArchiveIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <rect x="3" y="4" width="18" height="4.5" rx="1.4" />
    <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5" />
    <path d="M10 12.5h4" />
  </Line>
);

export const GlobeIcon = (p: IconProps) => (
  <Line strokeWidth={1.7} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </Line>
);

export const TargetIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Line>
);

/* --- Content types ------------------------------------------------------ */

export const ScriptIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </Line>
);

export const TitleIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M5 7V5h14v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </Line>
);

export const HookIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M16 5v8a5 5 0 0 1-10 0v-1" />
    <path d="m13 8 3-3 3 3" />
  </Line>
);

export const CaptionIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" />
    <path d="M8 9h8M8 13h5" />
  </Line>
);

export const CtaIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5L8 9H5a1 1 0 0 0-1 1Z" />
    <path d="M18 9.5a4 4 0 0 1 0 5" />
  </Line>
);

export const VoiceIcon = (p: IconProps) => (
  <Line strokeWidth={1.9} {...p}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </Line>
);

export const ReplyIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="m9 14-5-5 5-5" />
    <path d="M4 9h9a7 7 0 0 1 7 7v4" />
  </Line>
);

/* --- Tools --------------------------------------------------------------- */

export const ToolsIcon = (p: IconProps) => (
  <Line strokeWidth={1.7} {...p}>
    <path d="M14.6 6.3a1 1 0 0 0 0 1.4l1.7 1.7a1 1 0 0 0 1.4 0l4-4a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-4 4Z" />
  </Line>
);

export const ResearchIcon = (p: IconProps) => (
  <Line strokeWidth={1.7} {...p}>
    <path d="M13 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    <path d="M8 12h4M8 16h6" />
    <circle cx="17" cy="6" r="3.2" />
    <path d="m19.6 8.6 2 2" />
  </Line>
);

export const LinkIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.5 6" />
    <path d="M14 11a4 4 0 0 0-5.7 0L5.7 13.6a4 4 0 0 0 5.7 5.7l1.1-1.1" />
  </Line>
);

export const CopyIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <rect x="9" y="9" width="11" height="12" rx="2" />
    <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16" />
  </Line>
);

/* --- Filtering and sorting ---------------------------------------------- */

export const FilterIcon = (p: IconProps) => (
  <Line strokeWidth={1.8} {...p}>
    <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
  </Line>
);

export const PulseIcon = (p: IconProps) => (
  <Line strokeWidth={1.9} {...p}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </Line>
);

export const CheckIcon = (p: IconProps) => (
  <Line strokeWidth={2.6} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Line>
);

export const CloseIcon = (p: IconProps) => (
  <Line strokeWidth={2.2} {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Line>
);

export const SortIcon = (p: IconProps) => (
  <Line strokeWidth={2} {...p}>
    <path d="m8 9 4-4 4 4" />
    <path d="m8 15 4 4 4-4" />
  </Line>
);

export const PlayIcon = ({
  size = 13,
  fill = "#fff",
  style,
}: {
  size?: number;
  fill?: string;
  style?: React.CSSProperties;
}) => (
  <Solid size={size} fill={fill} style={style}>
    <path d="M7 4.5v15l13-7.5-13-7.5Z" />
  </Solid>
);

export const MoreIcon = ({
  size = 15,
  fill = "rgba(240,240,244,0.7)",
}: {
  size?: number;
  fill?: string;
}) => (
  <Solid size={size} fill={fill}>
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </Solid>
);

export const DragIcon = ({
  size = 13,
  fill = "rgba(240,240,244,0.28)",
}: {
  size?: number;
  fill?: string;
}) => (
  <Solid size={size} fill={fill}>
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </Solid>
);
