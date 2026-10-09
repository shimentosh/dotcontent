import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthView } from "@/components/views/AuthView";

export const metadata: Metadata = { title: "Claim this console · dotcontent" };

export default function Page() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <AuthView mode="signup" />
    </Suspense>
  );
}
