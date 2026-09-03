import type { Metadata } from "next";

import { BuilderView } from "@/components/views/BuilderView";

export const metadata: Metadata = { title: "New Content Template · Content OS" };

/** Writing a template that does not exist yet. Saving moves it to its slug. */
export default function Page() {
  return <BuilderView />;
}
