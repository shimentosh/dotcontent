import type { Metadata } from "next";

import { DocumentView } from "@/components/views/DocumentView";

export const metadata: Metadata = { title: "Run · dotcontent" };

/**
 * One run, read the same way everything else is read.
 *
 * This used to be its own screen: twelve rows, a progress bar and a Rewrite
 * button each. The same twelve sections had a far better page at
 * `/content/<topic>` — grouped into the deliverables the template declares,
 * with the text in them — and the only reason to keep two was that one of them
 * could watch a run happen. It can now, so there is one.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentView runId={id} />;
}
