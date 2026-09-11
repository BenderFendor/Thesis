"use client";

import type { NewsArticle, PaginatedResponse } from "@/lib/api";
import { fetchBrowseIndex, fetchLiveBrowseIndex } from "@/lib/api";
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { serializeSources } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";

type NewsIndexMode = "browse" | "live";

interface UseNewsIndexOptions {
  category?: string;
  enabled?: boolean;
  mode?: NewsIndexMode;
  search?: string;
  source?: string;
  sources?: string[];
}

interface UseNewsIndexReturn {
  articles: NewsArticle[];
  error: Error | null;
  invalidate: () => void;
  isLoading: boolean;
  refetch: () => void;
  totalCount: number;
}

const QUERY_PREFIX = ["news"] as const;

const getIndexName = (mode: NewsIndexMode): string => {
  if (mode === "live") {
    return "live-browse-index";
  }
  return "browse-index";
};

const getFetchIndex = (mode: NewsIndexMode) => {
  if (mode === "live") {
    return fetchLiveBrowseIndex;
  }
  return fetchBrowseIndex;
};

const getStaleTime = (mode: NewsIndexMode): number => {
  if (mode === "live") {
    return 5 * 1000;
  }
  return 30 * 1000;
};

const createQueryKey = (
  mode: NewsIndexMode,
  category: string | undefined,
  search: string | undefined,
  source: string | undefined,
  serializedSources: string | undefined,
) => [
  ...QUERY_PREFIX,
  getIndexName(mode),
  {
    category: category ?? null,
    search: search ?? null,
    source: source ?? null,
    sources: serializedSources,
  },
] as const;

export function useNewsIndex({
  category,
  enabled = true,
  mode = "browse",
  search,
  source,
  sources,
}: DeepReadonly<UseNewsIndexOptions> = {}): UseNewsIndexReturn {
  const queryClient = useQueryClient();
  const serializedSources = useMemo(() => serializeSources(sources), [sources]);
  const queryKey = useMemo(
    () => createQueryKey(mode, category, search, source, serializedSources),
    [category, mode, search, serializedSources, source],
  );
  const fetchIndex = getFetchIndex(mode);
  const { data, error, isLoading, refetch } = useQuery<PaginatedResponse>({
    enabled,
    gcTime: 5 * 60 * 1000,
    queryFn: () =>
      fetchIndex({
        category,
        search,
        source,
        sources: serializedSources ?? undefined,
      }),
    queryKey,
    refetchOnWindowFocus: false,
    staleTime: getStaleTime(mode),
  });
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...QUERY_PREFIX, queryKey[1]] });
  }, [queryClient, queryKey]);
  const handleRefetch = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    articles: data?.articles ?? [],
    error: error ?? null,
    invalidate,
    isLoading,
    refetch: handleRefetch,
    totalCount: data?.total ?? 0,
  };
}

export type { UseNewsIndexOptions, UseNewsIndexReturn };
