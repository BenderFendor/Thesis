"use client";

import { ChevronUp, Newspaper } from "lucide-react";
import type { ClusterArticle, NewsArticle, TrendingCluster } from "@/lib/api";
import type { DeepReadonly, ReadonlyNewsArticle } from "@/app/search/research/model/types";
import { GridViewSearchBar, ModeSwitcher } from "./grid-view-controls";
import { MoreSourcesButton, TopicFeed, TrendingSection } from "./grid-view-topic-feed";
import {
  ArticleDetailModal,
  ClusterDetailModal,
  GridViewNoSignals,
  VIRTUALIZED_FALLBACK,
  VirtualizedGrid,
} from "./grid-view-async-components";
import { Suspense, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { GridViewMode } from "@/lib/view-mode-storage";
import { SourceGroupSection } from "./grid-view-source";
import type { TopicFeedProps } from "./grid-view-topic-feed";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type GridChangeEvent = Readonly<{ target: Readonly<{ value: string }> }>;
type GridSourceGroup = Readonly<Omit<Parameters<typeof SourceGroupSection>[0]["group"], "articles">> & {
  readonly articles: readonly ReadonlyNewsArticle[];
};

type ReadonlyTrendingCluster = DeepReadonly<TrendingCluster>;

const copyGridGdeltContext = (
  context: DeepReadonly<NonNullable<ClusterArticle["gdelt_context"]>>,
): NonNullable<ClusterArticle["gdelt_context"]> => ({
  goldstein_avg: context.goldstein_avg,
  goldstein_bucket: context.goldstein_bucket,
  goldstein_max: context.goldstein_max,
  goldstein_min: context.goldstein_min,
  tone_avg: context.tone_avg,
  tone_baseline_avg: context.tone_baseline_avg,
  tone_delta_vs_cluster: context.tone_delta_vs_cluster,
  top_cameo: context.top_cameo?.map((cameo) => ({
    code: cameo.code,
    count: cameo.count,
    label: cameo.label,
  })),
  total_events: context.total_events,
});

const copyGridClusterArticle = (article: DeepReadonly<ClusterArticle>): ClusterArticle => ({
  author: article.author,
  authors: (() => {
  if (article.authors) {
    return [...article.authors];
  }
  return void 0;
})(),
  gdelt_context: (() => {
  if (article.gdelt_context) {
    return copyGridGdeltContext(article.gdelt_context);
  }
  return null;
})(),
  id: article.id,
  image_url: article.image_url,
  published_at: article.published_at,
  similarity: article.similarity,
  source: article.source,
  source_id: article.source_id,
  summary: article.summary,
  title: article.title,
  url: article.url,
});

const copyGridTrendingCluster = (cluster: ReadonlyTrendingCluster): TrendingCluster => ({
  article_count: cluster.article_count,
  articles: cluster.articles?.map(copyGridClusterArticle),
  cluster_id: cluster.cluster_id,
  gdelt_context: (() => {
  if (cluster.gdelt_context) {
    return copyGridGdeltContext(cluster.gdelt_context);
  }
  return null;
})(),
  keywords: [...cluster.keywords],
  label: cluster.label,
  representative_article: (() => {
  if (cluster.representative_article) {
    return copyGridClusterArticle(cluster.representative_article);
  }
  return null;
})(),
  source_diversity: cluster.source_diversity,
  trending_score: cluster.trending_score,
  velocity: cluster.velocity,
  window_count: cluster.window_count,
});

const NOOP_FETCH_NEXT_PAGE = () => {};

interface VirtualizedModeViewProps {
  readonly searchTerm: string;
  readonly empty: boolean;
  readonly displayArticles: readonly ReadonlyNewsArticle[];
  readonly resolvedTotalCount: number;
  readonly isArticleModalOpen: boolean;
  readonly selectedArticle: ReadonlyNewsArticle | null;
  readonly onSearchChange: (event: GridChangeEvent) => void;
  readonly onArticleClick: (article: NewsArticle, context: readonly NewsArticle[]) => void;
  readonly onModalClose: () => void;
  readonly onModalNavigate: (direction: "prev" | "next") => void;
}

const VirtualizedSearchHeader = ({
  searchTerm,
  onSearchChange,
}: Readonly<Pick<VirtualizedModeViewProps, "onSearchChange" | "searchTerm">>) => (
  <div className="sticky top-0 z-10 border-b border-white/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
    <GridViewSearchBar value={searchTerm} variant="virtualized" onChange={onSearchChange} />
  </div>
);

const VirtualizedEmptyState = () => (
  <div className="flex flex-1 items-center justify-center py-16 text-center">
    <Newspaper className="mx-auto mb-4 h-10 w-10 text-muted-foreground/30" />
    <h3 className="font-serif text-2xl text-foreground/50">No articles found</h3>
  </div>
);

const VirtualizedModeView = (props: Readonly<VirtualizedModeViewProps>) => {
  const { displayArticles, onArticleClick } = props;
  const virtualizedArticles = useMemo(() => [...displayArticles], [displayArticles]);
  const handleArticleClick = useCallback(
    (article: NewsArticle) => {
      onArticleClick(article, displayArticles);
    },
    [displayArticles, onArticleClick],
  );
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <VirtualizedSearchHeader
        searchTerm={props.searchTerm}
        onSearchChange={props.onSearchChange}
      />
      {(() => {
  if (props.empty) {
    return <VirtualizedEmptyState />;
  }
  return <Suspense fallback={VIRTUALIZED_FALLBACK}>
          <VirtualizedGrid articles={virtualizedArticles} hasNextPage={false} isFetchingNextPage={false} fetchNextPage={NOOP_FETCH_NEXT_PAGE} onArticleClick={handleArticleClick} totalCount={props.resolvedTotalCount} />
        </Suspense>;
})()}
      {Boolean(props.isArticleModalOpen && props.selectedArticle) && <ArticleDetailModal article={props.selectedArticle} isOpen={props.isArticleModalOpen} onClose={props.onModalClose} onNavigate={props.onModalNavigate} />}
    </div>
  );
};

