import type { Metadata } from "next";

import { BuilderView } from "@/components/views/BuilderView";

export const metadata: Metadata = { title: "Edit Template · Content OS" };

/**
 * One template's builder per URL.
 *
 * `/builder` used to be the only editing screen, so every template was edited
 * at the same address: a link went nowhere in particular, a refresh emptied the
 * draft, and two tabs open on two templates were indistinguishable. The slug is
 * the template's own id — the same one `/pack/<slug>` and a run both record.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BuilderView slug={slug} />;
}
