"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
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
    enabled = true,
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
