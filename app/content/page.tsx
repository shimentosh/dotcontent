import type { Metadata } from "next";

import { ContentGroupsView } from "@/components/views/ContentGroupsView";

export const metadata: Metadata = { title: "Content · Content OS" };

export default function Page() {
  return <ContentGroupsView />;
}
