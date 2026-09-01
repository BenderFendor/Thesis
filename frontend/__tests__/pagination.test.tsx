
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Tests for pagination hooks and components
 * Run with: npm test -- --testPathPattern=pagination
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { usePaginatedNews } from "@/hooks/usePaginatedNews";

interface TestArticle {
  readonly bias: "left" | "center" | "right"
  readonly category: string
  readonly country: string
  readonly credibility: "high" | "medium" | "low"
  readonly id: number
  readonly image: string
  readonly originalLanguage: string
  readonly publishedAt: string
  readonly source: string
  readonly sourceId: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly title: string
  readonly translated: boolean
  readonly url: string
}

interface BackendArticleFixture {
  readonly bias: TestArticle["bias"]
  readonly category: string
  readonly country: string
  readonly credibility: TestArticle["credibility"]
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
}

interface PageResponseOptions {
  readonly hasMore: boolean
  readonly limit: number
  readonly nextCursor: string | null
  readonly total: number
}

interface PagePayload {
  readonly articles: BackendArticleFixture[]
  readonly has_more: boolean
  readonly limit: number
  readonly next_cursor: string | null
  readonly prev_cursor: null
  readonly total: number
}

interface FetchResponseFixture {
  readonly json: () => Promise<PagePayload>
  readonly ok: boolean
  readonly status: number
}

type FetchBoundary = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<FetchResponseFixture>

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
  );
  QueryClientWrapper.displayName = "QueryClientWrapper";
  return QueryClientWrapper;
},

 mockArticles: TestArticle[] = [
  {
    bias: "center",
    category: "technology",
    country: "United States",
    credibility: "high",
    id: 1,
    image: "/placeholder.svg",
    originalLanguage: "en",
    publishedAt: new Date().toISOString(),
    source: "Test Source",
    sourceId: "test-source",
    summary: "Test summary",
    tags: ["test"],
    title: "Test Article 1",
    translated: false,
    url: "https://example.com/1",
  },
  {
    bias: "center",
    category: "technology",
    country: "United States",
    credibility: "high",
    id: 2,
    image: "/placeholder.svg",
    originalLanguage: "en",
    publishedAt: new Date().toISOString(),
    source: "Test Source",
    sourceId: "test-source",
    summary: "Test summary 2",
    tags: ["test"],
    title: "Test Article 2",
    translated: false,
    url: "https://example.com/2",
  },
],

 createBackendArticle = (article: Readonly<TestArticle>): BackendArticleFixture => ({
  bias: article.bias,
  category: article.category,
  country: article.country,
  credibility: article.credibility,
  description: article.summary,
  id: article.id,
  image: article.image,
  original_language: article.originalLanguage,
  published_at: article.publishedAt,
  source: article.source,
  source_id: article.sourceId,
  title: article.title,
  translated: article.translated,
  url: article.url,
}),

 createPagePayload = (
  articles: readonly TestArticle[],
  options: Readonly<PageResponseOptions>,
): PagePayload => ({
  articles: articles.map(createBackendArticle),
  has_more: options.hasMore,
  limit: options.limit,
  next_cursor: options.nextCursor,
  prev_cursor: null,
  total: options.total,
}),

 respondWithPage = (payload: Readonly<PagePayload>): void => {
  fetchMock.mockResolvedValueOnce({
    json: async () => payload,
    ok: true,
    status: 200,
  });
},

 getRequestedUrl = (input: RequestInfo | URL | undefined): URL => {
  if (input === undefined) {
    throw new Error("Expected a paginated fetch request");
  }
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
};

