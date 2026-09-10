"use client";

import { ClusterDetailModal } from "./cluster-detail-modal";
import { TrendingFeedContent } from "./trending-feed-content";
import { useTrendingFeedActions, useTrendingFeedData } from "./trending-feed-controller";
import { TrendingSkeleton } from "./trending-feed-skeleton";

const TrendingFeed = () => {
  const data = useTrendingFeedData();
  const actions = useTrendingFeedActions();

  if (data.showSkeleton) {
    return <TrendingSkeleton />;
  }
  return (
    <>
      <TrendingFeedContent
        breakingClusters={data.breakingClusters}
        isInQueue={actions.isArticleInQueue}
        isLiked={actions.likedIds}
        onClusterClick={actions.handleClusterClick}
        onLike={actions.handleLike}
        onQueueToggle={actions.handleQueueToggle}
        onWindowChange={data.handleWindowChange}
        trendingClusters={data.trendingClusters}
        trendingWindow={data.trendingWindow}
      />
      <ClusterDetailModal
        cluster={actions.selectedCluster}
        isBreaking={actions.isBreakingCluster}
        isOpen={actions.isModalOpen}
        onClose={actions.handleModalClose}
      />
    </>
  );
};

export { TrendingFeed };
