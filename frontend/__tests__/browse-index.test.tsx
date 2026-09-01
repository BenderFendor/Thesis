import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { useBrowseIndex } from "@/hooks/use-browse-index"
import { mapBackendArticles } from "@/lib/api"

interface BrowseResponse {
  readonly articles: readonly {
    readonly bias: "center"
    readonly category: string
    readonly country: string
    readonly credibility: "high"
    readonly description: string
    readonly id: number
    readonly image: string
    readonly original_language: string
    readonly published_at: string
    readonly source: string
    readonly source_id: string
    readonly title: string
    readonly translated: boolean
    readonly url: string
  }[]
  readonly total: number
}

type FetchBoundary = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<FetchResponseFixture>

interface FetchResponseFixture {
  readonly json: () => Promise<BrowseResponse>
  readonly ok: boolean
  readonly status: number
}

const fetchMock = jest.fn<FetchBoundary>(),
 originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch"),

 createWrapper = () => {
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
    fetchMock.mockReset()
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    })
  })

  afterEach(() => {
    if (originalFetchDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "fetch")
    } else {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor)
    }
  })

  it("fetches the full browse index with stable multi-source serialization", async () => {  expect.hasAssertions();

    const response: BrowseResponse = {
      articles: [
        {
          bias: "center",
          category: "general",
          country: "US",
          credibility: "high",
          description: "Summary",
          id: 1,
          image: "/placeholder.svg",
          original_language: "en",
          published_at: "2026-08-31T00:00:00.000Z",
          source: "Test News",
          source_id: "test-news",
          title: "Article A",
          translated: false,
          url: "https://example.com/a",
        },
      ],
      total: 1,
    }
    fetchMock.mockResolvedValue({
      json: async () => response,
      ok: true,
      status: 200,
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

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requestUrl.pathname).toBe("/news/index")
    expect(requestUrl.searchParams.get("sources")).toBe("alpha-news,zeta-news")
    expect(result.current.totalCount).toBe(1)
    expect(result.current.articles).toHaveLength(1)
  })

  it("does not fetch when disabled", () => {  expect.hasAssertions();


    const { result } = renderHook(() => useBrowseIndex({ enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not synthesize full article content from summary-only browse rows", () => {  expect.hasAssertions();


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

  it("marks live cache rows without durable ids as unpersisted", () => {  expect.hasAssertions();


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
