"use client";

import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import type { CSSProperties, RefObject, ReactNode } from "react";
import type { NewsArticle } from "@/lib/api";
import { VirtualizedGridCard } from "./virtualized-grid-card";
import { ROW_HEIGHT } from "./virtualized-grid-constants";

const GRID_CONTAINER_STYLE: CSSProperties = { contain: "strict" };

interface VirtualizedGridVirtualItem {
  readonly index: number;
  readonly start: number;
}

interface VirtualizedGridRowProps {
  readonly articles: readonly NewsArticle[];
  readonly cardWidth: number;
  readonly columnCount: number;
  readonly onArticleClick: (article: Readonly<NewsArticle>) => void;
  readonly rowIndex: number;
  readonly rowStart: number;
}

const getArticleKey = (article: Readonly<NewsArticle>): string => {
  if (article.url) {
    return `url:${article.url}`;
  }
  return `id:${article.id}`;
};

const VirtualizedGridRow = ({
  articles,
  cardWidth,
  columnCount,
  onArticleClick,
  rowIndex,
  rowStart,
}: Readonly<VirtualizedGridRowProps>): React.JSX.Element => {
  const startIndex = rowIndex * columnCount;
  const rowArticles = articles.slice(startIndex, startIndex + columnCount);
  const rowStyle = useMemo<CSSProperties>(
    () => ({
      height: ROW_HEIGHT,
      left: 0,
      position: "absolute",
      top: 0,
      transform: `translateY(${rowStart}px)`,
      width: "100%",
    }),
    [rowStart],
  );
  const handleArticleClick = onArticleClick;

  return (
    <div style={rowStyle} className="flex justify-center gap-0">
      {rowArticles.map((article, colIndex) => (
        <VirtualizedGridCard
          key={getArticleKey(article)}
          article={article}
          onArticleClick={handleArticleClick}
          articleNumber={startIndex + colIndex + 1}
          cardWidth={cardWidth}
        />
      ))}
    </div>
  );
};

interface VirtualizedGridLoaderProps {
  readonly hasNextPage: boolean;
  readonly rowStart: number;
}

const VirtualizedGridLoaderContent = ({
  hasNextPage,
}: Readonly<{ hasNextPage: boolean }>): ReactNode => {
  if (hasNextPage) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading more articles...</span>
      </div>
    );
  }
  return <span className="text-muted-foreground">No more articles</span>;
};

const VirtualizedGridLoader = ({
  hasNextPage,
  rowStart,
}: Readonly<VirtualizedGridLoaderProps>): React.JSX.Element => {
  const loaderStyle = useMemo<CSSProperties>(
    () => ({
      height: ROW_HEIGHT,
      left: 0,
      position: "absolute",
      top: 0,
      transform: `translateY(${rowStart}px)`,
      width: "100%",
    }),
    [rowStart],
  );
  return (
    <div style={loaderStyle} className="flex items-center justify-center">
      <VirtualizedGridLoaderContent hasNextPage={hasNextPage} />
    </div>
  );
};

interface VirtualizedGridItemProps {
  readonly articles: readonly NewsArticle[];
  readonly cardWidth: number;
  readonly columnCount: number;
  readonly hasNextPage: boolean;
  readonly onArticleClick: (article: Readonly<NewsArticle>) => void;
  readonly rowCount: number;
  readonly virtualRow: VirtualizedGridVirtualItem;
}

const VirtualizedGridItem = ({
  articles,
  cardWidth,
  columnCount,
  hasNextPage,
  onArticleClick,
  rowCount,
  virtualRow,
}: Readonly<VirtualizedGridItemProps>): React.JSX.Element => {
  if (virtualRow.index >= rowCount) {
    return (
      <VirtualizedGridLoader key="loader" hasNextPage={hasNextPage} rowStart={virtualRow.start} />
    );
  }
  return (
    <VirtualizedGridRow
      articles={articles}
      cardWidth={cardWidth}
      columnCount={columnCount}
      onArticleClick={onArticleClick}
      rowIndex={virtualRow.index}
      rowStart={virtualRow.start}
    />
  );
};

interface VirtualizedGridViewportProps {
  readonly articles: readonly NewsArticle[];
  readonly cardWidth: number;
  readonly columnCount: number;
  readonly gridStyle: Readonly<CSSProperties>;
  readonly hasNextPage: boolean;
  readonly onArticleClick: (article: Readonly<NewsArticle>) => void;
  readonly parentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly rowCount: number;
  readonly virtualItems: readonly VirtualizedGridVirtualItem[];
}

const VirtualizedGridViewport = ({
  articles,
  cardWidth,
  columnCount,
  gridStyle,
  hasNextPage,
  onArticleClick,
  parentRef,
  rowCount,
  virtualItems,
}: Readonly<VirtualizedGridViewportProps>): React.JSX.Element => (
  <div ref={parentRef} className="flex-1 overflow-auto px-2" style={GRID_CONTAINER_STYLE}>
    <div style={gridStyle}>
      {virtualItems.map((virtualRow) => (
        <VirtualizedGridItem
          key={virtualRow.index}
          articles={articles}
          cardWidth={cardWidth}
          columnCount={columnCount}
          hasNextPage={hasNextPage}
          onArticleClick={onArticleClick}
          rowCount={rowCount}
          virtualRow={virtualRow}
        />
      ))}
    </div>
  </div>
);

export type { VirtualizedGridVirtualItem };
export { VirtualizedGridViewport };
