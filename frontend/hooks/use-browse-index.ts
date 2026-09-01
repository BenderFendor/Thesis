"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { fetchBrowseIndex } from '@/lib/api';
import type { NewsArticle } from '@/lib/api';
import { serializeSources } from "@/lib/utils"

interface UseBrowseIndexOptions {
  category?: string
  source?: string
  sources?: string[]
  search?: string
  enabled?: boolean
}

interface UseBrowseIndexReturn {
  articles: NewsArticle[]
  totalCount: number
  isLoading: boolean
  error: Error | null
  refetch: () => void
  invalidate: () => void
}

export function useBrowseIndex(
  options: UseBrowseIndexOptions = {},
): UseBrowseIndexReturn {
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
      "browse-index",
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
      fetchBrowseIndex({
        category,
        search,
        source,
        sources: serializedSources || undefined,
      }),
    queryKey,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  }),

   invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["news", "browse-index"] })
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
