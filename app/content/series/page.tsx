import type { Metadata } from "next";

import { ManageSeriesView } from "@/components/views/ManageSeriesView";

export const metadata: Metadata = { title: "Series · Content OS" };

export default function Page() {
  return <ManageSeriesView />;
}
