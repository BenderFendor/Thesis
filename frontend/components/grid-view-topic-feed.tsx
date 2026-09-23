"use client";

import type { AllCluster, NewsArticle } from "@/lib/api";
import { ExpandedTopicPanel, TopicClusterCard } from "./grid-view-topic";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { DeepReadonly } from "@/app/search/research/model/types";
import { Loader2 } from "lucide-react";
import { TrendingFeed } from "./trending-feed";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type ReadonlyGridCluster = DeepReadonly<AllCluster>;

interface TopicFeedProps {
  readonly clusters: readonly ReadonlyGridCluster[];
  readonly clustersLoading: boolean;
  readonly clustersStatus: string | null;
  readonly expandedCluster: ReadonlyGridCluster | null;
  readonly expandedClusterArticles: readonly NewsArticle[];
  readonly expandedClusterId: number | null;
  readonly getDisplayLabel: (cluster: ReadonlyGridCluster) => string;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onArticleClick: (article: NewsArticle, context: readonly NewsArticle[]) => void;
  readonly onCloseExpanded: () => void;
  readonly onCompare: (cluster: ReadonlyGridCluster, event: GridButtonEvent) => void;
  readonly onExpand: (cluster: ReadonlyGridCluster) => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
  readonly sortedClusters: readonly ReadonlyGridCluster[];
}

interface TopicClusterItemProps {
  readonly cluster: ReadonlyGridCluster;
  readonly expandedCluster: ReadonlyGridCluster | null;
  readonly expandedClusterArticles: readonly NewsArticle[];
  readonly expandedClusterId: number | null;
  readonly getDisplayLabel: (cluster: ReadonlyGridCluster) => string;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly index: number;
  readonly likedIds: ReadonlySet<number>;
  readonly onArticleClick: (article: NewsArticle, context: readonly NewsArticle[]) => void;
  readonly onCloseExpanded: () => void;
  readonly onCompare: (cluster: ReadonlyGridCluster, event: GridButtonEvent) => void;
  readonly onExpand: (cluster: ReadonlyGridCluster) => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
}

const TopicClusterItem = ({
  cluster,
  expandedCluster,
  expandedClusterArticles,
  expandedClusterId,
  getDisplayLabel,
  isArticleInQueue,
  index,
  likedIds,
  onArticleClick,
  onCloseExpanded,
  onCompare,
  onExpand,
  onLike,
  onQueueToggle,
}: TopicClusterItemProps) => {
  const isExpanded = expandedClusterId === cluster.cluster_id;
  const handleExpand = useCallback(() => {
    onExpand(cluster);
  }, [cluster, onExpand]);
  const handleCompare = useCallback(
    (event: GridButtonEvent) => {
      onCompare(cluster, event);
    },
    [cluster, onCompare],
  );
  const handleArticleClick = useCallback(
    (article: NewsArticle) => {
      onArticleClick(article, expandedClusterArticles);
    },
    [expandedClusterArticles, onArticleClick],
  );
  if (!cluster.representative_article) {
    return null;
  }

  return (
    <>
      <TopicClusterCard
        cluster={cluster}
        getDisplayLabel={getDisplayLabel}
        index={index}
        isExpanded={isExpanded}
        onCompare={handleCompare}
        onExpand={handleExpand}
      />
      {isExpanded && expandedCluster !== null && <ExpandedTopicPanel articles={expandedClusterArticles} cluster={expandedCluster} getDisplayLabel={getDisplayLabel} isArticleInQueue={isArticleInQueue} likedIds={likedIds} onArticleClick={handleArticleClick} onClose={onCloseExpanded} onLike={onLike} onQueueToggle={onQueueToggle} />}
    </>
  );
};

const TopicClusterGrid = ({
  clusters,
  expandedCluster,
  expandedClusterArticles,
  expandedClusterId,
  getDisplayLabel,
  isArticleInQueue,
  likedIds,
  onArticleClick,
  onCloseExpanded,
  onCompare,
  onExpand,
  onLike,
  onQueueToggle,
}: Readonly<
  Omit<TopicFeedProps, "clustersLoading" | "clustersStatus" | "sortedClusters"> & {
    readonly clusters: readonly ReadonlyGridCluster[];
  }
>) => (
  <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
    {clusters.map((cluster, index) => (
      <TopicClusterItem
        key={cluster.cluster_id}
        cluster={cluster}
        expandedCluster={expandedCluster}
        expandedClusterArticles={expandedClusterArticles}
        expandedClusterId={expandedClusterId}
        getDisplayLabel={getDisplayLabel}
        isArticleInQueue={isArticleInQueue}
        index={index}
        likedIds={likedIds}
        onArticleClick={onArticleClick}
        onCloseExpanded={onCloseExpanded}
        onCompare={onCompare}
        onExpand={onExpand}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
      />
    ))}
  </div>
);

const TopicFeedLoading = () => (
  <div className="py-24 text-center text-xs uppercase tracking-widest text-muted-foreground">
    <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary/40" />
    Mapping topic clusters...
  </div>
);

const TopicFeedEmpty = ({ status }: Readonly<{ status: string | null }>) => (
  <div className="py-24 text-center text-xs uppercase tracking-widest text-muted-foreground">
    {(() => {
  if (status === "initializing") {
    return "Building topics...";
  }
  return "No topics found";
})()}
  </div>
);

const TopicFeed = ({
  clustersLoading,
  clusters,
  clustersStatus,
  sortedClusters,
  expandedClusterId,
  expandedCluster,
  expandedClusterArticles,
  likedIds,
  isArticleInQueue,
  getDisplayLabel,
  onExpand,
  onCompare,
  onArticleClick,
  onLike,
  onQueueToggle,
  onCloseExpanded,
}: TopicFeedProps) => {
  if (clustersLoading) {
    return <TopicFeedLoading />;
  }
  if (clusters.length === 0) {
    return <TopicFeedEmpty status={clustersStatus} />;
  }
  return (
    <TopicClusterGrid
      clusters={sortedClusters}
      expandedCluster={expandedCluster}
      expandedClusterArticles={expandedClusterArticles}
      expandedClusterId={expandedClusterId}
      getDisplayLabel={getDisplayLabel}
      isArticleInQueue={isArticleInQueue}
      likedIds={likedIds}
      onArticleClick={onArticleClick}
      onCloseExpanded={onCloseExpanded}
      onCompare={onCompare}
      onExpand={onExpand}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
    />
  );
};

interface TrendingSectionProps {
  readonly showTrending: boolean;
  readonly viewMode: "source" | "topic";
}

const TrendingSection = ({ showTrending, viewMode }: TrendingSectionProps) => {
  if (!showTrending) {
    return null;
  }
  if (viewMode === "topic") {
    return (
      <div className="hidden sm:block">
        <TrendingFeed />
      </div>
    );
  }
  return <TrendingFeed />;
};

interface MoreSourcesButtonProps {
  readonly onLoadMore: () => void;
  readonly total: number;
  readonly visible: number;
}

const MoreSourcesButton = ({ visible, total, onLoadMore }: MoreSourcesButtonProps) => (
  <div className="flex justify-center pb-8">
    <Button
      variant="outline"
      onClick={onLoadMore}
      className="rounded-full border-white/10 bg-transparent px-8 py-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-all duration-300 hover:bg-white/5 hover:text-white disabled:opacity-60"
    >
      {`Load 10 more sources (${visible}/${total})`}
    </Button>
  </div>
);

export { MoreSourcesButton, TopicFeed, TrendingSection };
export type { TopicFeedProps };
