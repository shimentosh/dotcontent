import type { Metadata } from "next";

import { ToolsView } from "@/components/views/ToolsView";

export const metadata: Metadata = { title: "Tools · dotcontent" };

export default function Page() {
  return <ToolsView />;
}
