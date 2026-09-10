import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type {
  AtlasGraphFilters,
  AtlasGraphResponse,
  AtlasNode,
  AtlasSearchItem,
} from "./lib/atlas-schema";
import type { ReadonlyAtlasQueryState } from "./lib/atlas-query-state";
import { parseAtlasQueryState } from "./lib/atlas-query-state";
import {
  ATLAS_QUERY_KEY,
  asError,
  buildDockNodes,
  buildGraphFilters,
  buildWorkspaceHref,
  EMPTY_NODES,
  ENTITY_STALE_MS,
  GRAPH_STALE_MS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_STALE_MS,
  STATUS_STALE_MS,
  ensureEntityType,
  flattenSearchResults,
  nextSearchIndex,
  resolveSelectedNode,
  resolveSelectedSourceName,
  resolveTotalStats,
  updateRecentIds,
} from "./intelligence-atlas-workspace-helpers";
import type {
  AtlasEntityRecord,
  AtlasIngestStatus,
  AtlasMediaMeasurements,
  AtlasSearchResponse,
  AtlasGlobalKeyboardEvent,
  AtlasInputRef,
  AtlasNavigationRouter,
  AtlasStatsResponse,
  WriteState,
} from "./intelligence-atlas-workspace-helpers";
import {
  fetchAtlasEntity,
  fetchAtlasGraph,
  fetchAtlasIngestStatus,
  fetchAtlasStats,
  fetchMediaMeasurements,
  searchAtlas,
} from "./lib/atlas-api";
import type { AtlasSearchKeyDownEvent } from "./atlas-topbar";

const useAtlasNavigationState = () => {
  const pathname = usePathname() ?? "",
    router: AtlasNavigationRouter = useRouter(),
    { push, replace } = router,
    searchParams = useSearchParams(),
    searchParamsString = searchParams.toString();

  const state = useMemo(
      () => parseAtlasQueryState(new URLSearchParams(searchParamsString)),
      [searchParamsString],
    ),
    writeState = useCallback<WriteState>(
      (patch, mode = "push") => {
        const currentPathname = pathname || "/wiki/ownership",
          href = buildWorkspaceHref(currentPathname, { ...state, ...patch });
        if (mode === "replace") {
          replace(href, { scroll: false });
          return;
        }
        push(href, { scroll: false });
      },
      [pathname, push, replace, state],
    );

  return { push, state, writeState };
};

interface SearchController<TInput extends HTMLInputElement = HTMLInputElement> {
  readonly searchText: string;
  readonly searchOpen: boolean;
  readonly activeSearchIndex: number;
  readonly searchInputRef: AtlasInputRef<TInput>;
  readonly searchItems: readonly AtlasSearchItem[];
  readonly searching: boolean;
  readonly setSearchText: (value: string) => void;
  readonly setSearchOpen: (value: boolean) => void;
  readonly setActiveSearchIndex: (value: number) => void;
  readonly chooseSearchResult: (item: AtlasSearchItem) => void;
  readonly handleSearchKeyboard: (event: AtlasSearchKeyDownEvent) => void;
}

const useAtlasGraphQuery = (filters: AtlasGraphFilters, enabled: boolean) =>
  useQuery<AtlasGraphResponse>({
    enabled,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => fetchAtlasGraph(filters, signal),
    queryKey: ["atlas", "graph", filters],
    retry: 1,
    staleTime: GRAPH_STALE_MS,
  });

const useAtlasStatusQueries = () => {
  const statsQuery = useQuery<AtlasStatsResponse>({
    queryFn: ({ signal }) => fetchAtlasStats(signal),
    queryKey: ["atlas", "stats"],
    retry: 1,
    staleTime: STATUS_STALE_MS,
  });
  const ingestStatusQuery = useQuery<AtlasIngestStatus>({
    queryFn: ({ signal }) => fetchAtlasIngestStatus(signal),
    queryKey: ["atlas", "ingestion-status"],
    retry: 1,
    staleTime: STATUS_STALE_MS,
  });
  return { ingestStatusQuery, statsQuery };
};

