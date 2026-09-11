"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { fetchSources } from "@/lib/api";
import type { NewsSource } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { getLensStats, NEWS_LENSES } from "@/lib/news-lens";
import type { NewsLensId } from "@/lib/news-lens";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsLens } from "@/hooks/use-news-lens";
import { useSourceFilter } from "@/hooks/use-source-filter";

const EMPTY_RECENCY = 0,
  SOURCE_QUERY_RETRY_COUNT = 1;

type SidebarSection = "allSources" | "favorites";

interface SourceSidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sourceRecency?: Readonly<Record<string, number>>;
}

interface SourceSidebarDataInput {
  readonly lens: NewsLensId;
  readonly selectedSources: ReadonlySet<string>;
  readonly sourceRecency?: Readonly<Record<string, number>>;
  readonly sources: readonly NewsSource[];
  readonly isFavorite: (sourceId: string) => boolean;
  readonly searchQuery: string;
}

interface SourceSidebarActionInput {
  readonly clearAll: () => void;
  readonly clearLens: () => boolean;
  readonly selectAll: (sourceIds: readonly string[]) => void;
  readonly setLens: (lens: NewsLensId) => boolean;
  readonly setExpandedSections: React.Dispatch<
    React.SetStateAction<{ allSources: boolean; favorites: boolean }>
  >;
  readonly sources: readonly NewsSource[];
}

const sortSourcesByRecency = (
  sources: readonly NewsSource[],
  sourceRecency?: Readonly<Record<string, number>>,
): NewsSource[] => {
  const sorted = [...sources];
  if (sourceRecency === undefined) {
    return sorted;
  }
  return sorted.toSorted((left, right) => {
    const leftFresh = sourceRecency[left.id] ?? EMPTY_RECENCY,
      rightFresh = sourceRecency[right.id] ?? EMPTY_RECENCY;
    if (leftFresh !== rightFresh) {
      return rightFresh - leftFresh;
    }
    return left.name.localeCompare(right.name);
  });
};

const filterSources = (sources: readonly NewsSource[], query: string): readonly NewsSource[] => {
  if (query === "") {
    return sources;
  }
  return sources.filter((source) => {
    const sourceCountry = source.country.toLowerCase();
    const sourceName = source.name.toLowerCase();
    return sourceName.includes(query) || sourceCountry.includes(query);
  });
};

const getFavoriteSources = (
  sources: readonly NewsSource[],
  isFavorite: (sourceId: string) => boolean,
  sourceRecency?: Readonly<Record<string, number>>,
): NewsSource[] =>
  sortSourcesByRecency(
    sources.filter((source) => isFavorite(source.id)),
    sourceRecency,
  );

const getFilteredSources = (
  sources: readonly NewsSource[],
  searchQuery: string,
  sourceRecency?: Readonly<Record<string, number>>,
): NewsSource[] =>
  sortSourcesByRecency(filterSources(sources, searchQuery.trim().toLowerCase()), sourceRecency);

const buildSourceNameLookup = (sources: readonly NewsSource[]): Record<string, string> =>
  Object.fromEntries(
    sources.flatMap((source) => [
      [source.id, source.name],
      [source.slug, source.name],
    ]),
  );

const getSelectedSourceIds = (
  selectedSources: ReadonlySet<string>,
  sources: readonly NewsSource[],
): string[] =>
  sources
    .filter((source) => selectedSources.has(source.id) || selectedSources.has(source.slug))
    .map((source) => source.id);

const getLoadErrorMessage = (error: Error | null | undefined): string | undefined => error?.message;

const getFilterLabel = (
  lens: NewsLensId,
  selectedCount: number,
  includedCount: number,
  excludedCount: number,
): string => {
  if (lens === "all") {
    return `${selectedCount} selected`;
  }
  const lensLabel = NEWS_LENSES.find((preset) => preset.id === lens)?.label ?? "Lens";
  return `${lensLabel}: ${includedCount} in / ${excludedCount} out`;
};

