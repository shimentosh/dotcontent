import type { Metadata } from "next";

import { ContentGroupsView } from "@/components/views/ContentGroupsView";

export const metadata: Metadata = { title: "Content · dotcontent" };

export default function Page() {
  return <ContentGroupsView />;
}
