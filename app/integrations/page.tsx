import type { Metadata } from "next";

import { IntegrationsView } from "@/components/views/IntegrationsView";

export const metadata: Metadata = { title: "Integrations · dotcontent" };

export default function Page() {
  return <IntegrationsView />;
}