interface GridViewHeaderProps {
  readonly searchTerm: string;
  readonly viewMode: GridViewMode;
  readonly clusterWindow: "1d" | "1w" | "1m";
  readonly onSearchChange: (event: GridChangeEvent) => void;
  readonly onModeSelect: (mode: GridViewMode) => void;
  readonly onClusterWindow: (value: "1d" | "1w" | "1m") => void;
}

const GridViewHeader = (props: Readonly<GridViewHeaderProps>) => (
  <div className="sticky top-0 z-40 shrink-0 bg-background/80 backdrop-blur-xl">
    <div className="mx-auto flex w-full flex-col gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
      <GridViewSearchBar
        value={props.searchTerm}
        variant="main"
        onChange={props.onSearchChange}
      />
      <ModeSwitcher
        viewMode={props.viewMode}
        clusterWindow={props.clusterWindow}
        onModeSelect={props.onModeSelect}
        onClusterWindow={props.onClusterWindow}
      />
    </div>
  </div>
);

interface GridViewSourceResultProps {
  readonly expandedSourceId: string | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly onArticleClick: (article: NewsArticle, context: readonly NewsArticle[]) => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
  readonly onToggleFavorite: (sourceId: string) => void;
  readonly onToggleExpand: (sourceId: string) => void;
}

interface SourceGroupResultProps {
  readonly group: GridSourceGroup;
  readonly source: Readonly<GridViewSourceResultProps>;
}

const SourceGroupResult = ({ group, source }: SourceGroupResultProps) => {
  const {
    expandedSourceId,
    isArticleInQueue,
    isFavorite,
    likedIds,
    onArticleClick: handleArticleClick,
    onLike: handleLike,
    onQueueToggle: handleQueueToggle,
    onToggleExpand: handleExpand,
    onToggleFavorite: handleFavorite,
  } = source;
  const handleToggleExpand = useCallback(() => {
    handleExpand(group.sourceId);
  }, [group.sourceId, handleExpand]);
  return (
    <SourceGroupSection
      group={group}
      isExpanded={expandedSourceId === group.sourceId}
      likedIds={likedIds}
      isArticleInQueue={isArticleInQueue}
      isFavorite={isFavorite}
      onArticleClick={handleArticleClick}
      onLike={handleLike}
      onQueueToggle={handleQueueToggle}
      onToggleFavorite={handleFavorite}
      onToggleExpand={handleToggleExpand}
    />
  );
};

