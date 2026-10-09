import type { Metadata } from "next";

import { DocumentView } from "@/components/views/DocumentView";

type Params = { params: Promise<{ topic: string }> };

/**
 * One topic, and everything written for it.
 *
 * No `generateStaticParams` and no `notFound`: the slugs are topics in the
 * database, which the server cannot enumerate at build time and which change
 * every time you add one. It used to prerender the twenty-four sample
 * documents and 404 anything else, so a topic you created yourself was
 * unreachable at the URL the list linked to.
 *
 * Whether the topic exists is settled by the view, which already holds every
 * topic in the workspace — and it can tell "no such topic" from "nothing
 * written yet", which a 404 cannot.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { topic } = await params;
  const name = topic.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { title: `${name} · dotcontent` };
}

export default async function Page({ params }: Params) {
  const { topic } = await params;
  return <DocumentView slug={topic} />;
}
