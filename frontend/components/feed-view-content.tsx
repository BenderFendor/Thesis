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

type FeedViewContentProps = Readonly<{ model: DeepReadonly<FeedViewModel> }>;

const getCurrentBreakdown = (model: DeepReadonly<FeedViewModel>) => {
  const activeArticle = model.effectiveVisibleArticles[model.effectiveActiveIndex];
  if (activeArticle === undefined) {
    return null;
  }
  return model.breakdowns[activeArticle.id] ?? null;
};

const FeedRankingOverlay = ({ model }: FeedViewContentProps) => {
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

const FeedResultList = ({ model }: FeedViewContentProps) => {
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

const FeedArticleModal = ({ model }: FeedViewContentProps) => {
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

const FeedReadyView = ({ model }: FeedViewContentProps) => (
  <div className="relative flex-1 h-full min-h-0 w-full overflow-hidden bg-background">
    <FeedRankingOverlay model={model} />
    <FeedResultList model={model} />
    <FeedArticleModal model={model} />
  </div>
);

const FeedViewContent = ({ model }: FeedViewContentProps) => {
  if (model.loading) {
    return <FeedLoadingState />;
  }

  if (model.effectiveVisibleArticles.length === 0) {
    return <FeedEmptyState />;
  }

  return <FeedReadyView model={model} />;
};

export { FeedViewContent };
