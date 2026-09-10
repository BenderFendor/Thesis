import { SCROLL_INITIAL_RENDER_COUNT, SCROLL_REVEAL_THRESHOLD } from "@/lib/feed-ranking";
import { useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { NewsArticle } from "@/lib/api";
import { useFeedImageLoader, useFeedIntersectionObserver } from "./feed-scroll";

interface FeedRankingState {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly effectiveActiveIndex: number;
  readonly effectiveVisibleArticles: readonly NewsArticle[];
  readonly ogImages: Record<number, string>;
}

interface FeedRankingStateOptions {
  readonly rankedArticles: readonly NewsArticle[];
}

const getTargetActiveIndex = (
  activeArticleId: number | null,
  activeIndex: number,
  renderCount: number,
  rankedArticles: readonly NewsArticle[],
): number => {
  const visibleArticleId =
    rankedArticles.slice(0, Math.min(renderCount, rankedArticles.length))[activeIndex]?.id;
  const trackedArticleId =
    activeArticleId ?? visibleArticleId ?? rankedArticles[0]?.id ?? null;
  if (trackedArticleId === null) {
    return 0;
  }

  const nextIndex = rankedArticles.findIndex((article) => article.id === trackedArticleId);
  if (nextIndex === -1) {
    return Math.min(activeIndex, Math.max(0, rankedArticles.length - 1));
  }

  return nextIndex;
};

const getEffectiveActiveIndex = (targetActiveIndex: number, articleCount: number): number => {
  if (articleCount === 0) {
    return 0;
  }
  return Math.min(targetActiveIndex, Math.max(0, articleCount - 1));
};

const getEffectiveRenderCount = (
  renderCount: number,
  effectiveActiveIndex: number,
  articleCount: number,
): number => {
  if (articleCount === 0) {
    return 0;
  }

  const minimumForActive = effectiveActiveIndex + SCROLL_REVEAL_THRESHOLD + 1;
  return Math.min(
    Math.max(renderCount, SCROLL_INITIAL_RENDER_COUNT, minimumForActive),
    articleCount,
  );
};

const useFeedRankingWindow = ({ rankedArticles }: FeedRankingStateOptions) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeArticleId, setActiveArticleId] = useState<number | null>(null);
  const [renderCount, setRenderCount] = useState(SCROLL_INITIAL_RENDER_COUNT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const targetActiveIndex = useMemo(
    () => getTargetActiveIndex(activeArticleId, activeIndex, renderCount, rankedArticles),
    [activeArticleId, activeIndex, rankedArticles, renderCount],
  );
  const articleCount = rankedArticles.length;
  const effectiveActiveIndex = getEffectiveActiveIndex(targetActiveIndex, articleCount);
  const effectiveRenderCount = useMemo(
    () => getEffectiveRenderCount(renderCount, effectiveActiveIndex, articleCount),
    [articleCount, effectiveActiveIndex, renderCount],
  );
  const effectiveVisibleArticles = useMemo(
    () => rankedArticles.slice(0, effectiveRenderCount),
    [effectiveRenderCount, rankedArticles],
  );

  return {
    containerRef,
    effectiveActiveIndex,
    effectiveVisibleArticles,
    renderCount,
    setActiveArticleId,
    setActiveIndex,
    setRenderCount,
  };
};

const useFeedRankingState = ({ rankedArticles }: FeedRankingStateOptions): FeedRankingState => {
  const rankingWindow = useFeedRankingWindow({ rankedArticles });
  const ogImages = useFeedImageLoader({
    activeIndex: rankingWindow.effectiveActiveIndex,
    visibleArticles: rankingWindow.effectiveVisibleArticles,
  });

  useFeedIntersectionObserver({
    containerRef: rankingWindow.containerRef,
    rankedArticles,
    renderCount: rankingWindow.renderCount,
    setActiveArticleId: rankingWindow.setActiveArticleId,
    setActiveIndex: rankingWindow.setActiveIndex,
    setRenderCount: rankingWindow.setRenderCount,
    visibleCount: rankingWindow.effectiveVisibleArticles.length,
  });

  return {
    containerRef: rankingWindow.containerRef,
    effectiveActiveIndex: rankingWindow.effectiveActiveIndex,
    effectiveVisibleArticles: rankingWindow.effectiveVisibleArticles,
    ogImages,
  };
};

export { useFeedRankingState };
