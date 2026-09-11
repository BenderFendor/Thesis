import type { NewsArticle } from "@/lib/api";
import { buildSourceGroups, compareSourceGroupsForGrid, getVisibleSourceIds } from "@/lib/source-groups";
import { getStoredGridViewMode, setStoredGridViewMode } from "@/lib/view-mode-storage";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GridViewMode } from "@/lib/view-mode-storage";

type GridChangeEvent = Readonly<{ target: Readonly<{ value: string }> }>;

interface GridSourceControllerOptions {
  readonly articles: readonly NewsArticle[];
  readonly controlledViewMode?: GridViewMode;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly onViewModeChange?: (mode: GridViewMode) => void;
}

interface GridSourceDataOptions {
  readonly articles: readonly NewsArticle[];
  readonly isFavorite: (sourceId: string) => boolean;
  readonly searchTerm: string;
  readonly sourceBatchCount: number;
  readonly viewMode: GridViewMode;
}

interface GridSourceActionOptions {
  readonly onViewModeChange?: (mode: GridViewMode) => void;
  readonly setExpandedSourceId: Dispatch<SetStateAction<string | null>>;
  readonly setSearchTerm: Dispatch<SetStateAction<string>>;
  readonly setSourceBatchCount: Dispatch<SetStateAction<number>>;
  readonly setUncontrolledViewMode: Dispatch<SetStateAction<GridViewMode>>;
}

const SOURCE_GROUP_BATCH_SIZE = 10;

const filterGridArticles = (
  articles: readonly NewsArticle[],
  searchTerm: string,
): readonly NewsArticle[] => {
  if (!searchTerm) {
    return articles;
  }
  const normalizedSearch = searchTerm.toLowerCase();
  return articles.filter(
    (article) =>
      article.title.toLowerCase().includes(normalizedSearch) ||
      article.summary?.toLowerCase().includes(normalizedSearch) ||
      article.source.toLowerCase().includes(normalizedSearch),
  );
};

const sortGridSourceGroups = (
  articles: readonly NewsArticle[],
  isFavorite: (sourceId: string) => boolean,
) =>
  buildSourceGroups(articles).toSorted((groupA, groupB) => {
    const favoriteDifference =
      Number(isFavorite(groupB.sourceId)) - Number(isFavorite(groupA.sourceId));
    return favoriteDifference || compareSourceGroupsForGrid(groupA, groupB);
  });

const useGridSourceData = ({
  articles,
  isFavorite,
  searchTerm,
  sourceBatchCount,
  viewMode,
}: Readonly<GridSourceDataOptions>) => {
  const filteredNews = useMemo(
    () => filterGridArticles(articles, searchTerm),
    [articles, searchTerm],
  );
  const sourceGroups = useMemo(
    () => sortGridSourceGroups(filteredNews, isFavorite),
    [filteredNews, isFavorite],
  );
  const sortedSourceIds = useMemo(
    () => sourceGroups.map((group) => group.sourceId),
    [sourceGroups],
  );
  const visibleSourceIds = useMemo(() => {
    if (viewMode !== "source") {
      return new Set<string>();
    }
    const favoriteSourceIds = new Set(
      sourceGroups.filter((group) => isFavorite(group.sourceId)).map((group) => group.sourceId),
    );
    return getVisibleSourceIds(
      sourceGroups,
      favoriteSourceIds,
      sourceBatchCount,
      SOURCE_GROUP_BATCH_SIZE,
    );
  }, [isFavorite, sourceBatchCount, sourceGroups, viewMode]);
  const visibleSourceGroups = useMemo(
    () => sourceGroups.filter((group) => visibleSourceIds.has(group.sourceId)),
    [sourceGroups, visibleSourceIds],
  );

  return {
    filteredNews,
    hasMoreSourceGroups: viewMode === "source" && visibleSourceIds.size < sortedSourceIds.length,
    sortedSourceIds,
    visibleSourceGroups,
    visibleSourceIds,
  };
};

const useGridSourceActions = ({
  onViewModeChange,
  setExpandedSourceId,
  setSearchTerm,
  setSourceBatchCount,
  setUncontrolledViewMode,
}: Readonly<GridSourceActionOptions>) => {
  const resetSourceBrowseState = (): void => {
    setSourceBatchCount(1);
    setExpandedSourceId(null);
  };
  const handleSearchChange = (event: GridChangeEvent): void => {
    resetSourceBrowseState();
    setSearchTerm(event.target.value);
  };
  const handleModeSelect = (mode: GridViewMode): void => {
    resetSourceBrowseState();
    setUncontrolledViewMode(mode);
    onViewModeChange?.(mode);
  };
  const toggleSource = (sourceId: string): void => {
    setExpandedSourceId((previous) => {
      if (previous === sourceId) {
        return null;
      }
      return sourceId;
    });
  };
  const loadMoreSources = (): void => {
    setSourceBatchCount((previous) => previous + 1);
  };

  return { handleModeSelect, handleSearchChange, loadMoreSources, toggleSource };
};

const useGridSourceController = ({
  articles,
  controlledViewMode,
  isFavorite,
  onViewModeChange,
}: Readonly<GridSourceControllerOptions>) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [uncontrolledViewMode, setUncontrolledViewMode] = useState<GridViewMode>(
    () => controlledViewMode ?? getStoredGridViewMode(),
  );
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [sourceBatchCount, setSourceBatchCount] = useState(1);
  const viewMode = controlledViewMode ?? uncontrolledViewMode;
  const sourceData = useGridSourceData({
    articles,
    isFavorite,
    searchTerm,
    sourceBatchCount,
    viewMode,
  });
  const sourceActions = useGridSourceActions({
    onViewModeChange,
    setExpandedSourceId,
    setSearchTerm,
    setSourceBatchCount,
    setUncontrolledViewMode,
  });

  useEffect(() => {
    if (!controlledViewMode) {
      setStoredGridViewMode(viewMode);
    }
  }, [controlledViewMode, viewMode]);

  return {
    expandedSourceId,
    ...sourceData,
    ...sourceActions,
    searchTerm,
    viewMode,
  };
};

export { useGridSourceController };
