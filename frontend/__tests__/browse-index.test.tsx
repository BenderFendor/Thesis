import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

jest.mock<typeof import('@/lib/api')>("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api")
  return {
    ...actual,
    fetchBrowseIndex: jest.fn(),
  }
})

import { useBrowseIndex } from "@/hooks/use-browse-index"
import { fetchBrowseIndex,mapBackendArticles } from "@/lib/api"

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  }),

   QueryClientWrapper = ({ children }:Readonly< { children: ReactNode }>) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  QueryClientWrapper.displayName = "QueryClientWrapper"
  return QueryClientWrapper
}

describe("useBrowseIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("fetches the full browse index with stable multi-source serialization", async () => {expect.hasAssertions();
    ;(jest.mocked(fetchBrowseIndex)).mockResolvedValue({
      articles: [
        {
          bias: "center",
          category: "general",
          country: "US",
          credibility: "high",
          id: 1,
          image: "/placeholder.svg",
          originalLanguage: "en",
          publishedAt: new Date().toISOString(),
          source: "Test News",
          sourceId: "test-news",
          summary: "Summary",
          tags: [],
          title: "Article A",
          translated: false,
          url: "https://example.com/a",
        },
      ],
      total: 1,
    })

    const { result } = renderHook(
      () =>
        useBrowseIndex({
          sources: ["zeta-news", "alpha-news"],
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(fetchBrowseIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: "alpha-news,zeta-news",
      }),
    )
    expect(result.current.totalCount).toBe(1)
    expect(result.current.articles).toHaveLength(1)
  })

  it("does not fetch when disabled", () => {expect.hasAssertions();
    const { result } = renderHook(() => useBrowseIndex({ enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(fetchBrowseIndex).not.toHaveBeenCalled()
  })

  it("does not synthesize full article content from summary-only browse rows", () => {expect.hasAssertions();
    const [article] = mapBackendArticles([
      {
        category: "general",
        description: "Short browse summary",
        id: 1,
        published_at: new Date().toISOString(),
        source: "Test News",
        title: "Article A",
        url: "https://example.com/a",
      },
    ])

    expect(article!.summary).toBe("Short browse summary")
    expect(article!.content).toBeUndefined()
    expect(article!.hasFullContent).toBe(false)
  })

  it("marks live cache rows without durable ids as unpersisted", () => {expect.hasAssertions();
    const [article] = mapBackendArticles([
      {
        category: "general",
        description: "Short browse summary",
        is_persisted: false,
        published_at: new Date().toISOString(),
        source: "Test News",
        title: "Live cache row",
        url: "https://example.com/live-cache",
      },
    ])

    expect(article!.id).toStrictEqual(expect.any(Number))
    expect(article!.isPersisted).toBe(false)
  })
})
