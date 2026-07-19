"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchCacheStatus,
  fetchSourceStats,
  fetchWikiIndexStatus,
  fetchWikiSource,
  type WikiSourceProfile,
} from "@/lib/api";
import { SourceIntelligenceOperations } from "@/app/wiki/ownership/source-intelligence-operations";
import {
  WORKSPACE_TABS,
  type WorkspaceTab,
} from "@/app/wiki/ownership/source-intelligence-support";

interface AtlasOperationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  selectedSourceName: string | null;
}

export function AtlasOperationsSheet({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
  selectedSourceName,
}: AtlasOperationsSheetProps) {
  const queryClient = useQueryClient();
  const sourceStatsQuery = useQuery({
    queryKey: ["debug-source-stats-summary"],
    queryFn: fetchSourceStats,
    enabled: open,
    retry: 1,
  });
  const cacheStatusQuery = useQuery({
    queryKey: ["debug-cache-status-summary"],
    queryFn: fetchCacheStatus,
    enabled: open,
    retry: 1,
  });
  const indexStatusQuery = useQuery({
    queryKey: ["wiki-index-status"],
    queryFn: fetchWikiIndexStatus,
    enabled: open,
    retry: 1,
  });
  const sourceProfileQuery = useQuery<WikiSourceProfile>({
    queryKey: ["wiki-source-profile", selectedSourceName],
    queryFn: () => fetchWikiSource(selectedSourceName ?? ""),
    enabled: open && Boolean(selectedSourceName),
    retry: 1,
  });

  const tabs = useMemo(() => [...WORKSPACE_TABS], []);

  async function refreshAll() {
    await Promise.allSettled([
      sourceStatsQuery.refetch(),
      cacheStatusQuery.refetch(),
      indexStatusQuery.refetch(),
      selectedSourceName ? sourceProfileQuery.refetch() : Promise.resolve(null),
    ]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["atlas"] }),
      queryClient.invalidateQueries({ queryKey: ["wiki-source-profile"] }),
    ]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 flex h-[min(82vh,880px)] w-[min(1320px,calc(100%-1rem))] max-w-none translate-y-0 flex-col gap-0 rounded-b-none border-white/10 bg-[#0d0f0c]/[0.99] p-0 text-[#f0ede4] shadow-2xl">
        <DialogHeader className="border-b border-white/10 p-5 pr-14">
          <DialogTitle className="font-serif text-3xl font-normal">Atlas operations</DialogTitle>
          <DialogDescription className="mt-1 text-[#77736a]">
            Inspect ingestion, parser, model, storage, and error state without shrinking the investigation graph.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 p-4">
          <SourceIntelligenceOperations
            activeTab={activeTab}
            onTabChange={onTabChange}
            tabs={tabs}
            sourceStats={sourceStatsQuery.data ?? []}
            cacheStatus={cacheStatusQuery.data ?? null}
            wikiIndexStatus={indexStatusQuery.data}
            selectedSourceName={selectedSourceName}
            selectedSourceProfile={sourceProfileQuery.data ?? null}
            onRefreshAll={() => {
              void refreshAll();
            }}
            onSourceProfileRefresh={async () => {
              if (!selectedSourceName) return;
              await sourceProfileQuery.refetch();
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
