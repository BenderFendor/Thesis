import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AtlasEntityType, AtlasGraphFilters, AtlasNode } from "./lib/atlas-schema";
import type { AtlasPanel, AtlasView, ReadonlyAtlasQueryState } from "./lib/atlas-query-state";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  ensureEntityType,
  focusPatch,
  resolveCoverage,
  resolveOperationsTab,
} from "./intelligence-atlas-workspace-helpers";
import type {
  AtlasNavigationRouter,
  WorkspaceTab,
  WriteState,
} from "./intelligence-atlas-workspace-helpers";
import { exportAtlas } from "./lib/atlas-api";
import type { AtlasSearchChangeEvent } from "./atlas-topbar";
import { useDockNodes } from "./intelligence-atlas-workspace-hooks";
import type { AtlasWorkspaceData, SearchController } from "./intelligence-atlas-workspace-hooks";

type AtlasSearchActions = Readonly<{
  readonly chooseSearchResult: SearchController["chooseSearchResult"];
  readonly setActiveSearchIndex: SearchController["setActiveSearchIndex"];
  readonly setSearchOpen: SearchController["setSearchOpen"];
  readonly setSearchText: SearchController["setSearchText"];
}>;

const useAtlasWorkspaceState = (
  state: DeepReadonly<ReadonlyAtlasQueryState>,
  atlas: DeepReadonly<AtlasWorkspaceData>,
) => {
  const dockNodes = useDockNodes(state.selected, atlas.nodes, atlas.nodesById, atlas.selectedNode);
  const ownershipCoverage = resolveCoverage(atlas.totalStats);
  const operationsTab = resolveOperationsTab(state.tab);
  return { dockNodes, operationsTab, ownershipCoverage };
};

const useAtlasSelectionActions = (
  state: DeepReadonly<ReadonlyAtlasQueryState>,
  push: AtlasNavigationRouter["push"],
  writeState: WriteState,
  setSearchOpen: (value: boolean) => void,
) => {
  const handleSelectEntity = useCallback(
    (entityId: string, entityType?: AtlasEntityType) => {
      const entities = ensureEntityType(state.entities, entityType);
      writeState({ entities, neighbors: 1, panel: "inspector", selected: entityId });
      setSearchOpen(false);
    },
    [setSearchOpen, state.entities, writeState],
  );
  const handleOpenDirectoryRow = useCallback(
    (node: AtlasNode) => {
      if (
        node.profile_path !== null &&
        node.profile_path !== undefined &&
        node.profile_path.length > 0
      ) {
        push(node.profile_path);
        return;
      }
      writeState({
        entities: [node.entity_type],
        neighbors: 1,
        panel: "inspector",
        selected: node.id,
        view: "graph",
      });
    },
    [push, writeState],
  );
  return { handleOpenDirectoryRow, handleSelectEntity };
};

const useAtlasExportAction = (graphFilters: DeepReadonly<AtlasGraphFilters>) => {
  const [exporting, setExporting] = useState(false);
  const graphFiltersRef = useRef(graphFilters);
  useEffect(() => {
    graphFiltersRef.current = graphFilters;
  }, [graphFilters]);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportAtlas(graphFiltersRef.current);
    } finally {
      setExporting(false);
    }
  }, []);
  const handleExportClick = useCallback(() => {
    void handleExport();
  }, [handleExport]);
  return { exporting, handleExportClick };
};

const useAtlasDataActions = (
  state: DeepReadonly<ReadonlyAtlasQueryState>,
  atlas: DeepReadonly<AtlasWorkspaceData>,
) => {
  const queryClient = useQueryClient();
  const { graphQuery } = atlas;
  const { refetch } = graphQuery;
  const refreshData = useCallback(async () => {
    const requests = [
      queryClient.invalidateQueries({ queryKey: ["atlas", "graph"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "stats"] }),
      queryClient.invalidateQueries({ queryKey: ["atlas", "ingestion-status"] }),
    ];
    if (state.selected !== null) {
      requests.push(
        queryClient.invalidateQueries({ queryKey: ["atlas", "entity", state.selected] }),
      );
    }
    await Promise.all(requests);
  }, [queryClient, state.selected]);
  const exportAction = useAtlasExportAction(atlas.graphFilters);
  const handleRefresh = useCallback(() => {
    void refreshData();
  }, [refreshData]);
  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return { ...exportAction, handleRefresh, handleRetry };
};

