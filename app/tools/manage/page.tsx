import type { Metadata } from "next";

import { ToolsManageView } from "@/components/views/ToolsManageView";

export const metadata: Metadata = { title: "All tools · dotcontent" };

/**
 * Every tool, not just this workspace's.
 *
 * A static segment, so it wins over `/tools/[tool]` — "manage" is a reserved
 * tool slug for the same reason "series" is a reserved topic slug.
 */
export default function Page() {
  return <ToolsManageView />;
}
