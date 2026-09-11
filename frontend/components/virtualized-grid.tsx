"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { NewsArticle } from "@/lib/api";
import { CARD_MIN_WIDTH, GAP, OVERSCAN, ROW_HEIGHT } from "./virtualized-grid-constants";
import { VirtualizedGridViewport } from "./virtualized-grid-rows";
import type { VirtualizedGridVirtualItem } from "./virtualized-grid-rows";

interface VirtualizedGridProps {
  readonly articles: readonly NewsArticle[];
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => void;
  readonly onArticleClick: (article: NewsArticle) => void;
  readonly totalCount: number;
}

interface VirtualizedGridViewportState {
  readonly columnCount: number;
  readonly containerWidth: number;
  readonly parentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

const useVirtualizedGridResizeObserver = (
  parentRef: Readonly<RefObject<HTMLDivElement | null>>,
  onResize: () => void,
  handleScroll: () => void,
): void => {
  useEffect(() => {
    onResize();
    const element = parentRef.current;
    const resizeObserver = new ResizeObserver(onResize);
    if (element) {
      element.addEventListener("scroll", handleScroll, { passive: true });
      resizeObserver.observe(element);
    }
    return () => {
      element?.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [handleScroll, onResize, parentRef]);
};

const useVirtualizedGridViewport = (): VirtualizedGridViewportState => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(4);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const handleScroll = useCallback(() => {
    setScrollTop(parentRef.current?.scrollTop ?? 0);
  }, []);
  const updateLayout = useCallback(() => {
    const element = parentRef.current;
    if (!element) {
      return;
    }
    const columns = Math.max(
      1,
      Math.floor((element.offsetWidth - GAP * 2) / (CARD_MIN_WIDTH + GAP)),
    );
    setColumnCount(columns);
    setContainerWidth(element.offsetWidth);
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
  }, []);
  useVirtualizedGridResizeObserver(parentRef, updateLayout, handleScroll);

  return { columnCount, containerWidth, parentRef, scrollTop, viewportHeight };
};

const getLoadingRowCount = (hasNextPage: boolean): number => {
  if (hasNextPage) {
    return 1;
  }
  return 0;
};

const useVirtualizedGridPagination = (
  virtualItems: readonly VirtualizedGridVirtualItem[],
  rowCount: number,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => void,
): void => {
  useEffect(() => {
    const lastItem = virtualItems.at(-1);
    if (lastItem && lastItem.index >= rowCount - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rowCount, virtualItems]);
};

interface VirtualizedGridRowsState {
  readonly cardWidth: number;
  readonly gridStyle: Readonly<CSSProperties>;
  readonly rowCount: number;
  readonly virtualItems: readonly VirtualizedGridVirtualItem[];
}

interface VirtualizedGridRowsInput {
  readonly articles: readonly NewsArticle[];
  readonly columnCount: number;
  readonly containerWidth: number;
  readonly fetchNextPage: () => void;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

interface VirtualizedGridWindow {
  readonly firstRow: number;
  readonly lastRow: number;
  readonly rowCount: number;
  readonly totalSize: number;
}

const getVirtualizedGridWindow = (
  articleCount: number,
  columnCount: number,
  hasNextPage: boolean,
  scrollTop: number,
  viewportHeight: number,
): VirtualizedGridWindow => {
  const rowCount = Math.ceil(articleCount / columnCount);
  const totalRows = rowCount + getLoadingRowCount(hasNextPage);
  const totalSize = totalRows * ROW_HEIGHT;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  return { firstRow, lastRow, rowCount, totalSize };
};

const getVirtualizedGridCardWidth = (containerWidth: number, columnCount: number): number => {
  if (containerWidth === 0) {
    return CARD_MIN_WIDTH;
  }
  return Math.floor((containerWidth - GAP * (columnCount - 1)) / columnCount);
};

const getVirtualizedGridItems = (
  firstRow: number,
  lastRow: number,
): readonly VirtualizedGridVirtualItem[] =>
  Array.from({ length: Math.max(0, lastRow - firstRow) }, (_item, offset) => {
    const index = firstRow + offset;
    return { index, start: index * ROW_HEIGHT };
  });

const useVirtualizedGridRows = ({
  articles,
  columnCount,
  containerWidth,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  scrollTop,
  viewportHeight,
}: Readonly<VirtualizedGridRowsInput>): VirtualizedGridRowsState => {
  const { firstRow, lastRow, rowCount, totalSize } = getVirtualizedGridWindow(
    articles.length,
    columnCount,
    hasNextPage,
    scrollTop,
    viewportHeight,
  );
  const virtualItems = useMemo<readonly VirtualizedGridVirtualItem[]>(
    () => getVirtualizedGridItems(firstRow, lastRow),
    [firstRow, lastRow],
  );
  const gridStyle = useMemo<CSSProperties>(
    () => ({
      height: `${totalSize}px`,
      position: "relative",
      width: "100%",
    }),
    [totalSize],
  );
  const cardWidth = getVirtualizedGridCardWidth(containerWidth, columnCount);
  useVirtualizedGridPagination(
    virtualItems,
    rowCount,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  );
  return { cardWidth, gridStyle, rowCount, virtualItems };
};

const VirtualizedGridLoadingStatus = ({
  isFetchingNextPage,
}: Readonly<{ isFetchingNextPage: boolean }>): ReactNode => {
  if (!isFetchingNextPage) {
    return null;
  }
  return (
    <span className="ml-2 text-primary">
      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
      Loading more...
    </span>
  );
};

const VirtualizedGridHeader = ({
  articlesLength,
  isFetchingNextPage,
  totalCount,
}: Readonly<{
  articlesLength: number;
  isFetchingNextPage: boolean;
  totalCount: number;
}>): React.JSX.Element => (
  <div className="flex-shrink-0 border-b border-border/30 bg-background/40 px-4 py-2 backdrop-blur-sm">
    <div className="text-sm text-muted-foreground">
      Showing {articlesLength} of {totalCount.toLocaleString()} articles
      <VirtualizedGridLoadingStatus isFetchingNextPage={isFetchingNextPage} />
    </div>
  </div>
);

interface VirtualizedGridContentProps {
  readonly articles: readonly NewsArticle[];
  readonly handleArticleClick: (article: Readonly<NewsArticle>) => void;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly rows: Readonly<VirtualizedGridRowsState>;
  readonly totalCount: number;
  readonly viewport: Readonly<VirtualizedGridViewportState>;
}

const VirtualizedGridContent = ({
  articles,
  handleArticleClick,
  hasNextPage,
  isFetchingNextPage,
  rows,
  totalCount,
  viewport,
}: Readonly<VirtualizedGridContentProps>): React.JSX.Element => (
  <div className="flex h-full flex-col">
    <VirtualizedGridHeader
      articlesLength={articles.length}
      isFetchingNextPage={isFetchingNextPage}
      totalCount={totalCount}
    />
    <VirtualizedGridViewport
      articles={articles}
      cardWidth={rows.cardWidth}
      columnCount={viewport.columnCount}
      gridStyle={rows.gridStyle}
      hasNextPage={hasNextPage}
      onArticleClick={handleArticleClick}
      parentRef={viewport.parentRef}
      rowCount={rows.rowCount}
      virtualItems={rows.virtualItems}
    />
  </div>
);

export const VirtualizedGrid = ({
  articles,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  onArticleClick: handleArticleClick,
  totalCount,
}: Readonly<VirtualizedGridProps>): React.JSX.Element => {
  const viewport = useVirtualizedGridViewport();
  const rows = useVirtualizedGridRows({
    articles,
    columnCount: viewport.columnCount,
    containerWidth: viewport.containerWidth,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.viewportHeight,
  });
  return (
    <VirtualizedGridContent
      articles={articles}
      handleArticleClick={handleArticleClick}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      rows={rows}
      totalCount={totalCount}
      viewport={viewport}
    />
  );
};