const useAtlasPanelActions = (writeState: WriteState) => {
  const handleSetPanel = useCallback(
    (panel: AtlasPanel) => {
      writeState({ panel }, "replace");
    },
    [writeState],
  );
  const handleOpenOperations = useCallback(() => {
    handleSetPanel("operations");
  }, [handleSetPanel]);
  const handleOperationsOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        handleSetPanel("operations");
        return;
      }
      handleSetPanel("none");
    },
    [handleSetPanel],
  );
  const handleOperationsTabChange = useCallback(
    (tab: WorkspaceTab) => {
      writeState({ panel: "operations", tab }, "replace");
    },
    [writeState],
  );
  return {
    handleOpenOperations,
    handleOperationsOpenChange,
    handleOperationsTabChange,
    handleSetPanel,
  };
};

const useAtlasTopbarActions = (
  state: ReadonlyAtlasQueryState,
  writeState: WriteState,
  setSearchOpen: (value: boolean) => void,
  setSearchText: (value: string) => void,
) => {
  const handleSearchChange = useCallback(
    (event: AtlasSearchChangeEvent) => {
      setSearchText(event.target.value);
      setSearchOpen(true);
    },
    [setSearchOpen, setSearchText],
  );
  const handleSearchFocus = useCallback(() => {
    setSearchOpen(true);
  }, [setSearchOpen]);
  const handleToggleFocus = useCallback(() => {
    writeState(focusPatch(state));
  }, [state, writeState]);
  const handleCopy = useCallback(() => {
    void globalThis.navigator.clipboard?.writeText(globalThis.location.href);
  }, []);
  const handleViewChange = useCallback(
    (view: AtlasView) => {
      writeState({ view });
    },
    [writeState],
  );
  return {
    handleCopy,
    handleSearchChange,
    handleSearchFocus,
    handleToggleFocus,
    handleViewChange,
  };
};

const useAtlasWorkspaceController = (
  state: DeepReadonly<ReadonlyAtlasQueryState>,
  push: AtlasNavigationRouter["push"],
  writeState: WriteState,
  search: AtlasSearchActions,
  atlas: DeepReadonly<AtlasWorkspaceData>,
) => {
  const { chooseSearchResult, setActiveSearchIndex, setSearchOpen, setSearchText } = search;
  const workspaceState = useAtlasWorkspaceState(state, atlas);
  const selectionActions = useAtlasSelectionActions(state, push, writeState, setSearchOpen);
  const dataActions = useAtlasDataActions(state, atlas);
  const panelActions = useAtlasPanelActions(writeState);
  const topbarActions = useAtlasTopbarActions(state, writeState, setSearchOpen, setSearchText);
  const handleSearchHover = useCallback(
    (index: number) => {
      setActiveSearchIndex(index);
    },
    [setActiveSearchIndex],
  );
  const handleChooseSearchResult = useCallback(
    (item: Parameters<SearchController["chooseSearchResult"]>[0]) => {
      chooseSearchResult(item);
    },
    [chooseSearchResult],
  );
  return {
    ...workspaceState,
    ...selectionActions,
    ...dataActions,
    ...panelActions,
    ...topbarActions,
    handleChooseSearchResult,
    handleSearchHover,
  };
};

type AtlasWorkspaceController = Readonly<ReturnType<typeof useAtlasWorkspaceController>>;

export { useAtlasWorkspaceController, type AtlasWorkspaceController };
