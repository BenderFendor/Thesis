"use client";

import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import JsonView from "react18-json-view";
import { Search } from "lucide-react";
import { useCallback } from "react";
import type { SourceDebugData } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { DebugJsonValue } from "./source-debug-data";
import { filterSourceDebugData } from "./source-debug-data";
import { SectionSummary } from "./source-debug-sections";

interface DebugJsonSectionProps {
  readonly debugData: ReadonlySourceDebugData;
  readonly onSearchQueryChange: (value: string) => void;
  readonly searchQuery: string;
}

type ReadonlySourceDebugData = DeepReadonly<SourceDebugData>;

interface SearchChangeEvent {
  readonly target: Readonly<{ readonly value: string }>;
}

const DebugSearchInput = ({
  onChange,
  value,
}: Readonly<{ readonly onChange: (event: SearchChangeEvent) => void; readonly value: string }>) => (
  <div className="relative mb-4">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
    <Input
      placeholder="Search JSON..."
      value={value}
      onChange={onChange}
      className="pl-10"
    />
  </div>
);

const DebugJsonPanel = ({ data }: Readonly<{ readonly data: DebugJsonValue }>) => (
  <JsonView src={data} collapsed={2} enableClipboard theme="vscode" />
);

const DebugJsonContent = ({
  debugData,
  onSearchQueryChange,
  searchQuery,
}: DebugJsonSectionProps) => {
  const handleSearchChange = useCallback(
    (event: SearchChangeEvent) => {
      onSearchQueryChange(event.target.value);
    },
    [onSearchQueryChange],
  );
  const filteredData = filterSourceDebugData(debugData, searchQuery);
  return (
    <CardContent>
      <DebugSearchInput value={searchQuery} onChange={handleSearchChange} />
      <DebugJsonPanel data={filteredData} />
    </CardContent>
  );
};

const DebugJsonSection = ({
  debugData,
  onSearchQueryChange,
  searchQuery,
}: DebugJsonSectionProps) => (
  <details open>
    <SectionSummary kind="code" title="Complete Debug JSON" />
    <DebugJsonContent
      debugData={debugData}
      onSearchQueryChange={onSearchQueryChange}
      searchQuery={searchQuery}
    />
  </details>
);

export { DebugJsonSection };
