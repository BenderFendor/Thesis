"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { fetchLiveBrowseIndex, type NewsArticle } from "@/lib/api"

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

function serializeSources(sources?: string[]): string | null {
  if (!sources?.length) {
    return null
  }

  return [...sources].sort().join(",")
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
  } = options

  const queryClient = useQueryClient()
  const serializedSources = useMemo(() => serializeSources(sources), [sources])

  const queryKey = useMemo(
    () => [
      "news",
      "live-browse-index",
      {
        category: category || null,
        source: source || null,
        sources: serializedSources,
        search: search || null,
      },
    ],
    [category, source, serializedSources, search],
  )

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () =>
      fetchLiveBrowseIndex({
        category,
        source,
        sources: serializedSources || undefined,
        search,
      }),
    staleTime: 5 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  })

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["news", "live-browse-index"] })
  }, [queryClient])

  return {
    articles: data?.articles ?? [],
    totalCount: data?.total ?? 0,
    isLoading,
    error: error ?? null,
    refetch,
    invalidate,
  }
}
