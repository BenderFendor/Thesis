"use client"

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import type {
  NewsArticle,
  PaginatedResponse,
  PaginationParams} from "@/lib/api";
import {
  fetchCachedNewsPaginated,
  fetchNewsPaginated
} from "@/lib/api"
import { serializeSources } from "@/lib/utils"

interface UsePaginatedNewsOptions {
  limit?: number
  category?: string
  source?: string
  sources?: string[]
  search?: string
  useCached?: boolean
  enabled?: boolean
}

interface UsePaginatedNewsReturn {
  articles: NewsArticle[]
  totalCount: number
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => void
  refetch: () => void
  invalidate: () => void
  error: Error | null
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
  } = options,

   queryClient = useQueryClient(),

   queryKey = useMemo(
    () => [
      "news",
      "paginated",
      {
        category: category || null,
        limit,
        search: search || null,
        source: source || null,
        sources: serializeSources(sources),
        useCached,
      },
    ],
    [limit, category, source, sources, search, useCached]
  ),

   {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = useInfiniteQuery<PaginatedResponse>({
    enabled,
    gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) {return}

      if (useCached) {
        return parseInt(lastPage.next_cursor || "0", 10)
      }
        return lastPage.next_cursor
      
    },
    initialPageParam: useCached ? 0 : undefined,
    queryFn: async ({ pageParam }) => {
      const params: PaginationParams & { offset?: number } = {
        category,
        limit,
        search,
      },

       serializedSources = serializeSources(sources)
      if (serializedSources) {
        params.sources = serializedSources
      } else if (source) {
        params.source = source
      }

      if (useCached) {
        params.offset = typeof pageParam === "number" ? pageParam : 0
        return fetchCachedNewsPaginated(params)
      }
        params.cursor = typeof pageParam === "string" ? pageParam : undefined
        return fetchNewsPaginated(params)
      
    },
    queryKey,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000, // 30 seconds,
  }),

   articles = useMemo(() => {
    if (!data?.pages) {return []}
    const allArticles = data.pages.flatMap((page) => page.articles),
    // Deduplicate by ID to handle potential backend duplicates
     seen = new Set<number>()
    return allArticles.filter((article) => {
      if (seen.has(article.id)) {
        return false
      }
      seen.add(article.id)
      return true
    })
  }, [data]),

   totalCount = useMemo(() => 
    data?.pages[0]?.total ?? 0
  , [data]),

   handleFetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]),

   invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["news"] })
  }, [queryClient])

  return {
    articles,
    error: error ?? null,
    fetchNextPage: handleFetchNextPage,
    hasNextPage: hasNextPage ?? false,
    invalidate,
    isFetchingNextPage,
    isLoading,
    refetch,
    totalCount,
  }
}
