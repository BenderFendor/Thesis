"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useEffect } from "react";
import {
  fetchNewsPaginated,
  fetchCachedNewsPaginated,
  NewsArticle,
  PaginatedResponse,
  PaginationParams,
} from "@/lib/api";

interface UsePaginatedNewsOptions {
  limit?: number;
  category?: string;
  source?: string;
  sources?: string[];  // NEW: Multi-source selection
  search?: string;
  useCached?: boolean;
  enabled?: boolean;
}

interface UsePaginatedNewsReturn {
  articles: NewsArticle[];
  totalCount: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  invalidate: () => void;  // NEW: Explicit invalidation
  error: Error | null;
}

export function usePaginatedNews(
  options: UsePaginatedNewsOptions = {}
): UsePaginatedNewsReturn {
  const {
    limit = 50,
    category,
    source,
    sources,
    search,
    useCached = true,
    enabled = true,
  } = options;

  const queryClient = useQueryClient();

  // Build query key from ALL filter options for proper cache management
  // When filters change, React Query will refetch with new filters
  const queryKey = useMemo(
    () => [
      "news",
      "paginated",
      {
        category: category || null,
        source: source || null,
        sources: sources?.length ? sources.sort().join(",") : null,
        search: search || null,
        useCached,
      },
    ],
    [category, source, sources, search, useCached]
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
      // Build params with multi-source support
      const params: PaginationParams & { offset?: number; sources?: string } = {
        limit,
        category,
        search,
      };

      // Use sources array if provided, otherwise fall back to single source
      if (sources?.length) {
        params.sources = sources.join(",");
      } else if (source) {
        params.source = source;
      }

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
    enabled,
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

  // Invalidate all news queries (used when SSE signals new content)
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["news"] });
  }, [queryClient]);

  return {
    articles,
    totalCount,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage: handleFetchNextPage,
    refetch,
    invalidate,
    error: error ?? null,
  };
}
