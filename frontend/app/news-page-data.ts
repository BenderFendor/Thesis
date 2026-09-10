import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCacheStatus, fetchCategories, fetchSources } from "@/lib/api";
import { NEWS_LENSES, filterArticlesByLens, getLensSourceIds } from "@/lib/news-lens";
import { useNewsIndex } from "@/hooks/use-news-index";
import {
  getSharedArticleCount,
  getSharedSourceCount,
  getSharedViewArticles,
  getSharedViewLoading,
} from "@/lib/news-view-state";
import { useDismissedNotifications } from "@/lib/notification-state";
import {
  EMPTY_SOURCES,
  buildNotifications,
  combineSourceIds,
  getSourceRecency,
  sortNewsArticles,
} from "@/app/news-page-model";
import type {
  ArticleSortMode,
  CategoryOption,
  ReadonlyNewsArticleList,
  ReadonlyNewsSourceList,
  ReadonlyNotificationList,
  SourceRecency,
} from "@/app/news-page-model";
import type { NewsPageState } from "@/app/news-page-state";
import type { ViewMode } from "@/components/global-navigation";

interface NewsPageQueryData {
  readonly selectedSourceIds: readonly string[];
  readonly sources: ReadonlyNewsSourceList;
  readonly categories: readonly CategoryOption[];
  readonly browseIndexArticles: ReadonlyNewsArticleList;
  readonly browseIndexTotalCount: number;
  readonly browseIndexLoading: boolean;
  readonly browseIndexError: Error | null;
  readonly refetchBrowseIndex: () => void;
  readonly cacheStatus: Awaited<ReturnType<typeof fetchCacheStatus>> | undefined;
}

const useCategoriesQuery = (): CategoryOption[] => {
  const categoriesQuery = useQuery<string[]>({
    queryFn: fetchCategories,
    queryKey: ["categories"],
    retry: 1,
  });
  return useMemo(() => {
    const backendCategories = categoriesQuery.data ?? [];
    const uniqueCategories = [...new Set(["all", ...backendCategories])];
    return uniqueCategories.map((category) => ({
      id: category,
      label: category.charAt(0).toUpperCase() + category.slice(1),
    }));
  }, [categoriesQuery.data]);
};

const useCacheStatusQuery = () => {
  const { data: cacheStatus } = useQuery({
    gcTime: 5 * 60 * 1000,
    queryFn: fetchCacheStatus,
    queryKey: ["news", "cache-status"],
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 1000,
  });
  return cacheStatus;
};

const useSelectedSourcesQuery = (
  selectedSources: ReadonlySet<string>,
  lens: NewsPageState["lens"],
) => {
  const selectedSourceIds = useMemo(() => [...selectedSources], [selectedSources]);
  const sourcesQuery = useQuery({
    queryFn: fetchSources,
    queryKey: ["all-sources"],
    retry: 1,
    staleTime: 60 * 1000,
  });
  const sources = sourcesQuery.data ?? EMPTY_SOURCES;
  const lensSourceIds = useMemo(() => getLensSourceIds(sources, lens), [lens, sources]);
  const combinedSourceIds = useMemo(
    () => combineSourceIds(lens, selectedSourceIds, lensSourceIds),
    [lens, lensSourceIds, selectedSourceIds],
  );
  return { combinedSourceIds, selectedSourceIds, sources };
};

const getNewsIndexCategory = (activeCategory: string): string | undefined => {
  if (activeCategory === "all") {
    return undefined;
  }
  return activeCategory;
};

const getNewsIndexSources = (sourceIds: readonly string[]): readonly string[] | undefined => {
  if (sourceIds.length > 0) {
    return sourceIds;
  }
  return undefined;
};

const useNewsPageQueryData = (
  state: Pick<NewsPageState, "activeCategory" | "lens" | "selectedSources">,
): NewsPageQueryData => {
  const { combinedSourceIds, selectedSourceIds, sources } = useSelectedSourcesQuery(
    state.selectedSources,
    state.lens,
  );
  const browseQuery = useNewsIndex({
    category: getNewsIndexCategory(state.activeCategory),
    enabled: true,
    mode: "live",
    sources: getNewsIndexSources(combinedSourceIds),
  });
  const cacheStatus = useCacheStatusQuery();
  const categories = useCategoriesQuery();
  return {
    browseIndexArticles: browseQuery.articles,
    browseIndexError: browseQuery.error,
    browseIndexLoading: browseQuery.isLoading,
    browseIndexTotalCount: browseQuery.totalCount,
    cacheStatus,
    categories,
    refetchBrowseIndex: browseQuery.refetch,
    selectedSourceIds,
    sources,
  };
};

interface NewsPageSortedData {
  readonly browseArticles: ReadonlyNewsArticleList;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly activeLensLabel: string;
  readonly sourceRecency: Readonly<SourceRecency>;
}

interface NewsPageSortedDataInput {
  readonly currentView: ViewMode;
  readonly sortMode: ArticleSortMode;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly lens: NewsPageState["lens"];
  readonly browseIndexArticles: ReadonlyNewsArticleList;
  readonly sources: ReadonlyNewsSourceList;
}

