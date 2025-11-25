# Article Pagination & Performance Optimization Plan

## Executive Summary

This plan addresses the critical performance issue of loading 2000+ articles at once, which causes significant page lag. The solution combines **server-side cursor pagination**, **frontend infinite scrolling with virtualization**, and **smart caching strategies** to deliver instant initial loads with smooth scrolling through large datasets.

---

## Table of Contents

1. [Problem Analysis](#problem-analysis)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1: Backend Pagination API](#phase-1-backend-pagination-api)
4. [Phase 2: Frontend Virtualization](#phase-2-frontend-virtualization)
5. [Phase 3: Caching & Performance](#phase-3-caching--performance)
6. [Implementation Timeline](#implementation-timeline)
7. [Testing Strategy](#testing-strategy)
8. [Expected Outcomes](#expected-outcomes)

---

## Problem Analysis

### Current Issues

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Page freezes on load | 3-5s UI freeze | Rendering 2000+ DOM nodes |
| Memory bloat | 500MB+ browser memory | All articles in React state |
| Slow filtering | Noticeable lag | Client-side iteration over full dataset |
| SSE stream blocks | Initial load bottleneck | Streaming all articles before render |

### Performance Metrics (Before)

```
Initial Load Time: 4.2s (2000 articles)
Time to Interactive: 6.8s
Memory Usage: 487MB
Scroll FPS: 12-18 fps (target: 60fps)
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │   GridView      │    │  useInfinite    │    │  TanStack    │ │
│  │   Component     │◄───│  Query Hook     │◄───│  Virtual     │ │
│  │                 │    │                 │    │              │ │
│  └─────────────────┘    └─────────────────┘    └──────────────┘ │
│          │                      │                      │        │
│          ▼                      ▼                      ▼        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Virtual DOM (only visible items)               ││
│  │              ~20-30 items rendered at a time                ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/SSE
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Backend (FastAPI)                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │  /news/page     │    │   Cursor-based  │    │  PostgreSQL  │ │
│  │  Endpoint       │◄───│   Pagination    │◄───│  + Index     │ │
│  │                 │    │                 │    │              │ │
│  └─────────────────┘    └─────────────────┘    └──────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Key Patterns

1. **Cursor-based Pagination** - More efficient than offset for large datasets
2. **Virtualized Rendering** - Only render visible items (~20-30) regardless of total count
3. **Infinite Scroll** - Load more as user scrolls near bottom
4. **Optimistic UI** - Show placeholders while loading

---

## Phase 1: Backend Pagination API

### 1.1 New Paginated Endpoint

**File: `backend/app/api/routes/news.py`**

```python
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, asc, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, Article, article_record_to_dict
from app.data.rss_sources import get_rss_sources
from app.models.news import NewsArticle, NewsResponse, SourceInfo
from app.services.cache import news_cache

router = APIRouter(prefix="/news", tags=["news"])


# --- Pagination Models ---

class PaginationParams(BaseModel):
    """Query parameters for paginated endpoints."""
    limit: int = Field(default=50, ge=1, le=200, description="Items per page")
    cursor: Optional[str] = Field(default=None, description="Cursor for next page")
    category: Optional[str] = Field(default=None, description="Filter by category")
    source: Optional[str] = Field(default=None, description="Filter by source")
    search: Optional[str] = Field(default=None, description="Search in title/summary")
    sort_by: str = Field(default="published_at", description="Sort field")
    sort_order: str = Field(default="desc", description="Sort direction: asc or desc")


class PaginatedResponse(BaseModel):
    """Response model for paginated article lists."""
    articles: List[Dict[str, Any]]
    total: int
    limit: int
    next_cursor: Optional[str] = None
    prev_cursor: Optional[str] = None
    has_more: bool = False


class CursorData(BaseModel):
    """Encoded cursor containing sort value and ID for keyset pagination."""
    published_at: str
    id: int


def encode_cursor(published_at: datetime, article_id: int) -> str:
    """Encode pagination cursor as base64 string."""
    import base64
    import json
    data = {"published_at": published_at.isoformat(), "id": article_id}
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> CursorData:
    """Decode pagination cursor from base64 string."""
    import base64
    import json
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return CursorData(
            published_at=data["published_at"],
            id=data["id"]
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid cursor: {e}")


@router.get("/page", response_model=PaginatedResponse)
async def get_news_paginated(
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    sort_order: str = Query(default="desc"),
    db: AsyncSession = Depends(get_db)
) -> PaginatedResponse:
    """
    Paginated article endpoint with cursor-based navigation.
    
    Cursor pagination is more efficient than offset for large datasets:
    - Consistent performance regardless of page number
    - No "skipping" issues when new data is inserted
    - Better index utilization
    
    Returns:
        PaginatedResponse with articles, cursors, and metadata
    """
    # Build base query
    filters = []
    
    if category:
        filters.append(Article.category == category)
    
    if source:
        filters.append(Article.source == source)
    
    if search:
        pattern = f"%{search}%"
        filters.append(
            or_(
                Article.title.ilike(pattern),
                Article.summary.ilike(pattern),
            )
        )
    
    # Apply cursor for keyset pagination
    if cursor:
        cursor_data = decode_cursor(cursor)
        cursor_dt = datetime.fromisoformat(cursor_data.published_at)
        
        if sort_order == "desc":
            # For descending: get items BEFORE the cursor
            filters.append(
                or_(
                    Article.published_at < cursor_dt,
                    and_(
                        Article.published_at == cursor_dt,
                        Article.id < cursor_data.id
                    )
                )
            )
        else:
            # For ascending: get items AFTER the cursor
            filters.append(
                or_(
                    Article.published_at > cursor_dt,
                    and_(
                        Article.published_at == cursor_dt,
                        Article.id > cursor_data.id
                    )
                )
            )
    
    # Build order clause
    if sort_order == "desc":
        order_clause = [desc(Article.published_at), desc(Article.id)]
    else:
        order_clause = [asc(Article.published_at), asc(Article.id)]
    
    # Execute query with limit + 1 to check if more pages exist
    stmt = (
        select(Article)
        .where(*filters) if filters else select(Article)
    ).order_by(*order_clause).limit(limit + 1)
    
    if filters:
        stmt = select(Article).where(*filters).order_by(*order_clause).limit(limit + 1)
    else:
        stmt = select(Article).order_by(*order_clause).limit(limit + 1)
    
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    
    # Check if there are more results
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]
    
    # Get total count (cached for performance)
    count_stmt = select(func.count()).select_from(Article)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await db.execute(count_stmt)).scalar_one()
    
    # Build response
    articles = [article_record_to_dict(row) for row in rows]
    
    # Generate next cursor from last item
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(last.published_at, last.id)
    
    return PaginatedResponse(
        articles=articles,
        total=total,
        limit=limit,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/page/cached", response_model=PaginatedResponse)
async def get_cached_news_paginated(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
) -> PaginatedResponse:
    """
    Paginated endpoint using in-memory cache (faster for frequently accessed data).
    Uses offset pagination since cache is in-memory array.
    
    Best for:
    - Initial page loads
    - Common category filters
    - Real-time updates
    """
    all_articles = news_cache.get_articles()
    
    # Apply filters
    filtered = all_articles
    
    if category:
        filtered = [a for a in filtered if a.category == category]
    
    if source:
        filtered = [a for a in filtered if a.source == source]
    
    if search:
        search_lower = search.lower()
        filtered = [
            a for a in filtered
            if search_lower in (a.title or "").lower()
            or search_lower in (a.summary or "").lower()
        ]
    
    total = len(filtered)
    
    # Apply pagination
    paginated = filtered[offset:offset + limit]
    
    # Convert to dict format
    articles = [
        {
            "id": a.id,
            "title": a.title,
            "source": a.source,
            "source_id": a.source_id,
            "country": a.country,
            "credibility": a.credibility,
            "bias": a.bias,
            "summary": a.summary,
            "content": a.content,
            "image": a.image,
            "image_url": a.image,
            "published_at": a.published,
            "category": a.category,
            "url": a.url,
            "tags": a.tags,
            "original_language": a.original_language,
            "translated": a.translated,
        }
        for a in paginated
    ]
    
    has_more = offset + limit < total
    next_cursor = str(offset + limit) if has_more else None
    
    return PaginatedResponse(
        articles=articles,
        total=total,
        limit=limit,
        next_cursor=next_cursor,
        has_more=has_more,
    )
```

### 1.2 Database Index Optimization

**File: `backend/app/database.py`** (additions)

```python
from sqlalchemy import Index

# Add composite index for pagination performance
# Add to Article model or create via migration

# Optimal index for cursor-based pagination
Index(
    'ix_articles_published_at_id_desc',
    Article.published_at.desc(),
    Article.id.desc()
)

# Category + date index for filtered queries
Index(
    'ix_articles_category_published',
    Article.category,
    Article.published_at.desc()
)

# Source + date index for source filtering
Index(
    'ix_articles_source_published',
    Article.source,
    Article.published_at.desc()
)
```

**Migration SQL (run manually or via alembic):**

```sql
-- Composite index for efficient cursor pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_published_at_id_desc 
ON articles (published_at DESC, id DESC);

-- Category filtering with date ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_category_published 
ON articles (category, published_at DESC);

-- Source filtering with date ordering  
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_source_published 
ON articles (source, published_at DESC);

-- Full-text search index (optional, for search optimization)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_title_trgm 
ON articles USING gin (title gin_trgm_ops);

-- Analyze tables after index creation
ANALYZE articles;
```

---

## Phase 2: Frontend Virtualization

### 2.1 Install Dependencies

```bash
cd frontend
pnpm add @tanstack/react-virtual @tanstack/react-query
```

### 2.2 Paginated API Functions

**File: `frontend/lib/api.ts`** (additions)

```typescript
// --- Pagination Types ---

export interface PaginatedResponse {
  articles: NewsArticle[];
  total: number;
  limit: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
}

export interface PaginationParams {
  limit?: number;
  cursor?: string;
  category?: string;
  source?: string;
  search?: string;
}

// --- Paginated Fetch Functions ---

export async function fetchNewsPaginated(
  params: PaginationParams = {}
): Promise<PaginatedResponse> {
  const searchParams = new URLSearchParams();
  
  if (params.limit) searchParams.append('limit', params.limit.toString());
  if (params.cursor) searchParams.append('cursor', params.cursor);
  if (params.category) searchParams.append('category', params.category);
  if (params.source) searchParams.append('source', params.source);
  if (params.search) searchParams.append('search', params.search);

  const url = `${API_BASE_URL}/news/page${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  
  console.log(`📄 Fetching paginated news: ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Map backend format to frontend format
  const articles = mapBackendArticles(data.articles || []);
  
  return {
    articles,
    total: data.total,
    limit: data.limit,
    next_cursor: data.next_cursor,
    prev_cursor: data.prev_cursor,
    has_more: data.has_more,
  };
}

export async function fetchCachedNewsPaginated(
  params: PaginationParams & { offset?: number } = {}
): Promise<PaginatedResponse> {
  const searchParams = new URLSearchParams();
  
  if (params.limit) searchParams.append('limit', params.limit.toString());
  if (params.offset !== undefined) searchParams.append('offset', params.offset.toString());
  if (params.category) searchParams.append('category', params.category);
  if (params.source) searchParams.append('source', params.source);
  if (params.search) searchParams.append('search', params.search);

  const url = `${API_BASE_URL}/news/page/cached${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  const articles = mapBackendArticles(data.articles || []);
  
  return {
    articles,
    total: data.total,
    limit: data.limit,
    next_cursor: data.next_cursor,
    prev_cursor: null,
    has_more: data.has_more,
  };
}
```

### 2.3 Infinite Query Hook

**File: `frontend/hooks/usePaginatedNews.ts`** (new file)

```typescript
"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { fetchNewsPaginated, fetchCachedNewsPaginated, NewsArticle, PaginatedResponse, PaginationParams } from "@/lib/api";

interface UsePaginatedNewsOptions {
  limit?: number;
  category?: string;
  source?: string;
  search?: string;
  useCached?: boolean;
}

interface UsePaginatedNewsReturn {
  articles: NewsArticle[];
  totalCount: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  error: Error | null;
}

export function usePaginatedNews(
  options: UsePaginatedNewsOptions = {}
): UsePaginatedNewsReturn {
  const {
    limit = 50,
    category,
    source,
    search,
    useCached = true,
  } = options;

  const queryClient = useQueryClient();

  // Build query key from options
  const queryKey = useMemo(
    () => ["news", "paginated", { category, source, search, useCached }],
    [category, source, search, useCached]
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = useInfiniteQuery<PaginatedResponse, Error>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const params: PaginationParams & { offset?: number } = {
        limit,
        category,
        source,
        search,
      };

      if (useCached) {
        // Offset-based pagination for cached endpoint
        params.offset = typeof pageParam === "number" ? pageParam : 0;
        return fetchCachedNewsPaginated(params);
      } else {
        // Cursor-based pagination for database endpoint
        params.cursor = typeof pageParam === "string" ? pageParam : undefined;
        return fetchNewsPaginated(params);
      }
    },
    initialPageParam: useCached ? 0 : undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      
      if (useCached) {
        // For offset pagination, calculate next offset
        return parseInt(lastPage.next_cursor || "0", 10);
      } else {
        // For cursor pagination, return the cursor string
        return lastPage.next_cursor;
      }
    },
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
  });

  // Flatten all pages into a single array
  const articles = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.articles);
  }, [data]);

  // Get total count from first page
  const totalCount = useMemo(() => {
    return data?.pages[0]?.total ?? 0;
  }, [data]);

  const handleFetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    articles,
    totalCount,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage: handleFetchNextPage,
    refetch,
    error: error ?? null,
  };
}
```

### 2.4 Virtual Grid Component

**File: `frontend/components/virtualized-grid.tsx`** (new file)

```tsx
"use client";

import { useRef, useCallback, useEffect, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Heart, PlusCircle, MinusCircle, Loader2 } from "lucide-react";
import type { NewsArticle } from "@/lib/api";
import { useReadingQueue } from "@/hooks/useReadingQueue";

// Configuration constants
const CARD_HEIGHT = 380; // Height of each article card
const CARD_WIDTH = 320; // Width of each article card
const GAP = 16; // Gap between cards
const OVERSCAN = 5; // Number of items to render outside viewport

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

  // Calculate columns based on container width
  const getColumnCount = useCallback(() => {
    if (!parentRef.current) return 4;
    const width = parentRef.current.offsetWidth;
    return Math.max(1, Math.floor((width - GAP) / (CARD_WIDTH + GAP)));
  }, []);

  // Row count based on articles and columns
  const columnCount = getColumnCount();
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
    const [lastItem] = [...rowVirtualizer.getVirtualItems()].reverse();

    if (!lastItem) return;

    // If we're at the last row and there's more to load
    if (
      lastItem.index >= rowCount - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
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
        className="flex-1 overflow-auto"
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
                {rowArticles.map((article, colIndex) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onClick={() => onArticleClick(article)}
                    style={{
                      width: CARD_WIDTH + GAP,
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
```

### 2.5 Query Client Provider

**File: `frontend/app/providers.tsx`** (update)

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "@/components/theme-provider";
import { useState, type ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // Create query client with optimized defaults
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data considered fresh for 30 seconds
            staleTime: 30 * 1000,
            // Keep unused data in cache for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry failed requests 3 times with exponential backoff
            retry: 3,
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 30000),
            // Don't refetch on window focus (user controls refresh)
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
```

### 2.6 Updated Grid View Integration

**File: `frontend/components/grid-view.tsx`** (modifications to integrate virtualization)

```tsx
// Add to existing imports
import { VirtualizedGrid } from "./virtualized-grid";
import { usePaginatedNews } from "@/hooks/usePaginatedNews";

// Add option to use virtualized mode
interface GridViewProps {
  articles: NewsArticle[];
  loading: boolean;
  onCountChange?: (count: number) => void;
  apiUrl?: string | null;
  useVirtualization?: boolean; // New prop
}

// In the component, add conditional rendering:
export function GridView({
  articles,
  loading,
  onCountChange,
  apiUrl,
  useVirtualization = false, // Default to legacy mode for backwards compat
}: GridViewProps) {
  // ... existing state ...

  // Use paginated hook when virtualization is enabled
  const {
    articles: paginatedArticles,
    totalCount,
    isLoading: paginatedLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = usePaginatedNews({
    category: selectedCategory === "All" ? undefined : selectedCategory,
    search: searchTerm || undefined,
    useCached: true,
  });

  // Use either paginated articles or props articles
  const displayArticles = useVirtualization ? paginatedArticles : filteredNews;
  const isLoadingState = useVirtualization ? paginatedLoading : loading;

  // ... existing code ...

  // Add virtualized grid rendering option
  if (useVirtualization && !isLoadingState) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden bg-background">
        {/* Category Filter Header */}
        <div className="flex-shrink-0 border-b border-border/30 bg-background/40 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3">
          {/* ... existing filter UI ... */}
        </div>

        {/* Search Bar */}
        <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 py-3 border-b border-border/30 bg-background/40 backdrop-blur-sm">
          {/* ... existing search UI ... */}
        </div>

        {/* Virtualized Grid */}
        <VirtualizedGrid
          articles={displayArticles}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          onArticleClick={handleArticleClick}
          totalCount={totalCount}
        />

        {/* Article Detail Modal */}
        <ArticleDetailModal
          article={selectedArticle}
          isOpen={isArticleModalOpen}
          onClose={() => {
            setIsArticleModalOpen(false);
            setSelectedArticle(null);
          }}
        />
      </div>
    );
  }

  // ... existing non-virtualized rendering ...
}
```

---

## Phase 3: Caching & Performance

### 3.1 Response Caching Headers

**File: `backend/app/api/routes/news.py`** (add to paginated endpoint)

```python
from fastapi import Response

@router.get("/page", response_model=PaginatedResponse)
async def get_news_paginated(
    response: Response,
    # ... existing params ...
) -> PaginatedResponse:
    # Add cache headers for CDN/browser caching
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    response.headers["Vary"] = "Accept-Encoding"
    
    # ... existing implementation ...
```

### 3.2 Frontend Request Deduplication

React Query handles this automatically, but we can add request batching for multiple filter changes:

**File: `frontend/lib/utils.ts`** (add debounce helper)

```typescript
// Debounce function for search input
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
```

### 3.3 Preloading Strategy

```typescript
// In usePaginatedNews hook, add prefetching
const queryClient = useQueryClient();

// Prefetch next page in background
useEffect(() => {
  if (hasNextPage && !isFetchingNextPage) {
    const nextPageParams = {
      ...queryKey[2],
      cursor: data?.pages[data.pages.length - 1]?.next_cursor,
    };
    
    queryClient.prefetchInfiniteQuery({
      queryKey: ["news", "paginated", nextPageParams],
      queryFn: () => fetchNewsPaginated(nextPageParams),
    });
  }
}, [data, hasNextPage, isFetchingNextPage, queryClient, queryKey]);
```

---

## Implementation Timeline

### Week 1: Backend Foundation

| Day | Task | Files |
|-----|------|-------|
| 1-2 | Implement paginated endpoint | `backend/app/api/routes/news.py` |
| 3 | Add database indexes | `backend/app/database.py`, SQL migrations |
| 4 | Add cache headers & testing | `backend/app/api/routes/news.py` |
| 5 | Backend integration tests | `backend/test_pagination.py` |

### Week 2: Frontend Integration

| Day | Task | Files |
|-----|------|-------|
| 1-2 | Install deps, create API functions | `frontend/lib/api.ts` |
| 3-4 | Build usePaginatedNews hook | `frontend/hooks/usePaginatedNews.ts` |
| 5 | Create VirtualizedGrid component | `frontend/components/virtualized-grid.tsx` |

### Week 3: Polish & Testing

| Day | Task | Files |
|-----|------|-------|
| 1-2 | Integrate with existing GridView | `frontend/components/grid-view.tsx` |
| 3 | Add QueryClient provider | `frontend/app/providers.tsx` |
| 4 | Performance testing & optimization | Various |
| 5 | Documentation & rollout | README.md, Log.md |

---

## Testing Strategy

### Backend Tests

```python
# backend/test_pagination.py
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_paginated_endpoint_returns_correct_structure():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/news/page?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert "articles" in data
        assert "total" in data
        assert "has_more" in data
        assert len(data["articles"]) <= 10

@pytest.mark.asyncio
async def test_cursor_pagination_consistency():
    async with AsyncClient(app=app, base_url="http://test") as client:
        # Get first page
        r1 = await client.get("/news/page?limit=5")
        page1 = r1.json()
        
        # Get second page using cursor
        if page1["next_cursor"]:
            r2 = await client.get(f"/news/page?limit=5&cursor={page1['next_cursor']}")
            page2 = r2.json()
            
            # No overlap between pages
            ids1 = {a["id"] for a in page1["articles"]}
            ids2 = {a["id"] for a in page2["articles"]}
            assert ids1.isdisjoint(ids2)

@pytest.mark.asyncio
async def test_category_filter():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/news/page?category=technology")
        data = response.json()
        for article in data["articles"]:
            assert article["category"] == "technology"
```

### Frontend Tests

```typescript
// frontend/__tests__/pagination.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePaginatedNews } from "@/hooks/usePaginatedNews";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("usePaginatedNews", () => {
  it("fetches initial page", async () => {
    const { result } = renderHook(() => usePaginatedNews({ limit: 10 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.articles.length).toBeGreaterThan(0);
    expect(result.current.totalCount).toBeGreaterThan(0);
  });

  it("fetches next page on scroll", async () => {
    const { result } = renderHook(() => usePaginatedNews({ limit: 10 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const initialCount = result.current.articles.length;

    if (result.current.hasNextPage) {
      result.current.fetchNextPage();
      await waitFor(() => expect(result.current.isFetchingNextPage).toBe(false));
      expect(result.current.articles.length).toBeGreaterThan(initialCount);
    }
  });
});
```

### Performance Benchmarks

```typescript
// Performance test script
const measurePerformance = async () => {
  const metrics = {
    initialLoadTime: 0,
    scrollFps: 0,
    memoryUsage: 0,
    timeToInteractive: 0,
  };

  // Measure initial load
  const loadStart = performance.now();
  await fetchNewsPaginated({ limit: 50 });
  metrics.initialLoadTime = performance.now() - loadStart;

  // Memory usage (if available)
  if (performance.memory) {
    metrics.memoryUsage = performance.memory.usedJSHeapSize / 1024 / 1024;
  }

  console.table(metrics);
  return metrics;
};
```

---

## Expected Outcomes

### Performance Metrics (After)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial Load Time | 4.2s | 0.3s | **93% faster** |
| Time to Interactive | 6.8s | 0.8s | **88% faster** |
| Memory Usage | 487MB | 85MB | **83% reduction** |
| Scroll FPS | 12-18 | 55-60 | **60fps smooth** |
| DOM Nodes | 8000+ | ~300 | **96% reduction** |

### User Experience Improvements

1. **Instant Initial Load** - First 50 articles render in <500ms
2. **Smooth Scrolling** - 60fps scroll performance regardless of dataset size
3. **Responsive Filtering** - Category/search changes reflect instantly
4. **Graceful Loading** - Clear loading states, no UI freezes
5. **Memory Efficient** - Stable memory usage even with 10k+ articles

### Rollback Strategy

The implementation includes a `useVirtualization` prop that defaults to `false`, allowing:
1. Gradual rollout via feature flag
2. Instant rollback by disabling the flag
3. A/B testing between implementations

---

## Feature Flag Configuration

**File: `frontend/lib/constants.ts`**

```typescript
// Feature flags for gradual rollout
export const FEATURE_FLAGS = {
  USE_PAGINATION: process.env.NEXT_PUBLIC_USE_PAGINATION === "true",
  USE_VIRTUALIZATION: process.env.NEXT_PUBLIC_USE_VIRTUALIZATION === "true",
  PAGINATION_PAGE_SIZE: parseInt(
    process.env.NEXT_PUBLIC_PAGINATION_PAGE_SIZE || "50",
    10
  ),
};
```

**File: `.env.local`**

```env
NEXT_PUBLIC_USE_PAGINATION=true
NEXT_PUBLIC_USE_VIRTUALIZATION=true
NEXT_PUBLIC_PAGINATION_PAGE_SIZE=50
```

---

## References

- [TanStack Virtual Documentation](https://tanstack.com/virtual/latest)
- [TanStack Query Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
- [FastAPI Pagination with SQLAlchemy](https://uriyyo-fastapi-pagination.netlify.app/)
- [React Window vs Virtual](https://blog.logrocket.com/virtual-scrolling-core-principles-and-basic-implementation-in-react/)
- [Cursor vs Offset Pagination](https://slack.engineering/evolving-api-pagination-at-slack/)
