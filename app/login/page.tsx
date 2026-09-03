import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthView } from "@/components/views/AuthView";

export const metadata: Metadata = { title: "Sign in · Content OS" };

export default function Page() {
  // useSearchParams needs a boundary, and the fallback is one frame of the
  // same dark ground the form lands on rather than a visible flash.
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
      <AuthView mode="login" />
    </Suspense>
  );
}
