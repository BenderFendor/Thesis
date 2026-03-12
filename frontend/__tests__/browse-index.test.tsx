import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api")
  return {
    ...actual,
    fetchBrowseIndex: jest.fn(),
  }
})

import { useBrowseIndex } from "@/hooks/useBrowseIndex"
import { fetchBrowseIndex } from "@/lib/api"
import { mapBackendArticles } from "@/lib/api"

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

  const QueryClientWrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  QueryClientWrapper.displayName = "QueryClientWrapper"
  return QueryClientWrapper
}

describe("useBrowseIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("fetches the full browse index with stable multi-source serialization", async () => {
    ;(fetchBrowseIndex as jest.Mock).mockResolvedValue({
      articles: [
        {
          id: 1,
          title: "Article A",
          source: "Test News",
          sourceId: "test-news",
          country: "US",
          credibility: "high",
          bias: "center",
          summary: "Summary",
          image: "/placeholder.svg",
          publishedAt: new Date().toISOString(),
          category: "general",
          url: "https://example.com/a",
          tags: [],
          originalLanguage: "en",
          translated: false,
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

  it("does not fetch when disabled", () => {
    const { result } = renderHook(() => useBrowseIndex({ enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(fetchBrowseIndex).not.toHaveBeenCalled()
  })

  it("does not synthesize full article content from summary-only browse rows", () => {
    const [article] = mapBackendArticles([
      {
        id: 1,
        title: "Article A",
        source: "Test News",
        description: "Short browse summary",
        published_at: new Date().toISOString(),
        category: "general",
        url: "https://example.com/a",
      },
    ])

    expect(article.summary).toBe("Short browse summary")
    expect(article.content).toBeUndefined()
    expect(article.hasFullContent).toBe(false)
  })
})
