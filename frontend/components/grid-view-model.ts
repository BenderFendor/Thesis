import type { AllCluster, NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/app/search/research/model/types";
import { useFavorites } from "@/hooks/use-favorites";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";
import { useCallback, useMemo, useState } from "react";
import type { GridViewMode } from "@/lib/view-mode-storage";
import { useGridModalController } from "./grid-view-modal-controller";
import { useGridSourceController } from "./grid-view-source-controller";
import { useGridTopicController } from "./grid-view-topic-controller";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type ReadonlyGridCluster = DeepReadonly<AllCluster>;
type GridClusterWindow = "1d" | "1w" | "1m";
type GridTopicSortMode = "sources" | "articles" | "recent";

interface GridViewProps {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
  readonly apiUrl?: string | null;
  readonly useVirtualization?: boolean;
  readonly showTrending?: boolean;
  readonly topicSortMode?: GridTopicSortMode;
  readonly viewMode?: GridViewMode;
  readonly onViewModeChange?: (mode: GridViewMode) => void;
  readonly isScrollMode?: boolean;
  readonly totalCount?: number;
}

const formatGridKeywordLabel = (keywords?: readonly string[]): string => {
  if (!keywords || keywords.length === 0) {
    return "";
  }
  return keywords.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
};

const normalizeGridLabel = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

const stripGridTitleSuffix = (value: string): string =>
  value.split(/\s[-|\u2013\u2014]\s/u)[0]?.trim() ?? "";

const getGridTitleCandidate = (cluster: ReadonlyGridCluster): string => {
  const title = cluster.representative_article?.title;
  const trimmedTitle = title?.trim() ?? "";
  if (trimmedTitle.length > 0) {
    return stripGridTitleSuffix(trimmedTitle);
  }
  return "";
};

const getGridClusterDisplayLabel = (cluster: ReadonlyGridCluster): string => {
  const label = cluster.label?.trim() ?? "";
  const keywordLabel = formatGridKeywordLabel(cluster.keywords);
  const titleCandidate = getGridTitleCandidate(cluster);
  const normalizedLabel = normalizeGridLabel(label);
  const normalizedKeywords = normalizeGridLabel(keywordLabel);
  const labelsMatch = Boolean(
    titleCandidate && normalizedLabel && normalizedKeywords && normalizedLabel === normalizedKeywords,
  );
  if (labelsMatch) {
    return titleCandidate;
  }
  return label || titleCandidate || keywordLabel || "Topic";
};

const useGridViewActions = () => {
  const { likedIds, toggleLike } = useLikedArticles();
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
  const { isFavorite, toggleFavorite } = useFavorites();
  const handleLike = useCallback(
    (articleId: number, event?: GridButtonEvent): void => {
      event?.stopPropagation();
      void toggleLike(articleId);
    },
    [toggleLike],
  );
  const handleQueueToggle = useCallback(
    (article: NewsArticle, event?: GridButtonEvent): void => {
      event?.stopPropagation();
      if (isArticleInQueue(article.url)) {
        void removeArticleFromQueue(article.url);
      } else {
        void addArticleToQueue(article);
      }
    },
    [addArticleToQueue, isArticleInQueue, removeArticleFromQueue],
  );
  return { handleLike, handleQueueToggle, isArticleInQueue, isFavorite, likedIds, toggleFavorite };
};

type GridViewActions = ReturnType<typeof useGridViewActions>;

const useGridControllerState = (
  props: Readonly<GridViewProps>,
  isFavorite: GridViewActions["isFavorite"],
) => {
  const source = useGridSourceController({
    articles: props.articles,
    controlledViewMode: props.viewMode,
    isFavorite,
    onViewModeChange: props.onViewModeChange,
  });
  const [clusterWindow, setClusterWindow] = useState<GridClusterWindow>("1w");
  const topic = useGridTopicController({
    clusterWindow,
    topicSortMode: props.topicSortMode ?? "sources",
    viewMode: source.viewMode,
  });
  const modal = useGridModalController();
  return { clusterWindow, modal, setClusterWindow, source, topic };
};

type GridControllerState = ReturnType<typeof useGridControllerState>;
type GridSourceController = GridControllerState["source"];
type GridTopicController = GridControllerState["topic"];
type GridModalController = GridControllerState["modal"];
type GridModalView = DeepReadonly<
  Pick<
    GridModalController,
    | "closeClusterModal"
    | "handleArticleClick"
    | "handleModalClose"
    | "handleModalNavigate"
    | "handleOpenClusterCompare"
    | "isArticleModalOpen"
    | "isClusterModalOpen"
    | "scrollToTop"
    | "selectedArticle"
    | "selectedCluster"
    | "showScrollTop"
  >
>;

const useGridSourceResult = (
  source: DeepReadonly<GridSourceController>,
  actions: DeepReadonly<GridViewActions>,
  modal: GridModalView,
) =>
  useMemo(
    () => ({
      expandedSourceId: source.expandedSourceId,
      isArticleInQueue: actions.isArticleInQueue,
      isFavorite: actions.isFavorite,
      likedIds: actions.likedIds,
      onArticleClick: modal.handleArticleClick,
      onLike: actions.handleLike,
      onQueueToggle: actions.handleQueueToggle,
      onToggleExpand: source.toggleSource,
      onToggleFavorite: actions.toggleFavorite,
    }),
    [
      actions.handleLike,
      actions.handleQueueToggle,
      actions.isArticleInQueue,
      actions.isFavorite,
      actions.likedIds,
      actions.toggleFavorite,
      modal.handleArticleClick,
      source.expandedSourceId,
      source.toggleSource,
    ],
  );

type GridSourceResult = ReturnType<typeof useGridSourceResult>;

const useGridTopicResult = (
  topic: DeepReadonly<GridTopicController>,
  actions: DeepReadonly<GridViewActions>,
  modal: GridModalView,
  onCloseExpanded: () => void,
) =>
  useMemo(
    () => ({
      clusters: topic.clusters,
      clustersLoading: topic.clustersLoading,
      clustersStatus: topic.clustersStatus,
      expandedCluster: topic.expandedCluster ?? null,
      expandedClusterArticles: topic.expandedClusterArticles,
      expandedClusterId: topic.expandedClusterId,
      getDisplayLabel: getGridClusterDisplayLabel,
      isArticleInQueue: actions.isArticleInQueue,
      likedIds: actions.likedIds,
      onArticleClick: modal.handleArticleClick,
      onCloseExpanded,
      onCompare: modal.handleOpenClusterCompare,
      onExpand: topic.handleExpandCluster,
      onLike: actions.handleLike,
      onQueueToggle: actions.handleQueueToggle,
      sortedClusters: topic.sortedClusters,
    }),
    [
      actions.handleLike,
      actions.handleQueueToggle,
      actions.isArticleInQueue,
      actions.likedIds,
      modal.handleArticleClick,
      modal.handleOpenClusterCompare,
      onCloseExpanded,
      topic.clusters,
      topic.clustersLoading,
      topic.clustersStatus,
      topic.expandedCluster,
      topic.expandedClusterArticles,
      topic.expandedClusterId,
      topic.handleExpandCluster,
      topic.sortedClusters,
    ],
  );

type GridTopicResult = ReturnType<typeof useGridTopicResult>;

interface GridResultsOptions {
  readonly displayArticles: readonly NewsArticle[];
  readonly hasMoreSourceGroups: boolean;
  readonly isLoadingState: boolean;
  readonly onLoadMoreSources: () => void;
  readonly showTrending: boolean;
  readonly source: Readonly<GridSourceResult>;
  readonly topic: Readonly<GridTopicResult>;
  readonly totalSourceCount: number;
  readonly viewMode: GridViewMode;
  readonly visibleSourceCount: number;
  readonly visibleSourceGroups: GridSourceController["visibleSourceGroups"];
}

const useGridResultsModel = ({
  displayArticles,
  hasMoreSourceGroups,
  isLoadingState,
  onLoadMoreSources,
  showTrending,
  source,
  topic,
  totalSourceCount,
  viewMode,
  visibleSourceCount,
  visibleSourceGroups,
}: DeepReadonly<GridResultsOptions>) =>
  useMemo(
    () => ({
      displayArticles,
      hasMoreSourceGroups,
      isLoadingState,
      onLoadMoreSources,
      showTrending,
      source,
      topic,
      totalSourceCount,
      viewMode,
      visibleSourceCount,
      visibleSourceGroups,
    }),
    [
      displayArticles,
      hasMoreSourceGroups,
      isLoadingState,
      onLoadMoreSources,
      showTrending,
      source,
      topic,
      totalSourceCount,
      viewMode,
      visibleSourceCount,
      visibleSourceGroups,
    ],
  );

const useGridOverlays = (modal: GridModalView) =>
  useMemo(
    () => ({
      isArticleModalOpen: modal.isArticleModalOpen,
      isClusterModalOpen: modal.isClusterModalOpen,
      onArticleModalClose: modal.handleModalClose,
      onArticleModalNavigate: modal.handleModalNavigate,
      onClusterModalClose: modal.closeClusterModal,
      onScrollToTop: modal.scrollToTop,
      selectedArticle: modal.selectedArticle,
      selectedCluster: modal.selectedCluster,
      showScrollTop: modal.showScrollTop,
    }),
    [
      modal.closeClusterModal,
      modal.handleModalClose,
      modal.handleModalNavigate,
      modal.isArticleModalOpen,
      modal.isClusterModalOpen,
      modal.scrollToTop,
      modal.selectedArticle,
      modal.selectedCluster,
      modal.showScrollTop,
    ],
  );

type GridResultsModel = ReturnType<typeof useGridResultsModel>;
type GridOverlays = ReturnType<typeof useGridOverlays>;
type GridContentState = Readonly<{
  readonly clusterWindow: GridClusterWindow;
  readonly modal: Pick<GridModalController, "setContainerElement">;
  readonly setClusterWindow: GridControllerState["setClusterWindow"];
  readonly source: Pick<
    GridSourceController,
    "handleModeSelect" | "handleSearchChange" | "searchTerm" | "viewMode"
  >;
}>;
type GridVirtualizedState = Readonly<{
  readonly modal: GridModalView;
  readonly source: Pick<GridSourceController, "handleSearchChange" | "searchTerm">;
}>;

interface GridContentPropsOptions {
  readonly overlays: GridOverlays;
  readonly results: GridResultsModel;
  readonly state: GridContentState;
}

const getGridContentProps = ({
  overlays,
  results,
  state,
}: DeepReadonly<GridContentPropsOptions>) => ({
  clusterWindow: state.clusterWindow,
  onClusterWindow: state.setClusterWindow,
  onModeSelect: state.source.handleModeSelect,
  onSearchChange: state.source.handleSearchChange,
  overlays,
  results,
  searchTerm: state.source.searchTerm,
  setContainerElement: state.modal.setContainerElement,
  viewMode: state.source.viewMode,
});

interface GridVirtualizedPropsOptions {
  readonly displayArticles: readonly NewsArticle[];
  readonly loading: boolean;
  readonly state: GridVirtualizedState;
  readonly totalCount?: number;
}

const getGridVirtualizedProps = ({
  displayArticles,
  loading,
  state,
  totalCount,
}: DeepReadonly<GridVirtualizedPropsOptions>) => {
  const resolvedTotalCount = totalCount ?? displayArticles.length;
  return {
    displayArticles,
    empty: displayArticles.length === 0 && !loading,
    isArticleModalOpen: state.modal.isArticleModalOpen,
    onArticleClick: state.modal.handleArticleClick,
    onModalClose: state.modal.handleModalClose,
    onModalNavigate: state.modal.handleModalNavigate,
    onSearchChange: state.source.handleSearchChange,
    resolvedTotalCount,
    searchTerm: state.source.searchTerm,
    selectedArticle: state.modal.selectedArticle,
  };
};

const useGridViewContentModel = (
  props: Readonly<GridViewProps>,
  actions: Readonly<GridViewActions>,
) => {
  const state = useGridControllerState(props, actions.isFavorite);
  const { setExpandedClusterId } = state.topic;
  const closeExpandedCluster = useCallback(() => {
    setExpandedClusterId(null);
  }, [setExpandedClusterId]);
  const sourceResult = useGridSourceResult(state.source, actions, state.modal);
  const topicResult = useGridTopicResult(state.topic, actions, state.modal, closeExpandedCluster);
  const displayArticles = state.source.filteredNews;
  const results = useGridResultsModel({
    displayArticles,
    hasMoreSourceGroups: state.source.hasMoreSourceGroups,
    isLoadingState: props.loading,
    onLoadMoreSources: state.source.loadMoreSources,
    showTrending: props.showTrending ?? true,
    source: sourceResult,
    topic: topicResult,
    totalSourceCount: state.source.sortedSourceIds.length,
    viewMode: state.source.viewMode,
    visibleSourceCount: state.source.visibleSourceIds.size,
    visibleSourceGroups: state.source.visibleSourceGroups,
  });
  const overlays = useGridOverlays(state.modal);
  return {
    content: getGridContentProps({ overlays, results, state }),
    displayArticles,
    isLoadingState: props.loading,
    virtualized: getGridVirtualizedProps({
      displayArticles,
      loading: props.loading,
      state,
      totalCount: props.totalCount,
    }),
  };
};

const useGridViewModel = (props: Readonly<GridViewProps>) => {
  const actions = useGridViewActions();
  return useGridViewContentModel(props, actions);
};

export { useGridViewModel };
export type { GridViewProps };