const useAtlasEntityQuery = (selectedId: string | null) =>
  useQuery<AtlasEntityRecord>({
    enabled: selectedId !== null,
    queryFn: ({ signal }) => fetchAtlasEntity(selectedId ?? "", signal),
    queryKey: ["atlas", "entity", selectedId],
    retry: 1,
    staleTime: ENTITY_STALE_MS,
  });

const useAtlasGraphProjection = (
  state: ReadonlyAtlasQueryState,
  nodes: readonly AtlasNode[],
  statsData: AtlasStatsResponse | undefined,
  graphData: AtlasGraphResponse | undefined,
  entityData: AtlasEntityRecord | undefined,
) => {
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selectedNode = resolveSelectedNode(state.selected, nodesById);
  const totalStats = resolveTotalStats(statsData, graphData);
  const selectedSourceName = resolveSelectedSourceName(entityData, selectedNode);
  return { nodes, nodesById, selectedNode, selectedSourceName, totalStats };
};

const useAtlasMeasurementsQuery = (selectedSourceName: string | null) =>
  useQuery<AtlasMediaMeasurements>({
    enabled: selectedSourceName !== null,
    queryFn: ({ signal }) => fetchMediaMeasurements(selectedSourceName ?? "", signal),
    queryKey: ["atlas", "media-measurements", selectedSourceName],
    retry: 1,
    staleTime: ENTITY_STALE_MS,
  });

interface AtlasWorkspaceViewData {
  readonly entity: AtlasEntityRecord | undefined;
  readonly entityError: Error | null;
  readonly entityLoading: boolean;
  readonly graph: AtlasGraphResponse | undefined;
  readonly graphError: Error | null;
  readonly graphFetching: boolean;
  readonly graphLoading: boolean;
  readonly ingestStatus: AtlasIngestStatus | undefined;
  readonly measurements: AtlasMediaMeasurements | undefined;
  readonly measurementsLoading: boolean;
  readonly nodes: readonly AtlasNode[];
  readonly nodesById: ReadonlyMap<string, AtlasNode>;
  readonly selectedNode: AtlasNode | null;
  readonly selectedSourceName: string | null;
  readonly stats: AtlasStatsResponse | undefined;
  readonly totalStats: AtlasGraphResponse["stats"] | undefined;
}

const useAtlasData = (state: ReadonlyAtlasQueryState) => {
  const graphFilters = useMemo(() => buildGraphFilters(state), [state]);
  const isGraphView = state.view === "graph";
  const graphQuery = useAtlasGraphQuery(graphFilters, isGraphView);
  const { statsQuery, ingestStatusQuery } = useAtlasStatusQueries();
  const entityQuery = useAtlasEntityQuery(state.selected);
  const nodes = graphQuery.data?.nodes ?? EMPTY_NODES;
  const projection = useAtlasGraphProjection(
    state,
    nodes,
    statsQuery.data,
    graphQuery.data,
    entityQuery.data,
  );
  const measurementsQuery = useAtlasMeasurementsQuery(projection.selectedSourceName);
  return {
    entityQuery,
    graphFilters,
    graphQuery,
    ingestStatusQuery,
    isGraphView,
    measurementsQuery,
    ...projection,
    statsQuery,
    view: {
      entity: entityQuery.data,
      entityError: asError(entityQuery.error),
      entityLoading: entityQuery.isLoading,
      graph: graphQuery.data,
      graphError: asError(graphQuery.error),
      graphFetching: graphQuery.isFetching,
      graphLoading: graphQuery.isLoading,
      ingestStatus: ingestStatusQuery.data,
      measurements: measurementsQuery.data,
      measurementsLoading: measurementsQuery.isLoading,
      nodes,
      nodesById: projection.nodesById,
      selectedNode: projection.selectedNode,
      selectedSourceName: projection.selectedSourceName,
      stats: statsQuery.data,
      totalStats: projection.totalStats,
    } satisfies AtlasWorkspaceViewData,
  };
};

const handleSearchShortcut = (
  event: AtlasGlobalKeyboardEvent,
  searchInputRef: AtlasInputRef,
  setSearchOpen: (value: boolean) => void,
): boolean => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
    return false;
  }
  event.preventDefault();
  searchInputRef.current?.focus();
  setSearchOpen(true);
  return true;
};

