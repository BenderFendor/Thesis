import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api")
  return {
    ...actual,
    fetchLiveBrowseIndex: jest.fn(),
  }
})

import { useLiveBrowseIndex } from "@/hooks/useLiveBrowseIndex"
import { fetchLiveBrowseIndex } from "@/lib/api"

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

describe("useLiveBrowseIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("fetches the live browse index with stable multi-source serialization", async () => {
    ;(fetchLiveBrowseIndex as jest.Mock).mockResolvedValue({
      articles: [
        {
          id: 1,
          title: "Live Article",
          source: "Test News",
          sourceId: "test-news",
          country: "US",
          credibility: "high",
          bias: "center",
          summary: "Summary",
          image: "/placeholder.svg",
          publishedAt: new Date().toISOString(),
          category: "general",
          url: "https://example.com/live",
          tags: [],
          originalLanguage: "en",
          translated: false,
        },
      ],
      total: 1,
    })

    const { result } = renderHook(
      () =>
        useLiveBrowseIndex({
          sources: ["zeta-news", "alpha-news"],
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(fetchLiveBrowseIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: "alpha-news,zeta-news",
      }),
    )
    expect(result.current.totalCount).toBe(1)
    expect(result.current.articles).toHaveLength(1)
  })

  it("does not fetch when disabled", () => {
    const { result } = renderHook(() => useLiveBrowseIndex({ enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(fetchLiveBrowseIndex).not.toHaveBeenCalled()
  })
})
