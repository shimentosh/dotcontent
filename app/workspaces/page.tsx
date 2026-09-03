import type { Metadata } from "next";

import { ProjectsView } from "@/components/views/ProjectsView";

export const metadata: Metadata = { title: "Workspaces · Content OS" };

export default function Page() {
  return <ProjectsView />;
}
