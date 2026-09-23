"use client";

import type { SourceDebugData } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { DebugJsonSection } from "./source-debug-json";
import { SourceDebugHeader } from "./source-debug-header";
import {
  FeedOverviewSection,
  ImageAnalysisSection,
  ParsedEntriesSection,
  SubFeedsSection,
} from "./source-debug-sections";

interface SourceDebugViewProps {
  readonly debugData: DeepReadonly<SourceDebugData>;
  readonly debugMode: boolean;
  readonly onRefresh: () => void;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onToggleDebugMode: () => void;
  readonly searchQuery: string;
}

export const SourceDebugView = ({
  debugData,
  debugMode,
  onRefresh,
  onSearchQueryChange,
  onToggleDebugMode,
  searchQuery,
}: Readonly<SourceDebugViewProps>) => (
  <div className="min-h-screen bg-background p-4 text-foreground dark sm:p-6 lg:p-8">
    <SourceDebugHeader
      debugData={debugData}
      debugMode={debugMode}
      onRefresh={onRefresh}
      onToggleDebugMode={onToggleDebugMode}
    />
    <main className="space-y-6">
      <FeedOverviewSection debugData={debugData} />
      <SubFeedsSection debugData={debugData} />
      <ImageAnalysisSection debugData={debugData} />
      <ParsedEntriesSection debugData={debugData} />
      <DebugJsonSection
        debugData={debugData}
        onSearchQueryChange={onSearchQueryChange}
        searchQuery={searchQuery}
      />
    </main>
  </div>
);
