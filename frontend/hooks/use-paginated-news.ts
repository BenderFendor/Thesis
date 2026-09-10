"use client";

import type { NewsArticle, PaginatedResponse, PaginationParams } from "@/lib/api";
import { fetchCachedNewsPaginated, fetchNewsPaginated } from "@/lib/api";
import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { serializeSources } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { z } from "zod";

interface UsePaginatedNewsOptions {
  readonly limit?: number;
  readonly category?: string;
  readonly source?: string;
  readonly sources?: readonly string[];
  readonly search?: string;
  readonly useCached?: boolean;
  readonly enabled?: boolean;
}

const pageNumberSchema = z.number();
const pageStringSchema = z.string();

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

const getNextPageParam = (
  lastPage: DeepReadonly<PaginatedResponse>,
  useCached: boolean,
): number | string | undefined => {
  if (!lastPage.has_more || lastPage.next_cursor === null) {
    return void 0;
  }
  if (useCached) {
    return Math.trunc(Number(lastPage.next_cursor));
  }
  return lastPage.next_cursor;
};

const getInitialPageParam = (useCached: boolean): number | undefined => {
  if (useCached) {
    return 0;
  }
  return void 0;
};

export function usePaginatedNews(options: UsePaginatedNewsOptions = {}): UsePaginatedNewsReturn {
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
          category: category ?? null,
          limit,
          search: search ?? null,
          source: source ?? null,
          sources: serializeSources(sources),
          useCached,
        },
      ],
      [limit, category, source, sources, search, useCached],
    );
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } =
      useInfiniteQuery<PaginatedResponse>({
        enabled,
        // 5 minutes (formerly cacheTime)
        gcTime: 5 * 60 * 1000,
        getNextPageParam: (lastPage) => getNextPageParam(lastPage, useCached),
        initialPageParam: getInitialPageParam(useCached),
        queryFn: async ({ pageParam }) => {
          const params: PaginationParams & { offset?: number } = {
              category,
              limit,
              search,
            },
            serializedSources = serializeSources(sources);
          if (serializedSources !== undefined && serializedSources !== "") {
            params.sources = serializedSources;
          } else if (source !== undefined && source !== "") {
            params.source = source;
          }

          if (useCached) {
            params.offset = pageNumberSchema.safeParse(pageParam).data ?? 0;
            return fetchCachedNewsPaginated(params);
          }
          params.cursor = pageStringSchema.safeParse(pageParam).data;
          return fetchNewsPaginated(params);
        },
        queryKey,
        refetchOnWindowFocus: false,
        // 30 seconds,
        staleTime: 30 * 1000,
      });
  const articles = useMemo(() => {
      if (!data?.pages) {
        return [];
      }
      const allArticles = data.pages.flatMap((page) => page.articles),
        // Deduplicate by ID to handle potential backend duplicates
        seen = new Set<number>();
      return allArticles.filter((article) => {
        if (seen.has(article.id)) {
          return false;
        }
        seen.add(article.id);
        return true;
      });
    }, [data]);
  const totalCount = useMemo(() => data?.pages[0]?.total ?? 0, [data]);
  const handleFetchNextPage = useCallback(() => {
      if (hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const invalidate = useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["news"] });
    }, [queryClient]);
  const handleRefetch = useCallback(() => {
      void refetch();
    }, [refetch]);

  return {
    articles,
    error: error ?? null,
    fetchNextPage: handleFetchNextPage,
    hasNextPage: hasNextPage ?? false,
    invalidate,
    isFetchingNextPage,
    isLoading,
    refetch: handleRefetch,
    totalCount,
  };
}