interface GridViewResultsProps {
  readonly showTrending: boolean;
  readonly viewMode: GridViewMode;
  readonly displayArticles: readonly ReadonlyNewsArticle[];
  readonly isLoadingState: boolean;
  readonly visibleSourceGroups: readonly GridSourceGroup[];
  readonly source: Readonly<GridViewSourceResultProps>;
  readonly topic: Readonly<TopicFeedProps>;
  readonly hasMoreSourceGroups: boolean;
  readonly visibleSourceCount: number;
  readonly totalSourceCount: number;
  readonly onLoadMoreSources: () => void;
}

const GridViewTopicFeed = ({
  topic,
}: Readonly<Pick<GridViewResultsProps, "topic">>) => {
  const {
    onArticleClick: handleArticleClick,
    onCloseExpanded: handleCloseExpanded,
    onCompare: handleCompare,
    onExpand: handleExpand,
    onLike: handleLike,
    onQueueToggle: handleQueueToggle,
  } = topic;
  return (
    <TopicFeed
      clusters={topic.clusters}
      clustersLoading={topic.clustersLoading}
      clustersStatus={topic.clustersStatus}
      expandedCluster={topic.expandedCluster}
      expandedClusterArticles={topic.expandedClusterArticles}
      expandedClusterId={topic.expandedClusterId}
      getDisplayLabel={topic.getDisplayLabel}
      isArticleInQueue={topic.isArticleInQueue}
      likedIds={topic.likedIds}
      onArticleClick={handleArticleClick}
      onCloseExpanded={handleCloseExpanded}
      onCompare={handleCompare}
      onExpand={handleExpand}
      onLike={handleLike}
      onQueueToggle={handleQueueToggle}
      sortedClusters={topic.sortedClusters}
    />
  );
};

const GridViewResults = (props: Readonly<GridViewResultsProps>) => {
  const empty = props.displayArticles.length === 0 && !props.isLoadingState;
  const { onLoadMoreSources: handleLoadMoreSources } = props;
  return (
    <div className="mx-auto flex w-full flex-col gap-5 px-3 py-4 sm:gap-10 sm:px-6 sm:py-6 lg:gap-16 lg:px-8 lg:py-8">
      <TrendingSection showTrending={props.showTrending} viewMode={props.viewMode} />
      {(() => {
  if (empty) {
    return <GridViewNoSignals />;
  }
  return (() => {
    if (props.viewMode === "source") {
      return props.visibleSourceGroups.map(group => <SourceGroupResult key={group.sourceId} group={group} source={props.source} />);
    }
    return <GridViewTopicFeed topic={props.topic} />;
  })();
})()}
      {props.viewMode === "source" && props.hasMoreSourceGroups && <MoreSourcesButton visible={props.visibleSourceCount} total={props.totalSourceCount} onLoadMore={handleLoadMoreSources} />}
    </div>
  );
};

interface GridViewModalOverlayProps {
  readonly isArticleModalOpen: boolean;
  readonly selectedArticle: ReadonlyNewsArticle | null;
  readonly onArticleModalClose: () => void;
  readonly onArticleModalNavigate: (direction: "prev" | "next") => void;
  readonly showScrollTop: boolean;
  readonly onScrollToTop: () => void;
  readonly isClusterModalOpen: boolean;
  readonly selectedCluster: ReadonlyTrendingCluster | null;
  readonly onClusterModalClose: () => void;
}

