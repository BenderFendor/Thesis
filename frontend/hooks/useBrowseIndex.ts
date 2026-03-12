"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import { fetchBrowseIndex, type NewsArticle } from "@/lib/api"

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

function serializeSources(sources?: string[]): string | null {
  if (!sources?.length) {
    return null
  }

  return [...sources].sort().join(",")
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
  } = options

  const queryClient = useQueryClient()

  const serializedSources = useMemo(() => serializeSources(sources), [sources])

  const queryKey = useMemo(
    () => [
      "news",
      "browse-index",
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
      fetchBrowseIndex({
        category,
        source,
        sources: serializedSources || undefined,
        search,
      }),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  })

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["news", "browse-index"] })
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
