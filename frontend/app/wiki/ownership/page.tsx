import { IntelligenceAtlasWorkspace } from "@/features/intelligence-atlas/intelligence-atlas-workspace";
import type { Metadata } from "next";
import { Suspense } from "react";

const atlasLoadingFallback = <div className="min-h-screen bg-[#080907]" aria-label="Loading Intelligence Atlas" />,
 metadata: Metadata = {
  description: "Trace source, ownership, reporter, article, claim, and evidence relationships.",
  title: "SCOOP Intelligence Atlas",
};

export { metadata };

const IntelligenceAtlasPage = () => (
  <Suspense fallback={atlasLoadingFallback}>
    <IntelligenceAtlasWorkspace />
  </Suspense>
);

export default IntelligenceAtlasPage;
