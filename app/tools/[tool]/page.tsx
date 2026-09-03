import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContentResearchView } from "@/components/views/ContentResearchView";
import { ContentResearcherView } from "@/components/views/ContentResearcherView";
import { TOOLS, findTool, type ToolSlug } from "@/lib/tools";

type Params = { params: Promise<{ tool: string }> };

/** Each tool brings its own screen; the registry only knows the slug. */
const VIEWS: Record<ToolSlug, () => React.ReactElement> = {
  "content-research": ContentResearchView,
  "content-researcher": ContentResearcherView,
};

export function generateStaticParams() {
  return TOOLS.map((t) => ({ tool: t.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { tool } = await params;
  const found = findTool(tool);
  return { title: `${found ? found.name : "Tool"} · Content OS` };
}

export default async function Page({ params }: Params) {
  const { tool } = await params;
  const found = findTool(tool);
  if (!found) notFound();
  const View = VIEWS[found.slug];
  // The tool reads ?q= from the URL, which a prerendered page can only do
  // below a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