const handleEscapeKey = (
  event: AtlasGlobalKeyboardEvent,
  state: ReadonlyAtlasQueryState,
  searchOpen: boolean,
  setSearchOpen: (value: boolean) => void,
  writeState: WriteState,
): void => {
  if (searchOpen) {
    setSearchOpen(false);
    return;
  }
  if (state.panel !== "none") {
    writeState({ panel: "none" }, "replace");
    return;
  }
  if (state.focus) {
    writeState({ focus: false, neighbors: 0 }, "replace");
  }
};

const createGlobalKeyboardHandler =
  (
    state: ReadonlyAtlasQueryState,
    searchOpen: boolean,
    setSearchOpen: (value: boolean) => void,
    searchInputRef: AtlasInputRef,
    writeState: WriteState,
  ) =>
  (event: AtlasGlobalKeyboardEvent) => {
    if (handleSearchShortcut(event, searchInputRef, setSearchOpen)) {
      return;
    }
    if (event.key === "Escape") {
      handleEscapeKey(event, state, searchOpen, setSearchOpen, writeState);
    }
  };

const useAtlasGlobalKeyboard = (
  state: ReadonlyAtlasQueryState,
  searchOpen: boolean,
  setSearchOpen: (value: boolean) => void,
  searchInputRef: AtlasInputRef,
  writeState: WriteState,
) => {
  useEffect(() => {
    const handleGlobalKeyboard = createGlobalKeyboardHandler(
      state,
      searchOpen,
      setSearchOpen,
      searchInputRef,
      writeState,
    );
    globalThis.addEventListener("keydown", handleGlobalKeyboard);
    return () => {
      globalThis.removeEventListener("keydown", handleGlobalKeyboard);
    };
  }, [searchInputRef, searchOpen, setSearchOpen, state, writeState]);
};

const resolveSearchSelection = (queryValue: string, selectedId: string | null): string | null => {
  if (queryValue.length > 0) {
    return selectedId;
  }
  return null;
};

const useAtlasSearchState = (state: ReadonlyAtlasQueryState, writeState: WriteState) => {
  const queryValue = state.q;
  const selectedId = state.selected;
  const [searchText, setSearchText] = useState(queryValue);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setSearchText(queryValue);
      setActiveSearchIndex(0);
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [queryValue]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      if (searchText === queryValue) {
        return;
      }
      writeState(
        {
          [ATLAS_QUERY_KEY]: searchText,
          selected: resolveSearchSelection(searchText, selectedId),
        },
        "replace",
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [queryValue, searchText, selectedId, writeState]);

  return {
    activeSearchIndex,
    searchInputRef,
    searchOpen,
    searchText,
    setActiveSearchIndex,
    setSearchOpen,
    setSearchText,
  };
};

const useAtlasSearchQuery = (searchText: string, searchOpen: boolean) => {
  const searchQuery = useQuery<AtlasSearchResponse>({
    enabled: searchText.trim().length > 0 && searchOpen,
    queryFn: ({ signal }) => searchAtlas(searchText.trim(), signal),
    queryKey: ["atlas", "search", searchText.trim()],
    retry: 1,
    staleTime: SEARCH_STALE_MS,
  });
  const searchItems = useMemo(() => flattenSearchResults(searchQuery.data), [searchQuery.data]);
  return { searchItems, searching: searchQuery.isFetching };
};

const useAtlasSearchTextChange = (
  setSearchText: (value: string) => void,
  setActiveSearchIndex: (value: number) => void,
) =>
  useCallback(
    (value: string): void => {
      setSearchText(value);
      setActiveSearchIndex(0);
    },
    [setActiveSearchIndex, setSearchText],
  );

const useAtlasSearchSelection = (
  state: ReadonlyAtlasQueryState,
  writeState: WriteState,
  handleSearchTextChange: (value: string) => void,
  setSearchOpen: (value: boolean) => void,
) =>
  useCallback(
    (item: AtlasSearchItem) => {
      handleSearchTextChange(item.label);
      const entities = ensureEntityType(state.entities, item.entity_type);
      writeState({
        entities,
        neighbors: 1,
        panel: "inspector",
        [ATLAS_QUERY_KEY]: item.label,
        selected: item.id,
      });
      setSearchOpen(false);
    },
    [handleSearchTextChange, setSearchOpen, state.entities, writeState],
  );

