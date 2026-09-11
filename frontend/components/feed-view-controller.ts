"use client";

import { useState } from "react";
import type { NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useFavorites } from "@/hooks/use-favorites";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useScrollPersonalization } from "@/hooks/use-scroll-personalization";
import { useFeedActionHandlers } from "./feed-action-handlers";
import { useFeedRankingState } from "./feed-ranking-state";
import { useFeedScrollNavigation } from "./feed-scroll";

interface FeedViewProps {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
  readonly totalCount?: number;
  readonly debugMode?: boolean;
}

const useFeedViewData = (articles: readonly NewsArticle[]) => {
  const { likedIds, toggleLike } = useLikedArticles();
  const { bookmarkIds, toggleBookmark } = useBookmarks();
  const { isFavorite, toggleFavorite } = useFavorites();
  const personalization = useScrollPersonalization({
    articles,
    enabled: articles.length > 0,
    isFavorite,
  });

  return {
    ...personalization,
    bookmarkIds,
    isFavorite,
    likedIds,
    toggleBookmark,
    toggleFavorite,
    toggleLike,
  };
};

const useFeedViewModalState = () => {
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [selectedArticleIndex, setSelectedArticleIndex] = useState<number | null>(null);
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);

  return {
    isArticleModalOpen,
    selectedArticle,
    selectedArticleIndex,
    setIsArticleModalOpen,
    setSelectedArticle,
    setSelectedArticleIndex,
  };
};

interface FeedViewActionsOptions {
  readonly data: {
    readonly bookmarkIds: ReadonlySet<number>;
    readonly rankedArticles: readonly NewsArticle[];
    readonly toggleBookmark: ReturnType<typeof useFeedViewData>["toggleBookmark"];
    readonly toggleLike: ReturnType<typeof useFeedViewData>["toggleLike"];
  };
  readonly modal: {
    readonly isArticleModalOpen: boolean;
    readonly selectedArticleIndex: number | null;
    readonly setIsArticleModalOpen: ReturnType<
      typeof useFeedViewModalState
    >["setIsArticleModalOpen"];
    readonly setSelectedArticle: ReturnType<
      typeof useFeedViewModalState
    >["setSelectedArticle"];
    readonly setSelectedArticleIndex: ReturnType<
      typeof useFeedViewModalState
    >["setSelectedArticleIndex"];
  };
  readonly ranking: {
    readonly containerRef: Readonly<{ current: HTMLDivElement | null }>;
    readonly effectiveActiveIndex: number;
    readonly effectiveVisibleArticles: readonly NewsArticle[];
  };
}

const useFeedViewActions = ({
  data,
  modal,
  ranking,
}: Readonly<FeedViewActionsOptions>) => {
  const navigation = useFeedScrollNavigation({
    activeIndex: ranking.effectiveActiveIndex,
    containerRef: ranking.containerRef,
    modalOpen: modal.isArticleModalOpen,
    visibleCount: ranking.effectiveVisibleArticles.length,
  });
  const handlers = useFeedActionHandlers({
    bookmarkIds: data.bookmarkIds,
    rankedArticles: data.rankedArticles,
    selectedArticleIndex: modal.selectedArticleIndex,
    setIsArticleModalOpen: modal.setIsArticleModalOpen,
    setSelectedArticle: modal.setSelectedArticle,
    setSelectedArticleIndex: modal.setSelectedArticleIndex,
    toggleBookmark: data.toggleBookmark,
    toggleLike: data.toggleLike,
  });
  return { ...handlers, ...navigation };
};

type FeedViewModel = ReturnType<typeof useFeedViewData> &
  ReturnType<typeof useFeedViewModalState> &
  ReturnType<typeof useFeedRankingState> &
  ReturnType<typeof useFeedViewActions> & {
    readonly debugMode: boolean;
    readonly loading: boolean;
    readonly totalCount?: number;
  };

const useFeedViewController = ({
  articles,
  debugMode = false,
  loading,
  totalCount,
}: DeepReadonly<FeedViewProps>): FeedViewModel => {
  const data = useFeedViewData(articles);
  const ranking = useFeedRankingState({ rankedArticles: data.rankedArticles });
  const modal = useFeedViewModalState();
  const actions = useFeedViewActions({ data, modal, ranking });

  return { ...data, ...modal, ...ranking, ...actions, debugMode, loading, totalCount };
};

export type { FeedViewModel, FeedViewProps };
export { useFeedViewController };
