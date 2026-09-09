"use client";
import { hasText } from "@/lib/utils";

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
} from "@/lib/api";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SourceIntelligenceOperations } from "@/app/wiki/ownership/source-intelligence-operations";
import type { WikiSourceProfile } from "@/lib/api";
import { useCallback, useMemo } from "react";
import workspaceSupport from "@/app/wiki/ownership/source-intelligence-support";

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"];
const WORKSPACE_TABS = workspaceSupport.tabs;
type SourceStats = Awaited<ReturnType<typeof fetchSourceStats>>;
const EMPTY_SOURCE_STATS: SourceStats = [];

interface AtlasOperationsSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly activeTab: WorkspaceTab;
  readonly onTabChange: (tab: WorkspaceTab) => void;
  readonly selectedSourceName: string | null;
}

export const AtlasOperationsSheet = ({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
  selectedSourceName,
}: Readonly<AtlasOperationsSheetProps>) => {
  const queryClient = useQueryClient();
  const sourceStatsQuery = useQuery({
      enabled: open,
      queryFn: fetchSourceStats,
      queryKey: ["debug-source-stats-summary"],
      retry: 1,
    });
  const cacheStatusQuery = useQuery({
      enabled: open,
      queryFn: fetchCacheStatus,
      queryKey: ["debug-cache-status-summary"],
      retry: 1,
    });
  const indexStatusQuery = useQuery({
      enabled: open,
      queryFn: fetchWikiIndexStatus,
      queryKey: ["wiki-index-status"],
      retry: 1,
    });
  const sourceProfileQuery = useQuery<WikiSourceProfile>({
      enabled: open && Boolean(selectedSourceName),
      queryFn: () => fetchWikiSource(selectedSourceName ?? ""),
      queryKey: ["wiki-source-profile", selectedSourceName],
      retry: 1,
    });
  const tabs = useMemo(() => [...WORKSPACE_TABS], []);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["debug-source-stats-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["debug-cache-status-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["wiki-index-status"] }),
      queryClient.invalidateQueries({ queryKey: ["wiki-source-profile", selectedSourceName] }),
      queryClient.invalidateQueries({ queryKey: ["atlas"] }),
      queryClient.invalidateQueries({ queryKey: ["wiki-source-profile"] }),
    ]);
    return;
  }, [queryClient, selectedSourceName]);
  const handleRefreshAll = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);
  const handleSourceProfileRefresh = useCallback(async () => {
    if (!hasText(selectedSourceName)) {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: ["wiki-source-profile", selectedSourceName],
    });
    return;
  }, [queryClient, selectedSourceName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 flex h-[min(82vh,880px)] w-[min(1320px,calc(100%-1rem))] max-w-none translate-y-0 flex-col gap-0 rounded-b-none border-white/10 bg-[#0d0f0c]/[0.99] p-0 text-[#f0ede4] shadow-2xl">
        <DialogHeader className="border-b border-white/10 p-5 pr-14">
          <DialogTitle className="font-serif text-3xl font-normal">Atlas operations</DialogTitle>
          <DialogDescription className="mt-1 text-[#77736a]">
            Inspect ingestion, parser, model, storage, and error state without shrinking the
            investigation graph.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 p-4">
          <SourceIntelligenceOperations
            activeTab={activeTab}
            onTabChange={onTabChange}
            tabs={tabs}
            sourceStats={sourceStatsQuery.data ?? EMPTY_SOURCE_STATS}
            cacheStatus={cacheStatusQuery.data ?? null}
            wikiIndexStatus={indexStatusQuery.data}
            selectedSourceName={selectedSourceName}
            selectedSourceProfile={sourceProfileQuery.data ?? null}
            onRefreshAll={handleRefreshAll}
            onSourceProfileRefresh={handleSourceProfileRefresh}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
