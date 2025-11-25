"use client";

import { useRef, useCallback, useEffect, useMemo, memo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Heart, PlusCircle, MinusCircle, Loader2 } from "lucide-react";
import type { NewsArticle } from "@/lib/api";
import { useReadingQueue } from "@/hooks/useReadingQueue";

// Configuration constants
const CARD_HEIGHT = 380; // Height of each article card
const CARD_MIN_WIDTH = 280; // Minimum width of each article card
const GAP = 16; // Gap between cards
const OVERSCAN = 3; // Number of rows to render outside viewport

interface VirtualizedGridProps {
  articles: NewsArticle[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  onArticleClick: (article: NewsArticle) => void;
  totalCount: number;
}

// Memoized article card component
const ArticleCard = memo(function ArticleCard({
  article,
  onClick,
  style,
}: {
  article: NewsArticle;
  onClick: () => void;
  style: React.CSSProperties;
}) {
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } =
    useReadingQueue();
  const inQueue = isArticleInQueue(article.url);
  const [liked, setLiked] = useState(false);

  const handleQueueToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (inQueue) {
        removeArticleFromQueue(article.url);
      } else {
        addArticleToQueue(article);
      }
    },
    [inQueue, article, addArticleToQueue, removeArticleFromQueue]
  );

  const handleLike = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLiked((prev) => !prev);
  }, []);

  return (
    <div style={style} className="p-2">
      <Card
        className="h-full cursor-pointer hover:border-primary hover:shadow-lg transition-all duration-200 bg-card/70 hover:bg-card border-border/60 overflow-hidden flex flex-col"
        onClick={onClick}
      >
        {/* Image */}
        <div className="relative h-40 overflow-hidden bg-muted/40 flex-shrink-0">
          <img
            src={article.image || "/placeholder.svg"}
            alt={article.title}
            className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Action Buttons */}
          <div className="absolute top-1 right-1 flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleQueueToggle}
              className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
            >
              {inQueue ? (
                <MinusCircle className="w-3 h-3 text-blue-400" />
              ) : (
                <PlusCircle className="w-3 h-3 text-white" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLike}
              className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
            >
              <Heart
                className={`w-3 h-3 ${liked ? "fill-red-500 text-red-500" : "text-white"}`}
              />
            </Button>
          </div>

          {/* Category Badge */}
          <div className="absolute bottom-1 left-1">
            <Badge
              variant="outline"
              className="text-[8px] font-semibold px-1.5 py-0 bg-black/70 text-white border-white/20"
            >
              {article.category}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardContent className="flex-1 flex flex-col p-3">
          {/* Source */}
          <div className="text-xs text-primary font-medium mb-1 truncate">
            {article.source}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-3 mb-2 font-serif">
            {article.title}
          </h3>

          {/* Summary */}
          <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
            {article.summary}
          </p>

          {/* Meta Info */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
            <Clock className="w-3 h-3" />
            <span>
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export function VirtualizedGrid({
  articles,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onArticleClick,
  totalCount,
}: VirtualizedGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(4);

  // Calculate columns based on container width
  useEffect(() => {
    const updateColumns = () => {
      if (!parentRef.current) return;
      const width = parentRef.current.offsetWidth - GAP * 2; // Account for padding
      const cols = Math.max(1, Math.floor(width / (CARD_MIN_WIDTH + GAP)));
      setColumnCount(cols);
    };

    updateColumns();

    const resizeObserver = new ResizeObserver(updateColumns);
    if (parentRef.current) {
      resizeObserver.observe(parentRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Row count based on articles and columns
  const rowCount = Math.ceil(articles.length / columnCount);

  // Virtual row renderer
  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? rowCount + 1 : rowCount, // +1 for loading row
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: OVERSCAN,
  });

  // Fetch next page when scrolling near bottom
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];

    if (!lastItem) return;

    // If we're at the last row and there's more to load
    if (lastItem.index >= rowCount - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    rowVirtualizer.getVirtualItems(),
    rowCount,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Calculate card width based on available space
  const cardWidth = useMemo(() => {
    if (!parentRef.current) return CARD_MIN_WIDTH;
    const containerWidth = parentRef.current.offsetWidth - GAP * 2;
    return Math.floor((containerWidth - GAP * (columnCount - 1)) / columnCount);
  }, [columnCount]);

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border/30 bg-background/40 backdrop-blur-sm">
        <div className="text-sm text-muted-foreground">
          Showing {articles.length} of {totalCount.toLocaleString()} articles
          {isFetchingNextPage && (
            <span className="ml-2 text-primary">
              <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
              Loading more...
            </span>
          )}
        </div>
      </div>

      {/* Virtual scroll container */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto px-2"
        style={{
          contain: "strict",
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const isLoaderRow = virtualRow.index >= rowCount;

            if (isLoaderRow) {
              return (
                <div
                  key="loader"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-center justify-center"
                >
                  {hasNextPage ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Loading more articles...</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      No more articles
                    </span>
                  )}
                </div>
              );
            }

            // Get articles for this row
            const startIndex = virtualRow.index * columnCount;
            const rowArticles = articles.slice(
              startIndex,
              startIndex + columnCount
            );

            return (
              <div
                key={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex justify-center gap-0"
              >
                {rowArticles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onClick={() => onArticleClick(article)}
                    style={{
                      width: cardWidth + GAP,
                      height: CARD_HEIGHT,
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