const GridViewModalOverlays = ({
  isArticleModalOpen,
  selectedArticle,
  onArticleModalClose,
  onArticleModalNavigate,
  showScrollTop,
  onScrollToTop,
  isClusterModalOpen,
  selectedCluster,
  onClusterModalClose,
}: Readonly<GridViewModalOverlayProps>) => {
  const mutableCluster = useMemo(
    () => ((() => {
  if (selectedCluster) {
    return copyGridTrendingCluster(selectedCluster);
  }
  return null;
})()),
    [selectedCluster],
  );
  return (
    <>
      {Boolean(isArticleModalOpen && selectedArticle) && <ArticleDetailModal article={selectedArticle} isOpen={isArticleModalOpen} onClose={onArticleModalClose} onNavigate={onArticleModalNavigate} />}
      {showScrollTop && <Button type="button" size="icon" onClick={onScrollToTop} className="absolute bottom-8 right-8 z-40 h-12 w-12 rounded-full border border-white/10 bg-background/85 shadow-xl backdrop-blur">
          <ChevronUp className="h-5 w-5" />
        </Button>}
      {Boolean(isClusterModalOpen && mutableCluster) && <ClusterDetailModal cluster={mutableCluster} isBreaking={false} isOpen={isClusterModalOpen} onClose={onClusterModalClose} />}
    </>
  );
};

interface GridViewContentProps {
  readonly searchTerm: string;
  readonly viewMode: GridViewMode;
  readonly clusterWindow: "1d" | "1w" | "1m";
  readonly onSearchChange: (event: GridChangeEvent) => void;
  readonly onModeSelect: (mode: GridViewMode) => void;
  readonly onClusterWindow: (value: "1d" | "1w" | "1m") => void;
  readonly setContainerElement: (element: HTMLDivElement | null) => void;
  readonly results: Readonly<GridViewResultsProps>;
  readonly overlays: Readonly<GridViewModalOverlayProps>;
}

const GridViewOverlayView = ({
  overlays,
}: Readonly<Pick<GridViewContentProps, "overlays">>) => {
  const {
    onArticleModalClose: handleArticleModalClose,
    onArticleModalNavigate: handleArticleModalNavigate,
    onClusterModalClose: handleClusterModalClose,
    onScrollToTop: handleScrollToTop,
  } = overlays;
  return (
    <GridViewModalOverlays
      isArticleModalOpen={overlays.isArticleModalOpen}
      isClusterModalOpen={overlays.isClusterModalOpen}
      onArticleModalClose={handleArticleModalClose}
      onArticleModalNavigate={handleArticleModalNavigate}
      onClusterModalClose={handleClusterModalClose}
      onScrollToTop={handleScrollToTop}
      selectedArticle={overlays.selectedArticle}
      selectedCluster={overlays.selectedCluster}
      showScrollTop={overlays.showScrollTop}
    />
  );
};

const GridViewContent = ({
  searchTerm,
  viewMode,
  clusterWindow,
  onSearchChange,
  onModeSelect,
  onClusterWindow,
  setContainerElement,
  results,
  overlays,
}: Readonly<GridViewContentProps>) => {
  const { onLoadMoreSources: handleLoadMoreSources } = results;
  return (
    <div className="relative flex w-full flex-col overflow-hidden bg-background lg:h-[calc(100vh-140px)]">
      <GridViewHeader
        searchTerm={searchTerm}
        viewMode={viewMode}
        clusterWindow={clusterWindow}
        onSearchChange={onSearchChange}
        onModeSelect={onModeSelect}
        onClusterWindow={onClusterWindow}
      />
      <div ref={setContainerElement} className="scroll-smooth pb-24 lg:flex-1 lg:overflow-y-auto">
        <GridViewResults
          displayArticles={results.displayArticles}
          hasMoreSourceGroups={results.hasMoreSourceGroups}
          isLoadingState={results.isLoadingState}
          onLoadMoreSources={handleLoadMoreSources}
          showTrending={results.showTrending}
          source={results.source}
          topic={results.topic}
          totalSourceCount={results.totalSourceCount}
          viewMode={results.viewMode}
          visibleSourceCount={results.visibleSourceCount}
          visibleSourceGroups={results.visibleSourceGroups}
        />
      </div>
      <GridViewOverlayView overlays={overlays} />
    </div>
  );
};

export { GridViewContent, VirtualizedModeView };
