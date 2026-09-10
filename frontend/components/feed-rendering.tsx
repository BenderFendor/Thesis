"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { FeedScoreBreakdown } from "@/lib/feed-ranking";
import type { NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { FeedStory } from "./feed-story";

const FeedLoadingState = (): React.JSX.Element => (
  <div className="flex-1 h-full w-full flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Indexing articles...
      </span>
    </div>
  </div>
);

const FeedEmptyState = (): React.JSX.Element => (
  <div className="flex-1 h-full w-full flex items-center justify-center bg-background">
    <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
      No coverage found for this category.
    </span>
  </div>
);

interface FeedScrollControlsProps {
  readonly activeIndex: number;
  readonly visibleCount: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

const FeedScrollControls = ({
  activeIndex,
  visibleCount,
  onPrevious,
  onNext,
}: FeedScrollControlsProps): React.JSX.Element => (
  <div className="absolute right-6 lg:right-8 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-20 hidden md:flex">
    <Button
      variant="outline"
      size="icon"
      onClick={onPrevious}
      disabled={activeIndex === 0}
      className="rounded-xl border-white/20 bg-black/40 backdrop-blur-xl hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all active:scale-95"
    >
      <ChevronUp className="w-5 h-5" />
    </Button>
    <Button
      variant="outline"
      size="icon"
      onClick={onNext}
      disabled={activeIndex === visibleCount - 1}
      className="rounded-xl border-white/20 bg-black/40 backdrop-blur-xl hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all active:scale-95"
    >
      <ChevronDown className="w-5 h-5" />
    </Button>
  </div>
);

interface FeedResultsProps {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly visibleArticles: readonly NewsArticle[];
  readonly rankedArticles: readonly NewsArticle[];
  readonly breakdown: FeedScoreBreakdown | null;
  readonly ogImages: Record<number, string>;
  readonly likedIds: ReadonlySet<number>;
  readonly bookmarkIds: ReadonlySet<number>;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly onPreview: (article: NewsArticle, index: number) => void;
  readonly onLike: (articleId: number) => void;
  readonly onFavorite: (sourceId: string) => void;
  readonly onBookmark: (articleId: number) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly activeIndex: number;
  readonly totalCount: number | undefined;
}

type FeedStoryListProps = Pick<
  FeedResultsProps,
  | "visibleArticles"
  | "breakdown"
  | "ogImages"
  | "likedIds"
  | "bookmarkIds"
  | "isFavorite"
  | "onPreview"
  | "onLike"
  | "onFavorite"
  | "onBookmark"
>;

const FeedStoryList = ({
  visibleArticles,
  breakdown,
  ogImages,
  likedIds,
  bookmarkIds,
  isFavorite,
  onPreview,
  onLike,
  onFavorite,
  onBookmark,
}: DeepReadonly<FeedStoryListProps>) => (
  <>
    {visibleArticles.map((article, index) => (
      <FeedStory
        key={`${article.id}-${article.url}`}
        article={article}
        index={index}
        breakdown={breakdown}
        ogImage={ogImages[article.id]}
        liked={likedIds.has(article.id)}
        favorite={isFavorite(article.sourceId)}
        bookmarked={bookmarkIds.has(article.id)}
        onPreview={onPreview}
        onLike={onLike}
        onFavorite={onFavorite}
        onBookmark={onBookmark}
      />
    ))}
  </>
);

const FeedQueueNotice = ({
  visibleArticles,
  rankedArticles,
  totalCount,
}: DeepReadonly<Pick<FeedResultsProps, "visibleArticles" | "rankedArticles" | "totalCount">>) => {
  if (visibleArticles.length >= rankedArticles.length) {
    return null;
  }
  return (
    <div className="flex min-h-28 items-center justify-center border-t border-white/10 bg-black/40 px-6 py-8 text-center text-xs uppercase tracking-widest text-white/70">
      {`Queued ${rankedArticles.length - visibleArticles.length} more ranked stories${(() => {
        if (totalCount === undefined) {
          return "";
        }
        return ` (${visibleArticles.length}/${totalCount})`;
      })()}`}
    </div>
  );
};

const FeedResults = ({
  containerRef,
  visibleArticles,
  rankedArticles,
  breakdown,
  ogImages,
  likedIds,
  bookmarkIds,
  isFavorite,
  onPreview,
  onLike,
  onFavorite,
  onBookmark,
  onPrevious,
  onNext,
  activeIndex,
  totalCount,
}: DeepReadonly<FeedResultsProps>): React.JSX.Element => (
  <>
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-auto snap-y snap-proximity no-scrollbar"
    >
      <FeedStoryList
        visibleArticles={visibleArticles}
        breakdown={breakdown}
        ogImages={ogImages}
        likedIds={likedIds}
        bookmarkIds={bookmarkIds}
        isFavorite={isFavorite}
        onPreview={onPreview}
        onLike={onLike}
        onFavorite={onFavorite}
        onBookmark={onBookmark}
      />
      <FeedQueueNotice
        visibleArticles={visibleArticles}
        rankedArticles={rankedArticles}
        totalCount={totalCount}
      />
    </div>
    <FeedScrollControls
      activeIndex={activeIndex}
      visibleCount={visibleArticles.length}
      onPrevious={onPrevious}
      onNext={onNext}
    />
  </>
);

export { FeedEmptyState, FeedLoadingState, FeedResults };