const useSourceSidebarQuery = (isOpen: boolean) => {
  const query = useQuery<NewsSource[]>({
    enabled: isOpen,
    queryFn: fetchSources,
    queryKey: ["all-sources"],
    retry: SOURCE_QUERY_RETRY_COUNT,
  });
  return {
    error: query.error,
    isLoading: query.isLoading,
    refetch: query.refetch,
    sources: query.data ?? [],
  };
};

const useSourceSidebarData = ({
  lens,
  selectedSources,
  sourceRecency,
  sources,
  isFavorite,
  searchQuery,
}: SourceSidebarDataInput) => {
  const favoriteSources = useMemo(
    () => getFavoriteSources(sources, isFavorite, sourceRecency),
    [isFavorite, sourceRecency, sources],
  );
  const filteredSources = useMemo(
    () => getFilteredSources(sources, searchQuery, sourceRecency),
    [searchQuery, sourceRecency, sources],
  );
  const sourceNameLookup = useMemo(() => buildSourceNameLookup(sources), [sources]);
  const selectedSourceIds = useMemo(
    () => getSelectedSourceIds(selectedSources, sources),
    [selectedSources, sources],
  );
  const lensStats = useMemo(() => getLensStats(sources, lens), [lens, sources]);
  return { favoriteSources, filteredSources, lensStats, selectedSourceIds, sourceNameLookup };
};

const useSourceSidebarActions = ({
  clearAll,
  clearLens,
  selectAll,
  setLens,
  setExpandedSections,
  sources,
}: SourceSidebarActionInput) => {
  const toggleSection = useCallback(
    (section: SidebarSection) => {
      setExpandedSections((previous) => ({
        ...previous,
        [section]: !previous[section],
      }));
    },
    [setExpandedSections],
  );
  const clearFilters = useCallback(() => {
    clearAll();
    void clearLens();
  }, [clearAll, clearLens]);
  const selectEverySource = useCallback(() => {
    selectAll(sources.map((source) => source.id));
  }, [selectAll, sources]);
  const handleSetLens = useCallback(
    (nextLens: NewsLensId) => {
      void setLens(nextLens);
    },
    [setLens],
  );
  return { clearFilters, handleSetLens, selectEverySource, toggleSection };
};

const useSourceSidebarLocalState = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    allSources: true,
    favorites: true,
  });
  return { expandedSections, searchQuery, setExpandedSections, setSearchQuery };
};

type SourceSidebarQueryState = ReturnType<typeof useSourceSidebarQuery>;
type SourceSidebarDataState = ReturnType<typeof useSourceSidebarData>;
type SourceSidebarActions = ReturnType<typeof useSourceSidebarActions>;
type SourceSidebarFilterState = ReturnType<typeof useSourceFilter>;
type SourceSidebarLocalState = ReturnType<typeof useSourceSidebarLocalState>;

type SourceSidebarViewStateInput = DeepReadonly<{
  actions: SourceSidebarActions;
  data: SourceSidebarDataState;
  expandedSections: SourceSidebarLocalState["expandedSections"];
  isFavorite: (sourceId: string) => boolean;
  lens: NewsLensId;
  searchQuery: string;
  setSearchQuery: SourceSidebarLocalState["setSearchQuery"];
  sourceFilter: SourceSidebarFilterState;
  sourceQuery: SourceSidebarQueryState;
  toggleFavorite: (sourceId: string) => void;
}>;

type SourceSidebarSourcesInput = DeepReadonly<{
  clearLens: () => boolean;
  isFavorite: (sourceId: string) => boolean;
  isOpen: boolean;
  lens: NewsLensId;
  searchQuery: string;
  setExpandedSections: SourceSidebarLocalState["setExpandedSections"];
  setLens: (lens: NewsLensId) => boolean;
  sourceFilter: SourceSidebarFilterState;
  sourceRecency?: Readonly<Record<string, number>>;
}>;

