import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

jest.mock<typeof import('@/lib/api')>("@/lib/api", () => {
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

describe("useLiveBrowseIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("fetches the live browse index with stable multi-source serialization", async () => {expect.hasAssertions();
    ;(jest.mocked(fetchLiveBrowseIndex)).mockResolvedValue({
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
          title: "Live Article",
          translated: false,
          url: "https://example.com/live",
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

  it("does not fetch when disabled", () => {expect.hasAssertions();
    const { result } = renderHook(() => useLiveBrowseIndex({ enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(fetchLiveBrowseIndex).not.toHaveBeenCalled()
  })
})
