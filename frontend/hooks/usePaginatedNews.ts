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
  sources?: string[];
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
  invalidate: () => void;
  error: Error | null;
}

function serializeSources(sources?: string[]): string | null {
  if (!sources?.length) {
    return null;
  }

  return [...sources].sort().join(",");
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

  const queryKey = useMemo(
    () => [
      "news",
      "paginated",
      {
        category: category || null,
        source: source || null,
        sources: serializeSources(sources),
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
        search,
      };

      const serializedSources = serializeSources(sources);
      if (serializedSources) {
        params.sources = serializedSources;
      } else if (source) {
        params.source = source;
      }

      if (useCached) {
        params.offset = typeof pageParam === "number" ? pageParam : 0;
        return fetchCachedNewsPaginated(params);
      } else {
        params.cursor = typeof pageParam === "string" ? pageParam : undefined;
        return fetchNewsPaginated(params);
      }
    },
    initialPageParam: useCached ? 0 : undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;

      if (useCached) {
        return parseInt(lastPage.next_cursor || "0", 10);
      } else {
        return lastPage.next_cursor;
      }
    },
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    enabled,
  });

  const articles = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.articles);
  }, [data]);

  const totalCount = useMemo(() => {
    return data?.pages[0]?.total ?? 0;
  }, [data]);

  const handleFetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