const createSourceSidebarViewState = ({
  actions,
  data,
  expandedSections,
  isFavorite,
  lens,
  searchQuery,
  setSearchQuery,
  sourceFilter,
  sourceQuery,
  toggleFavorite,
}: SourceSidebarViewStateInput) => ({
  allExpanded: expandedSections.allSources,
  errorMessage: getLoadErrorMessage(sourceQuery.error),
  favoriteExpanded: expandedSections.favorites,
  favoriteSources: data.favoriteSources,
  filterActive: sourceFilter.isFilterActive() || lens !== "all",
  filterLabel: getFilterLabel(
    lens,
    sourceFilter.getSelectionCount(),
    data.lensStats.included,
    data.lensStats.excluded,
  ),
  filteredSources: data.filteredSources,
  handleClearAll: () => {
    sourceFilter.clearAll();
  },
  handleClearFilters: actions.clearFilters,
  handleRetry: () => {
    void sourceQuery.refetch();
  },
  handleSearchChange: (value: string) => {
    setSearchQuery(value);
  },
  handleSelectAll: actions.selectEverySource,
  handleSetLens: actions.handleSetLens,
  handleToggleFavorite: toggleFavorite,
  handleToggleSection: actions.toggleSection,
  handleToggleSource: sourceFilter.toggleSource,
  isFavorite,
  isLoading: sourceQuery.isLoading,
  isSelected: sourceFilter.isSelected,
  lens,
  searchQuery,
  selectedSourceIds: data.selectedSourceIds,
  sourceCount: sourceQuery.sources.length,
  sourceNameLookup: data.sourceNameLookup,
});

const useSourceSidebarSources = ({
  clearLens,
  isFavorite,
  isOpen,
  lens,
  searchQuery,
  setExpandedSections,
  setLens,
  sourceFilter,
  sourceRecency,
}: SourceSidebarSourcesInput) => {
  const sourceQuery = useSourceSidebarQuery(isOpen);
  const data = useSourceSidebarData({
    isFavorite,
    lens,
    searchQuery,
    selectedSources: sourceFilter.selectedSources,
    sourceRecency,
    sources: sourceQuery.sources,
  });
  const actions = useSourceSidebarActions({
    clearAll: () => {
      sourceFilter.clearAll();
    },
    clearLens,
    selectAll: (sourceIds) => {
      sourceFilter.selectAll(sourceIds);
    },
    setExpandedSections,
    setLens,
    sources: sourceQuery.sources,
  });
  return { actions, data, sourceQuery };
};

const useSourceSidebarParts = ({
  isOpen,
  sourceRecency,
}: Readonly<SourceSidebarProps>): SourceSidebarViewStateInput => {
  const localState = useSourceSidebarLocalState();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { clearLens, lens, setLens } = useNewsLens();
  const sourceFilter = useSourceFilter();
  const sourceState = useSourceSidebarSources({
    clearLens,
    isFavorite,
    isOpen,
    lens,
    searchQuery: localState.searchQuery,
    setExpandedSections: localState.setExpandedSections,
    setLens,
    sourceFilter,
    sourceRecency,
  });
  return {
    ...sourceState,
    expandedSections: localState.expandedSections,
    isFavorite,
    lens,
    searchQuery: localState.searchQuery,
    setSearchQuery: localState.setSearchQuery,
    sourceFilter,
    sourceQuery: sourceState.sourceQuery,
    toggleFavorite,
  };
};

const useSourceSidebarState = (props: Readonly<SourceSidebarProps>) =>
  createSourceSidebarViewState(useSourceSidebarParts(props));

type SourceSidebarState = DeepReadonly<ReturnType<typeof useSourceSidebarState>>;

export {
  useSourceSidebarState,
  type SidebarSection,
  type SourceSidebarProps,
  type SourceSidebarState,
};
