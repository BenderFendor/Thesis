"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { fetchLiveBrowseIndex } from '@/lib/api';
import type { NewsArticle } from '@/lib/api';
import { serializeSources } from "@/lib/utils"

interface UseLiveBrowseIndexOptions {
  category?: string
  source?: string
  sources?: string[]
  search?: string
  enabled?: boolean
}

interface UseLiveBrowseIndexReturn {
  articles: NewsArticle[]
  totalCount: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
  invalidate: () => void
}

export function useLiveBrowseIndex(
  options: UseLiveBrowseIndexOptions = {},
): UseLiveBrowseIndexReturn {
  const {
    category,
    source,
    sources,
    search,
    enabled = true,
  } = options,

   queryClient = useQueryClient(),
   serializedSources = useMemo(() => serializeSources(sources), [sources]),

   queryKey = useMemo(
    () => [
      "news",
      "live-browse-index",
      {
        category: category || null,
        search: search || null,
        source: source || null,
        sources: serializedSources,
      },
    ],
    [category, source, serializedSources, search],
  ),

   { data, isLoading, error, refetch } = useQuery({
    enabled,
    gcTime: 5 * 60 * 1000,
    queryFn: async () =>
      fetchLiveBrowseIndex({
        category,
        search,
        source,
        sources: serializedSources || undefined,
      }),
    queryKey,
    refetchOnWindowFocus: false,
    staleTime: 5 * 1000,
  }),

   invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["news", "live-browse-index"] })
  }, [queryClient])

  return {
    articles: data?.articles ?? [],
    error: error ?? null,
    invalidate,
    isLoading,
    refetch,
    totalCount: data?.total ?? 0,
  }
}
