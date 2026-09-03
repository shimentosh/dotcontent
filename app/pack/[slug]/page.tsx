import type { Metadata } from "next";

import { PackDetailView } from "@/components/views/PackDetailView";

export const metadata: Metadata = { title: "Template · Content OS" };

/**
 * One pack per URL.
 *
 * `/pack` used to be a single page for a single pack, so every row in the
 * library opened the same screen. The slug is the pack's own id, which is also
 * what a run records — the two now agree.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PackDetailView slug={slug} />;
}
