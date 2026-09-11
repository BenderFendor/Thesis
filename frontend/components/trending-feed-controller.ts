import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";
import { fetchBreaking, fetchTrending } from "@/lib/api";
import type { BreakingResponse, ReadonlyNewsArticle, TrendingResponse } from "@/lib/api";
import { filterTrendingClusters } from "@/lib/cluster-display";
import { deduplicateClusters } from "./trending-feed-helpers";
import type {
  MousePropagationEvent,
  ReadonlyBreakingCluster,
  ReadonlyTrendingCluster,
  TrendingWindow,
} from "./trending-feed-helpers";

const useTrendingFeedQueries = (trendingWindow: TrendingWindow) => {
  const trendingQuery = useQuery<TrendingResponse>({
    queryFn: () => fetchTrending(trendingWindow, 10),
    queryKey: ["trending-feed", trendingWindow, 10],
    refetchInterval: 60_000 * 5,
    retry: 1,
  });
  const breakingQuery = useQuery<BreakingResponse>({
    queryFn: () => fetchBreaking(5),
    queryKey: ["breaking-feed", 5],
    refetchInterval: 60_000 * 5,
    retry: 1,
  });
  return {
    breakingData: breakingQuery.data ?? null,
    isLoading: trendingQuery.isLoading || breakingQuery.isLoading,
    trendingData: trendingQuery.data ?? null,
  };
};

const useTrendingFeedData = () => {
  const [trendingWindow, setTrendingWindow] = useState<TrendingWindow>("1d");
  const queries = useTrendingFeedQueries(trendingWindow);
  const breakingClusters = deduplicateClusters(queries.breakingData?.clusters ?? []);
  const trendingClusters = deduplicateClusters(
    filterTrendingClusters(queries.trendingData?.clusters ?? [], breakingClusters),
  );
  return {
    breakingClusters,
    handleWindowChange: setTrendingWindow,
    showSkeleton: queries.isLoading && !queries.trendingData,
    trendingClusters,
    trendingWindow,
  };
};

const useTrendingModalActions = () => {
  const [selectedCluster, setSelectedCluster] = useState<
    ReadonlyTrendingCluster | ReadonlyBreakingCluster | null
  >(null);
  const [isBreakingCluster, setIsBreakingCluster] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const handleClusterClick = useCallback(
    (cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster, isBreaking: boolean) => {
      setSelectedCluster(cluster);
      setIsBreakingCluster(isBreaking);
      setIsModalOpen(true);
    },
    [],
  );
  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setSelectedCluster(null);
  }, []);
  return {
    handleClusterClick,
    handleModalClose,
    isBreakingCluster,
    isModalOpen,
    selectedCluster,
  };
};

const useTrendingArticleActions = () => {
  const { likedIds, toggleLike } = useLikedArticles();
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
  const handleQueueToggle = useCallback(
    (article: ReadonlyNewsArticle, event: MousePropagationEvent) => {
      event.stopPropagation();
      if (isArticleInQueue(article.url)) {
        void removeArticleFromQueue(article.url);
        return;
      }
      void addArticleToQueue(article);
    },
    [addArticleToQueue, isArticleInQueue, removeArticleFromQueue],
  );
  const handleLike = useCallback(
    (articleId: number, event: MousePropagationEvent) => {
      event.stopPropagation();
      void toggleLike(articleId);
    },
    [toggleLike],
  );
  return {
    handleLike,
    handleQueueToggle,
    isArticleInQueue,
    likedIds,
  };
};

const useTrendingFeedActions = () => {
  const modal = useTrendingModalActions();
  const articles = useTrendingArticleActions();
  return { ...articles, ...modal };
};

export { useTrendingFeedActions, useTrendingFeedData };
