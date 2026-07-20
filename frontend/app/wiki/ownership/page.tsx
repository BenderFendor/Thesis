import type { Metadata } from "next";
import { Suspense } from "react";

import { IntelligenceAtlasWorkspace } from "@/features/intelligence-atlas/intelligence-atlas-workspace";

export const metadata: Metadata = {
  title: "SCOOP Intelligence Atlas",
  description: "Trace source, ownership, reporter, article, claim, and evidence relationships.",
};

export default function IntelligenceAtlasPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080907]" aria-label="Loading Intelligence Atlas" />}>
      <IntelligenceAtlasWorkspace />
    </Suspense>
  );
}
