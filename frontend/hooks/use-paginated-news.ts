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

interface ResolvedPaginatedNewsOptions {
  readonly limit: number;
  readonly category: string | undefined;
  readonly source: string | undefined;
  readonly sources: readonly string[] | undefined;
  readonly search: string | undefined;
  readonly useCached: boolean;
  readonly enabled: boolean;
}

const resolvePaginatedNewsOptions = ({
  category,
  enabled = true,
  limit = 50,
  search,
  source,
  sources,
  useCached = true,
}: UsePaginatedNewsOptions): ResolvedPaginatedNewsOptions => ({
  category,
  enabled,
  limit,
  search,
  source,
  sources,
  useCached,
});

const pageNumberSchema = z.number();
const pageStringSchema = z.string();
const pageParamSchema = z.union([pageNumberSchema, pageStringSchema]);
type PaginatedPageParam = z.infer<typeof pageParamSchema> | undefined;

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

const getPaginationRequestParams = (
  pageParam: PaginatedPageParam,
  options: Readonly<ResolvedPaginatedNewsOptions>,
): PaginationParams & { offset?: number } => {
  const serializedSources = serializeSources(options.sources);
  const params: PaginationParams & { offset?: number } = {
    category: options.category,
    limit: options.limit,
    search: options.search,
  };
  if (serializedSources !== undefined && serializedSources !== "") {
    params.sources = serializedSources;
  } else if (options.source !== undefined && options.source !== "") {
    params.source = options.source;
  }

  if (options.useCached) {
    params.offset = pageNumberSchema.safeParse(pageParam).data ?? 0;
  } else {
    params.cursor = pageStringSchema.safeParse(pageParam).data;
  }
  return params;
};

const usePaginatedNewsQuery = (options: Readonly<ResolvedPaginatedNewsOptions>) => {
  const queryKey = useMemo(
    () => [
      "news",
      "paginated",
      {
        category: options.category ?? null,
        limit: options.limit,
        search: options.search ?? null,
        source: options.source ?? null,
        sources: serializeSources(options.sources),
        useCached: options.useCached,
      },
    ],
    [options.category, options.limit, options.search, options.source, options.sources, options.useCached],
  );

  return useInfiniteQuery<PaginatedResponse>({
    enabled: options.enabled,
    gcTime: 5 * 60 * 1000,
    getNextPageParam: (lastPage) => getNextPageParam(lastPage, options.useCached),
    initialPageParam: getInitialPageParam(options.useCached),
    queryFn: async ({ pageParam }) => {
      const parsedPageParam = pageParamSchema.safeParse(pageParam).data;
      const params = getPaginationRequestParams(parsedPageParam, options);
      if (options.useCached) {
        return fetchCachedNewsPaginated(params);
      }
      return fetchNewsPaginated(params);
    },
    queryKey,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });
};

const getUniqueArticles = (
  pages:
    | readonly Readonly<{ readonly articles: readonly NewsArticle[] }>[]
    | undefined,
): NewsArticle[] => {
  if (!pages) {
    return [];
  }
  const allArticles = pages.flatMap((page) => page.articles);
  const seen = new Set<number>();
  return allArticles.filter((article) => {
    if (seen.has(article.id)) {
      return false;
    }
    seen.add(article.id);
    return true;
  });
};

export function usePaginatedNews(options: UsePaginatedNewsOptions = {}): UsePaginatedNewsReturn {
  const resolvedOptions = resolvePaginatedNewsOptions(options);
  const queryClient = useQueryClient();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } =
      usePaginatedNewsQuery(resolvedOptions);
  const articles = useMemo(() => getUniqueArticles(data?.pages), [data]);
  const totalCount = useMemo(() => data?.pages[0]?.total ?? 0, [data]);
  const handleFetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
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
