import type { Dispatch, RefObject, SetStateAction } from "react";
import { SCROLL_RENDER_CHUNK_SIZE, SCROLL_REVEAL_THRESHOLD } from "@/lib/feed-ranking";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { fetchOGImage } from "@/lib/api";
import { hasText } from "@/lib/utils";
import { isUsableImage } from "@/lib/article-image";

const OG_FETCH_CONCURRENCY = 4;
const OG_LOOKAHEAD = 6;

interface FeedImageLoaderOptions {
  readonly activeIndex: number;
  readonly visibleArticles: readonly NewsArticle[];
}

const getFeedImageCandidates = (
  activeIndex: number,
  visibleArticles: readonly NewsArticle[],
  requestedImageIds: ReadonlySet<number>,
): readonly NewsArticle[] => {
  const start = Math.max(0, activeIndex - OG_LOOKAHEAD);
  const end = Math.min(visibleArticles.length, activeIndex + OG_LOOKAHEAD + 1);
  return visibleArticles
    .slice(start, end)
    .filter(
      (article) =>
        !isUsableImage(article.image) && hasText(article.url) && !requestedImageIds.has(article.id),
    );
};

const fetchFeedImageBatch = async (
  articles: readonly NewsArticle[],
): Promise<Record<number, string>> => {
  const article = articles[0];
  if (!article) {
    return {};
  }
  const imageUrl = await fetchOGImage(article.url);
  const remainingImages = await fetchFeedImageBatch(articles.slice(1));
  if (!hasText(imageUrl)) {
    return remainingImages;
  }
  return { ...remainingImages, [article.id]: imageUrl };
};

const splitFeedImageBatches = (
  candidates: readonly NewsArticle[],
): readonly (readonly NewsArticle[])[] => {
  const workerCount = Math.min(OG_FETCH_CONCURRENCY, candidates.length);
  return Array.from({ length: workerCount }, (_worker, workerIndex) =>
    candidates.filter((_candidate, candidateIndex) => candidateIndex % workerCount === workerIndex),
  );
};

const useFeedImageLoader = ({
  activeIndex,
  visibleArticles,
}: FeedImageLoaderOptions): Record<number, string> => {
  const requestedImagesRef = useRef<Set<number>>(new Set()),
    [ogImages, setOgImages] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;

    const fetchImages = async (): Promise<void> => {
      const candidates = getFeedImageCandidates(
        activeIndex,
        visibleArticles,
        requestedImagesRef.current,
      );

      if (candidates.length === 0) {
        return;
      }

      candidates.forEach((article) => {
        requestedImagesRef.current.add(article.id);
      });

      const imageBatches = await Promise.all(
        splitFeedImageBatches(candidates).map((batch) => fetchFeedImageBatch(batch)),
      );
      const newImages = imageBatches.reduce<Record<number, string>>((images, batch) => {
        Object.assign(images, batch);
        return images;
      }, {});

      if (!cancelled && Object.keys(newImages).length > 0) {
        setOgImages((previous) => ({ ...previous, ...newImages }));
      }
    };

    void fetchImages();
    return () => {
      cancelled = true;
    };
  }, [activeIndex, visibleArticles]);

  return ogImages;
};

interface FeedIntersectionOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly visibleCount: number;
  readonly rankedArticles: readonly NewsArticle[];
  readonly renderCount: number;
  readonly setRenderCount: Dispatch<SetStateAction<number>>;
  readonly setActiveArticleId: Dispatch<SetStateAction<number | null>>;
  readonly setActiveIndex: Dispatch<SetStateAction<number>>;
}

const setupFeedIntersectionObserver = (
  container: HTMLDivElement,
  {
    visibleCount,
    rankedArticles,
    renderCount,
    setRenderCount,
    setActiveArticleId,
    setActiveIndex,
  }: DeepReadonly<Omit<FeedIntersectionOptions, "containerRef">>,
): (() => void) => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) {
          return;
        }

        const index = Number(entry.target.dataset.index);
        if (
          index >= visibleCount - SCROLL_REVEAL_THRESHOLD &&
          renderCount < rankedArticles.length
        ) {
          setRenderCount((previous) =>
            Math.min(previous + SCROLL_RENDER_CHUNK_SIZE, rankedArticles.length),
          );
        }
        setActiveArticleId(rankedArticles[index]?.id ?? null);
        setActiveIndex(index);
      });
    },
    { root: container, threshold: 0.6 },
  );
  const children = container.querySelectorAll("[data-index]");
  children.forEach((child) => {
    observer.observe(child);
  });
  return () => {
    children.forEach((child) => {
      observer.unobserve(child);
    });
    observer.disconnect();
  };
};

const useFeedIntersectionObserver = ({
  containerRef,
  visibleCount,
  rankedArticles,
  renderCount,
  setRenderCount,
  setActiveArticleId,
  setActiveIndex,
}: DeepReadonly<FeedIntersectionOptions>): void => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return () => {};
    }
    return setupFeedIntersectionObserver(container, {
      rankedArticles,
      renderCount,
      setActiveArticleId,
      setActiveIndex,
      setRenderCount,
      visibleCount,
    });
  }, [
    containerRef,
    rankedArticles,
    renderCount,
    setActiveArticleId,
    setActiveIndex,
    setRenderCount,
    visibleCount,
  ]);
};

interface FeedScrollNavigationOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly activeIndex: number;
  readonly visibleCount: number;
  readonly modalOpen: boolean;
}

interface FeedScrollNavigation {
  readonly scrollToNext: () => void;
  readonly scrollToPrev: () => void;
}

interface FeedNavigationKeyboardEvent {
  readonly key: string;
  readonly preventDefault: () => void;
}

const useFeedScrollNavigation = ({
  containerRef,
  activeIndex,
  visibleCount,
  modalOpen,
}: DeepReadonly<FeedScrollNavigationOptions>): FeedScrollNavigation => {
  const scrollToNext = useCallback(() => {
      const container = containerRef.current;
      if (!container || activeIndex >= visibleCount - 1) {
        return;
      }
      container
        .querySelector(`[data-index="${activeIndex + 1}"]`)
        ?.scrollIntoView({ behavior: "smooth" });
    }, [activeIndex, containerRef, visibleCount]),
    scrollToPrev = useCallback(() => {
      const container = containerRef.current;
      if (!container || activeIndex <= 0) {
        return;
      }
      container
        .querySelector(`[data-index="${activeIndex - 1}"]`)
        ?.scrollIntoView({ behavior: "smooth" });
    }, [activeIndex, containerRef]);

  useEffect(() => {
    const handleKeyDown = (event: FeedNavigationKeyboardEvent): void => {
      if (modalOpen) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        scrollToNext();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        scrollToPrev();
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [modalOpen, scrollToNext, scrollToPrev]);

  return { scrollToNext, scrollToPrev };
};

export { useFeedImageLoader, useFeedIntersectionObserver, useFeedScrollNavigation };
