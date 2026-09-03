import type { Tab } from "@/components/ui";
import { DocGlyph, StackGlyph } from "@/components/ui/DocIcons";

/**
 * The two screens that make up Content.
 *
 * One list, imported by both, so a tab can never be missing from one of them
 * or point somewhere the other does not.
 *
 * `/content/series` is a static segment and therefore beats `/content/[topic]`
 * — a topic whose slug came out as exactly "series" would be unreachable. It
 * is a word nobody names one thing, and the cost of the alternative (a route
 * that does not say what it holds) is paid on every visit.
 */
export const CONTENT_TABS: readonly Tab[] = [
  {
    href: "/content",
    label: "Content",
    icon: <DocGlyph size={14} stroke="currentColor" />,
  },
  {
    href: "/content/series",
    label: "Manage series",
    icon: <StackGlyph size={14} stroke="currentColor" />,
  },
];
