import type { Metadata } from "next";

import { SourceIntelligenceWorkspace } from "../source-intelligence-workspace";

export const metadata: Metadata = {
  title: "Source Intelligence Graph",
};

export default function SourceIntelligenceGraphPage() {
  return <SourceIntelligenceWorkspace />;
}