describe("usePaginatedNews", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalFetchDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "fetch");
    } else {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    }
  });

  it("should fetch initial page of articles", async () => {  expect.hasAssertions();

    respondWithPage(
      createPagePayload(mockArticles, {
        hasMore: true,
        limit: 50,
        nextCursor: "50",
        total: 100,
      }),
    );

    const { result } = renderHook(
      () => usePaginatedNews({ limit: 50, useCached: true }),
      { wrapper: createWrapper() }
    );

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.articles).toHaveLength(2);
    expect(result.current.totalCount).toBe(100);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("should handle empty results", async () => {  expect.hasAssertions();

    respondWithPage(
      createPagePayload([], {
        hasMore: false,
        limit: 50,
        nextCursor: null,
        total: 0,
      }),
    );

    const { result } = renderHook(
      () => usePaginatedNews({ limit: 50, useCached: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.articles).toHaveLength(0);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("should apply category filter", async () => {  expect.hasAssertions();

    respondWithPage(
      createPagePayload(mockArticles.filter((article) => article.category === "technology"), {
        hasMore: false,
        limit: 50,
        nextCursor: null,
        total: 2,
      }),
    );

    const { result } = renderHook(
      () =>
        usePaginatedNews({
          category: "technology",
          limit: 50,
          useCached: true,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const requestUrl = getRequestedUrl(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.pathname).toBe("/news/page/cached");
    expect(requestUrl.searchParams.get("category")).toBe("technology");
  });

  it("should forward multi-source filters without mutating the input array", async () => {  expect.hasAssertions();

    respondWithPage(
      createPagePayload(mockArticles, {
        hasMore: false,
        limit: 50,
        nextCursor: null,
        total: 2,
      }),
    );

    const sources = ["zeta-news", "alpha-news"],

     { result } = renderHook(
      () =>
        usePaginatedNews({
          limit: 50,
          sources,
          useCached: true,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const requestUrl = getRequestedUrl(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.searchParams.get("sources")).toBe("alpha-news,zeta-news");
    expect(sources).toStrictEqual(["zeta-news", "alpha-news"]);
  });

  it("should not fetch when disabled", async () => {  expect.hasAssertions();

    const { result } = renderHook(
      () =>
        usePaginatedNews({
          enabled: false,
          limit: 50,
          useCached: true,
        }),
      { wrapper: createWrapper() }
    );

    // Should not be loading when disabled
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should handle API errors gracefully", async () => {  expect.hasAssertions();

    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(
      () => usePaginatedNews({ limit: 50, useCached: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.articles).toHaveLength(0);
  });

  it("should deduplicate articles with the same ID", async () => {  expect.hasAssertions();

    // Create duplicate articles with the same ID
    const duplicateArticles: TestArticle[] = [
      {
        bias: "center",
        category: "technology",
        country: "United States",
        credibility: "high",
        id: 1,
        image: "/placeholder.svg",
        originalLanguage: "en",
        publishedAt: new Date().toISOString(),
        source: "Test Source",
        sourceId: "test-source",
        summary: "Test summary",
        tags: ["test"],
        title: "Test Article 1",
        translated: false,
        url: "https://example.com/1",
      },
      {
        bias: "left",
        category: "technology",
        country: "United States",
        credibility: "high",
        id: 1, // Same ID as above
        image: "/placeholder.svg",
        originalLanguage: "en",
        publishedAt: new Date().toISOString(),
        source: "Test Source 2",
        sourceId: "test-source-2",
        summary: "Duplicate summary",
        tags: ["test"],
        title: "Test Article 1 Duplicate",
        translated: false,
        url: "https://example.com/1-duplicate",
      },
      {
        bias: "center",
        category: "technology",
        country: "United States",
        credibility: "high",
        id: 2,
        image: "/placeholder.svg",
        originalLanguage: "en",
        publishedAt: new Date().toISOString(),
        source: "Test Source",
        sourceId: "test-source",
        summary: "Test summary 2",
        tags: ["test"],
        title: "Test Article 2",
        translated: false,
        url: "https://example.com/2",
      },
    ];

    respondWithPage(
      createPagePayload(duplicateArticles, {
        hasMore: false,
        limit: 50,
        nextCursor: null,
        total: 3,
      }),
    );

    const { result } = renderHook(
      () => usePaginatedNews({ limit: 50, useCached: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should only have 2 articles (deduplicated by ID)
    expect(result.current.articles).toHaveLength(2);
    // The first occurrence should be kept
    expect(result.current.articles[0]!.id).toBe(1);
    expect(result.current.articles[0]!.title).toBe("Test Article 1");
    expect(result.current.articles[1]!.id).toBe(2);
  });

  it("should request 500 articles for scroll-sized cached fetches", async () => {  expect.hasAssertions();

    respondWithPage(
      createPagePayload(mockArticles, {
        hasMore: true,
        limit: 500,
        nextCursor: "500",
        total: 1000,
      }),
    );

    const { result } = renderHook(
      () => usePaginatedNews({ limit: 500, useCached: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const requestUrl = getRequestedUrl(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.searchParams.get("limit")).toBe("500");
    expect(result.current.hasNextPage).toBe(true);
  });
});
