"use client";

import dynamic from "next/dynamic";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { RankingPanel } from "./feed-ranking-panel";
import { FeedEmptyState, FeedLoadingState, FeedResults } from "./feed-rendering";
import type { FeedViewModel } from "./feed-view-controller";

const EMPTY_FEED_KEYWORDS: readonly string[] = [];
const EMPTY_FEED_CLUSTERS = [] as const;

const ArticleDetailModal = dynamic(
  async () => {
    const articleDetailModule = await import("./article-detail-modal");
    return articleDetailModule.ArticleDetailModal;
  },
  {
    loading: () => null,
    ssr: false,
  },
);

interface FeedViewContentModel {
  readonly breakdowns: FeedViewModel["breakdowns"];
  readonly containerRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly debugMode: FeedViewModel["debugMode"];
  readonly effectiveActiveIndex: FeedViewModel["effectiveActiveIndex"];
  readonly effectiveVisibleArticles: FeedViewModel["effectiveVisibleArticles"];
  readonly handleArticlePreview: FeedViewModel["handleArticlePreview"];
  readonly handleBookmark: FeedViewModel["handleBookmark"];
  readonly handleLike: FeedViewModel["handleLike"];
  readonly handleModalBookmarkChange: FeedViewModel["handleModalBookmarkChange"];
  readonly handleModalClose: FeedViewModel["handleModalClose"];
  readonly handleModalNavigate: FeedViewModel["handleModalNavigate"];
  readonly isArticleModalOpen: FeedViewModel["isArticleModalOpen"];
  readonly isFavorite: FeedViewModel["isFavorite"];
  readonly likedIds: FeedViewModel["likedIds"];
  readonly bookmarkIds: FeedViewModel["bookmarkIds"];
  readonly ogImages: FeedViewModel["ogImages"];
  readonly profile?: FeedViewModel["profile"];
  readonly rankedArticles: FeedViewModel["rankedArticles"];
  readonly scrollToNext: FeedViewModel["scrollToNext"];
  readonly scrollToPrev: FeedViewModel["scrollToPrev"];
  readonly seedCount: FeedViewModel["seedCount"];
  readonly selectedArticle: FeedViewModel["selectedArticle"];
  readonly status: FeedViewModel["status"];
  readonly toggleFavorite: FeedViewModel["toggleFavorite"];
  readonly topicsLoaded: FeedViewModel["topicsLoaded"];
  readonly totalCount?: FeedViewModel["totalCount"];
  readonly loading: FeedViewModel["loading"];
}

interface FeedViewContentProps {
  readonly model: FeedViewContentModel;
}

const getCurrentBreakdown = (model: DeepReadonly<FeedViewContentModel>) => {
  const activeArticle = model.effectiveVisibleArticles[model.effectiveActiveIndex];
  if (activeArticle === undefined) {
    return null;
  }
  return model.breakdowns[activeArticle.id] ?? null;
};

const FeedRankingOverlay = (props: DeepReadonly<FeedViewContentProps>) => {
  const { model } = props;
  const currentBreakdown = getCurrentBreakdown(model);
  const topKeywords = model.profile?.topKeywords ?? EMPTY_FEED_KEYWORDS;
  const topClusters = model.profile?.topClusters ?? EMPTY_FEED_CLUSTERS;

  return (
    <RankingPanel
      status={model.status}
      totalLoaded={model.rankedArticles.length}
      renderedCount={model.effectiveVisibleArticles.length}
      bufferRemaining={Math.max(
        0,
        model.rankedArticles.length - model.effectiveVisibleArticles.length,
      )}
      breakdown={currentBreakdown}
      topicsLoaded={model.topicsLoaded}
      seedCount={model.seedCount}
      topKeywords={topKeywords}
      topClusters={topClusters}
      debugMode={model.debugMode}
    />
  );
};

const FeedResultList = (props: DeepReadonly<FeedViewContentProps>) => {
  const { model } = props;
  const handleFavorite = model.toggleFavorite;
  const handlePrevious = model.scrollToPrev;
  const handleNext = model.scrollToNext;

  return (
    <FeedResults
      containerRef={model.containerRef}
      visibleArticles={model.effectiveVisibleArticles}
      rankedArticles={model.rankedArticles}
      breakdown={getCurrentBreakdown(model)}
      ogImages={model.ogImages}
      likedIds={model.likedIds}
      bookmarkIds={model.bookmarkIds}
      isFavorite={model.isFavorite}
      onPreview={model.handleArticlePreview}
      onLike={model.handleLike}
      onFavorite={handleFavorite}
      onBookmark={model.handleBookmark}
      onPrevious={handlePrevious}
      onNext={handleNext}
      activeIndex={model.effectiveActiveIndex}
      totalCount={model.totalCount}
    />
  );
};

const FeedArticleModal = (props: DeepReadonly<FeedViewContentProps>) => {
  const { model } = props;
  if (!model.isArticleModalOpen || model.selectedArticle === null) {
    return null;
  }

  return (
    <ArticleDetailModal
      article={model.selectedArticle}
      isOpen={model.isArticleModalOpen}
      onClose={model.handleModalClose}
      onBookmarkChange={model.handleModalBookmarkChange}
      onNavigate={model.handleModalNavigate}
    />
  );
};

const FeedReadyView = (props: DeepReadonly<FeedViewContentProps>) => {
  const { model } = props;
  return (
    <div className="relative flex-1 h-full min-h-0 w-full overflow-hidden bg-background">
      <FeedRankingOverlay model={model} />
      <FeedResultList model={model} />
      <FeedArticleModal model={model} />
    </div>
  );
};

const FeedViewContent = (props: DeepReadonly<FeedViewContentProps>) => {
  const { model } = props;
  if (model.loading) {
    return <FeedLoadingState />;
  }

  if (model.effectiveVisibleArticles.length === 0) {
    return <FeedEmptyState />;
  }

  return <FeedReadyView model={model} />;
};

export { FeedViewContent };
