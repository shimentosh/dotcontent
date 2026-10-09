import type { Metadata } from "next";

import { PacksView } from "@/components/views/PacksView";

export const metadata: Metadata = { title: "Templates · dotcontent" };

export default function Page() {
  return <PacksView />;
}