const useNewsPageSortedData = (props: NewsPageSortedDataInput): NewsPageSortedData => {
  const sortArticles = useCallback(
    (items: ReadonlyNewsArticleList) => sortNewsArticles(items, props.sortMode, props.isFavorite),
    [props.isFavorite, props.sortMode],
  );
  const lensFilteredArticles = useMemo(
    () => filterArticlesByLens(props.browseIndexArticles, props.sources, props.lens),
    [props.browseIndexArticles, props.lens, props.sources],
  );
  const browseArticles = useMemo(
    () => sortArticles(lensFilteredArticles),
    [lensFilteredArticles, sortArticles],
  );
  const activeViewArticles = getSharedViewArticles(props.currentView, browseArticles);
  const activeLensLabel =
    NEWS_LENSES.find((item) => item.id === props.lens)?.label ?? "All Sources";
  const sourceRecency = useMemo(() => getSourceRecency(activeViewArticles), [activeViewArticles]);
  return { activeLensLabel, activeViewArticles, browseArticles, sourceRecency };
};

interface PageNotificationsInput {
  readonly activeCategory: string;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly browseIndexError: Error | null;
  readonly browseIndexLoading: boolean;
  readonly filterActive: boolean;
  readonly loading: boolean;
  readonly selectedSourceCount: number;
}

const usePageNotifications = (props: PageNotificationsInput) =>
  useMemo(
    () =>
      buildNotifications({
        activeCategory: props.activeCategory,
        activeViewArticleCount: props.activeViewArticles.length,
        browseIndexError: props.browseIndexError,
        browseIndexLoading: props.browseIndexLoading,
        filterActive: props.filterActive,
        loading: props.loading,
        selectedSourceCount: props.selectedSourceCount,
      }),
    [
      props.activeCategory,
      props.activeViewArticles.length,
      props.browseIndexError,
      props.browseIndexLoading,
      props.filterActive,
      props.loading,
      props.selectedSourceCount,
    ],
  );

const usePageNotificationState = (notifications: ReadonlyNotificationList) => {
  const dismissed = useDismissedNotifications(notifications);
  const actionableNotificationCount = dismissed.visibleNotifications.filter(
    (item) => item.type === "error" || item.type === "warning",
  ).length;
  return {
    actionableNotificationCount,
    dismissAll: dismissed.dismissAll,
    dismissOne: dismissed.dismissOne,
    visibleNotifications: dismissed.visibleNotifications,
  };
};

interface NewsPageViewStateInput {
  readonly activeCategory: string;
  readonly currentView: ViewMode;
  readonly isFilterActive: () => boolean;
  readonly selectedSources: ReadonlySet<string>;
  readonly sortMode: ArticleSortMode;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly lens: NewsPageState["lens"];
}

interface NewsPageViewQueriesInput {
  readonly browseIndexArticles: ReadonlyNewsArticleList;
  readonly browseIndexTotalCount: number;
  readonly browseIndexLoading: boolean;
  readonly browseIndexError: Error | null;
  readonly sources: ReadonlyNewsSourceList;
  readonly cacheStatus: Awaited<ReturnType<typeof fetchCacheStatus>> | undefined;
}

interface NewsPageViewData extends NewsPageSortedData {
  readonly loading: boolean;
  readonly filterActive: boolean;
  readonly visibleNotifications: ReadonlyNotificationList;
  readonly dismissOne: (notificationId: string) => void;
  readonly dismissAll: () => void;
  readonly actionableNotificationCount: number;
  readonly leadArticle: NewsPageSortedData["activeViewArticles"][number] | null;
  readonly articleCount: number;
  readonly sourceCount: number;
}

const useNewsPageViewData = (
  state: NewsPageViewStateInput,
  queries: NewsPageViewQueriesInput,
): NewsPageViewData => {
  const sorted = useNewsPageSortedData({
    browseIndexArticles: queries.browseIndexArticles,
    currentView: state.currentView,
    isFavorite: state.isFavorite,
    lens: state.lens,
    sortMode: state.sortMode,
    sources: queries.sources,
  });
  const loading = getSharedViewLoading(queries.browseIndexLoading);
  const filterActive = state.isFilterActive();
  const notifications = usePageNotifications({
    activeCategory: state.activeCategory,
    activeViewArticles: sorted.activeViewArticles,
    browseIndexError: queries.browseIndexError,
    browseIndexLoading: queries.browseIndexLoading,
    filterActive,
    loading,
    selectedSourceCount: state.selectedSources.size,
  });
  const notificationState = usePageNotificationState(notifications);
  const leadArticle = sorted.activeViewArticles[0] ?? null;
  const articleCount = getSharedArticleCount(
    queries.cacheStatus,
    queries.browseIndexTotalCount,
    sorted.browseArticles,
    loading,
  );
  const sourceCount = getSharedSourceCount(queries.cacheStatus, sorted.browseArticles, loading);
  return {
    ...sorted,
    ...notificationState,
    articleCount,
    filterActive,
    leadArticle,
    loading,
    sourceCount,
  };
};

export { useNewsPageQueryData, useNewsPageViewData, type NewsPageQueryData, type NewsPageViewData };
