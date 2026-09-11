"use client";

import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import type { FeedScoreBreakdown } from "@/lib/feed-ranking";
import type { NewsArticle } from "@/lib/api";
import { formatScore } from "./feed-ranking-panel";
import { FeedActionButtons } from "./feed-action-buttons";
import { FeedStoryImageLayer, FeedStoryText, getFeedFallbackImage } from "./feed-story-parts";

const FEED_STORY_STYLE = { height: "calc(100vh - 64px)" } as const;

interface FeedStoryProps {
  readonly article: NewsArticle;
  readonly index: number;
  readonly breakdown: FeedScoreBreakdown | null;
  readonly ogImage: string | undefined;
  readonly liked: boolean;
  readonly favorite: boolean;
  readonly bookmarked: boolean;
  readonly onPreview: (article: NewsArticle, index: number) => void;
  readonly onLike: (articleId: number) => void;
  readonly onFavorite: (sourceId: string) => void;
  readonly onBookmark: (articleId: number) => void;
}

const FeedStoryBadges = ({
  article,
  breakdown,
}: Readonly<Pick<FeedStoryProps, "article" | "breakdown">>) => (
  <div className="absolute top-6 left-6 right-6 md:top-8 md:left-8 md:right-8 flex flex-wrap items-center gap-2 pr-44 md:pr-0 pointer-events-none">
    <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/30 px-2 py-0.5 md:px-3 md:py-1 font-sans text-xs uppercase tracking-wider">
      {article.category}
    </Badge>
    <Badge
      variant="outline"
      className="font-sans uppercase tracking-wider border-white/20 bg-black/40 backdrop-blur-sm text-white/90 px-2 py-0.5 md:px-3 md:py-1 text-xs"
    >
      {article.credibility} credibility
    </Badge>
    {breakdown?.articleId === article.id && breakdown.personalizedScore > 0 && (
      <Badge
        variant="outline"
        className="font-sans uppercase tracking-wider border-primary/40 bg-primary/15 text-primary px-2 py-0.5 md:px-3 md:py-1 text-xs"
      >
        score {formatScore(breakdown.personalizedScore)}
      </Badge>
    )}
  </div>
);

const FeedStoryContent = ({
  article,
  breakdown,
  liked,
  favorite,
  bookmarked,
  onLike,
  onFavorite,
  onBookmark,
}: Readonly<
  Pick<
    FeedStoryProps,
    | "article"
    | "breakdown"
    | "liked"
    | "favorite"
    | "bookmarked"
    | "onLike"
    | "onFavorite"
    | "onBookmark"
  >
>) => (
  <div className="pointer-events-none relative z-10 flex h-full flex-col justify-end p-6 pb-24 md:p-10 lg:p-12 md:pb-10 lg:pb-12">
    <FeedStoryBadges article={article} breakdown={breakdown} />
    <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-10 max-w-7xl mx-auto w-full">
      <FeedStoryText article={article} />
      <FeedActionButtons
        article={article}
        liked={liked}
        favorite={favorite}
        bookmarked={bookmarked}
        onLike={onLike}
        onFavorite={onFavorite}
        onBookmark={onBookmark}
      />
    </div>
  </div>
);

const FeedStory = ({
  article,
  index,
  breakdown,
  ogImage,
  liked,
  favorite,
  bookmarked,
  onPreview,
  onLike,
  onFavorite,
  onBookmark,
}: Readonly<FeedStoryProps>): React.JSX.Element => {
  const fallbackSrc = getFeedFallbackImage(ogImage);
  const handlePreview = useCallback(() => {
      onPreview(article, index);
    }, [article, index, onPreview]),
    handlePreviewButton = handlePreview;
  return (
    <section
      key={`${article.id}-${index}`}
      data-index={index}
      className="snap-start w-full relative group"
      style={FEED_STORY_STYLE}
    >
      <button
        type="button"
        aria-label={`Open article: ${article.title}`}
        className="absolute inset-0 z-0 h-full w-full cursor-pointer"
        onClick={handlePreviewButton}
      />
      <FeedStoryImageLayer article={article} fallbackSrc={fallbackSrc} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/30 pointer-events-none" />
      <FeedStoryContent
        article={article}
        breakdown={breakdown}
        liked={liked}
        favorite={favorite}
        bookmarked={bookmarked}
        onLike={onLike}
        onFavorite={onFavorite}
        onBookmark={onBookmark}
      />
    </section>
  );
};

export { FeedStory };