const handleSearchNavigation = (
  event: AtlasSearchKeyDownEvent,
  searchItems: readonly AtlasSearchItem[],
  setActiveSearchIndex: (value: number | ((current: number) => number)) => void,
): boolean => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return false;
  }
  event.preventDefault();
  if (searchItems.length === 0) {
    return true;
  }
  let direction = -1;
  if (event.key === "ArrowDown") {
    direction = 1;
  }
  setActiveSearchIndex((current) => nextSearchIndex(current, direction, searchItems.length));
  return true;
};

const handleSearchSubmit = (
  event: AtlasSearchKeyDownEvent,
  searchItems: readonly AtlasSearchItem[],
  activeSearchIndex: number,
  chooseSearchResult: (item: AtlasSearchItem) => void,
): void => {
  if (event.key !== "Enter") {
    return;
  }
  const item = searchItems[activeSearchIndex];
  if (item === undefined) {
    return;
  }
  event.preventDefault();
  chooseSearchResult(item);
};

const useAtlasSearchKeyboard = (
  searchItems: readonly AtlasSearchItem[],
  activeSearchIndex: number,
  setActiveSearchIndex: (value: number | ((current: number) => number)) => void,
  chooseSearchResult: (item: AtlasSearchItem) => void,
) =>
  useCallback(
    (event: AtlasSearchKeyDownEvent) => {
      if (handleSearchNavigation(event, searchItems, setActiveSearchIndex)) {
        return;
      }
      handleSearchSubmit(event, searchItems, activeSearchIndex, chooseSearchResult);
    },
    [activeSearchIndex, chooseSearchResult, searchItems, setActiveSearchIndex],
  );

const useAtlasSearch = (
  state: ReadonlyAtlasQueryState,
  writeState: WriteState,
): SearchController => {
  const searchState = useAtlasSearchState(state, writeState);
  const searchResults = useAtlasSearchQuery(searchState.searchText, searchState.searchOpen);
  const handleSearchTextChange = useAtlasSearchTextChange(
    searchState.setSearchText,
    searchState.setActiveSearchIndex,
  );
  const chooseSearchResult = useAtlasSearchSelection(
    state,
    writeState,
    handleSearchTextChange,
    searchState.setSearchOpen,
  );
  const handleSearchKeyboard = useAtlasSearchKeyboard(
    searchResults.searchItems,
    searchState.activeSearchIndex,
    searchState.setActiveSearchIndex,
    chooseSearchResult,
  );
  return {
    activeSearchIndex: searchState.activeSearchIndex,
    chooseSearchResult,
    handleSearchKeyboard,
    searchInputRef: searchState.searchInputRef,
    searchItems: searchResults.searchItems,
    searchOpen: searchState.searchOpen,
    searchText: searchState.searchText,
    searching: searchResults.searching,
    setActiveSearchIndex: searchState.setActiveSearchIndex,
    setSearchOpen: searchState.setSearchOpen,
    setSearchText: handleSearchTextChange,
  };
};

const useDockNodes = (
  selectedId: string | null,
  nodes: readonly AtlasNode[],
  nodesById: ReadonlyMap<string, AtlasNode>,
  selectedNode: AtlasNode | null,
): readonly AtlasNode[] => {
  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => {
    if (selectedId === null) {
      return () => {};
    }
    const timer = globalThis.setTimeout(() => {
      setRecentIds((current) => updateRecentIds(current, selectedId));
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [selectedId]);
  return useMemo(
    () => buildDockNodes(nodes, nodesById, recentIds, selectedNode),
    [nodes, nodesById, recentIds, selectedNode],
  );
};

type AtlasWorkspaceData = ReturnType<typeof useAtlasData>;

export {
  useAtlasData,
  useAtlasGlobalKeyboard,
  useAtlasNavigationState,
  useAtlasSearch,
  useDockNodes,
  type AtlasWorkspaceData,
  type AtlasWorkspaceViewData,
  type SearchController,
};
