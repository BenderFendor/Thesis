import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Tests for pagination hooks and components
 * Run with: npm test -- --testPathPattern=pagination
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";
import type { FC, ReactNode } from "react";

import { usePaginatedNews } from "@/hooks/use-paginated-news";

interface TestArticle {
  readonly bias: "left" | "center" | "right";
  readonly category: string;
  readonly country: string;
  readonly credibility: "high" | "medium" | "low";
  readonly id: number;
  readonly image: string;
  readonly originalLanguage: string;
  readonly publishedAt: string;
  readonly source: string;
  readonly sourceId: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly translated: boolean;
  readonly url: string;
}

interface BackendArticleFixture {
  readonly bias: TestArticle["bias"];
  readonly category: string;
  readonly country: string;
  readonly credibility: TestArticle["credibility"];
  readonly description: string;
  readonly id: number;
  readonly image: string;
  readonly original_language: string;
  readonly published_at: string;
  readonly source: string;
  readonly source_id: string;
  readonly title: string;
  readonly translated: boolean;
  readonly url: string;
}

interface PageResponseOptions {
  readonly hasMore: boolean;
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly total: number;
}

interface PagePayload {
  readonly articles: readonly BackendArticleFixture[];
  readonly has_more: boolean;
  readonly limit: number;
  readonly next_cursor: string | null;
  readonly prev_cursor: null;
  readonly total: number;
}

interface FetchResponseFixture {
  readonly json: () => Promise<PagePayload>;
  readonly ok: boolean;
  readonly status: number;
}

type FetchBoundary = (
  input: string,
  init?: RequestInit,
) => Promise<FetchResponseFixture>;

const createBackendArticle = (article: Readonly<TestArticle>): BackendArticleFixture => ({
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
    articles: articles.map((article) => createBackendArticle(article)),
    has_more: options.hasMore,
    limit: options.limit,
    next_cursor: options.nextCursor,
    prev_cursor: null,
    total: options.total,
  }),
  createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 0,
            retry: false,
          },
        },
      });
    const QueryClientWrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
    QueryClientWrapper.displayName = "QueryClientWrapper";
    return QueryClientWrapper;
  },
  fetchMock = jest.fn<FetchBoundary>(),
  getRequestedUrl = (input: string | undefined): URL => {
    if (input === undefined) {
      throw new Error("Expected a paginated fetch request");
    }
    return new URL(input);
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
  originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch"),
  respondWithPage = (payload: Readonly<PagePayload>): void => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve(payload),
      ok: true,
      status: 200,
    });
  };

const createDuplicateArticles = (): TestArticle[] => {
  const [firstArticle, secondArticle] = mockArticles;
  if (firstArticle === undefined || secondArticle === undefined) {
    throw new Error("Expected pagination fixture articles");
  }
  return [
    firstArticle,
    {
      ...firstArticle,
      bias: "left",
      source: "Test Source 2",
      sourceId: "test-source-2",
      summary: "Duplicate summary",
      title: "Test Article 1 Duplicate",
      url: "https://example.com/1-duplicate",
    },
    secondArticle,
  ];
};

const runShouldFetchInitialPageOfArticles = async () => {
    expect.hasAssertions();

    respondWithPage(
      createPagePayload(mockArticles, {
        hasMore: true,
        limit: 50,
        nextCursor: "50",
        total: 100,
      }),
    );

    const { result } = renderHook(() => usePaginatedNews({ limit: 50, useCached: true }), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.articles).toHaveLength(2);
    expect(result.current.totalCount).toBe(100);
    expect(result.current.hasNextPage).toBe(true);
};

const runShouldHandleEmptyResults = async () => {
    expect.hasAssertions();

    respondWithPage(
      createPagePayload([], {
        hasMore: false,
        limit: 50,
        nextCursor: null,
        total: 0,
      }),
    );

    const { result } = renderHook(() => usePaginatedNews({ limit: 50, useCached: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.articles).toHaveLength(0);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasNextPage).toBe(false);
};

const runShouldApplyCategoryFilter = async () => {
    expect.hasAssertions();

    respondWithPage(
      createPagePayload(
        mockArticles.filter((article) => article.category === "technology"),
        {
          hasMore: false,
          limit: 50,
          nextCursor: null,
          total: 2,
        },
      ),
    );

    const { result } = renderHook(
      () =>
        usePaginatedNews({
          category: "technology",
          limit: 50,
          useCached: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const requestUrl = getRequestedUrl(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.pathname).toBe("/news/page/cached");
    expect(requestUrl.searchParams.get("category")).toBe("technology");
};

const runShouldForwardMultiSourceFiltersWithoutMutatingTheInputArray = async () => {
    expect.hasAssertions();

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
        { wrapper: createWrapper() },
      );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const requestUrl = getRequestedUrl(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.searchParams.get("sources")).toBe("alpha-news,zeta-news");
    expect(sources).toStrictEqual(["zeta-news", "alpha-news"]);
};

const runShouldNotFetchWhenDisabled = () => {
    expect.hasAssertions();

    const { result } = renderHook(
      () =>
        usePaginatedNews({
          enabled: false,
          limit: 50,
          useCached: true,
        }),
      { wrapper: createWrapper() },
    );

    // Should not be loading when disabled
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
};

const runShouldHandleApiErrorsGracefully = async () => {
    expect.hasAssertions();

    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => usePaginatedNews({ limit: 50, useCached: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.articles).toHaveLength(0);
};

const runShouldDeduplicateArticlesWithTheSameId = async () => {
    expect.hasAssertions();

    respondWithPage(
      createPagePayload(createDuplicateArticles(), {
        hasMore: false,
        limit: 50,
        nextCursor: null,
        total: 3,
      }),
    );

    const { result } = renderHook(() => usePaginatedNews({ limit: 50, useCached: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should only have 2 articles (deduplicated by ID)
    expect(result.current.articles).toHaveLength(2);
    // The first occurrence should be kept
    const [firstArticle, secondArticle] = result.current.articles;
    expect(firstArticle?.id).toBe(1);
    expect(firstArticle?.title).toBe("Test Article 1");
    expect(secondArticle?.id).toBe(2);
};

const runShouldRequest500ArticlesForScrollSizedCachedFetches = async () => {
    expect.hasAssertions();

    respondWithPage(
      createPagePayload(mockArticles, {
        hasMore: true,
        limit: 500,
        nextCursor: "500",
        total: 1000,
      }),
    );

    const { result } = renderHook(() => usePaginatedNews({ limit: 500, useCached: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const requestUrl = getRequestedUrl(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl.searchParams.get("limit")).toBe("500");
    expect(result.current.hasNextPage).toBe(true);
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

  it("should fetch initial page of articles", async () => {
    await runShouldFetchInitialPageOfArticles();
    expect.hasAssertions();
  });

  it("should handle empty results", async () => {
    await runShouldHandleEmptyResults();
    expect.hasAssertions();
  });

  it("should apply category filter", async () => {
    await runShouldApplyCategoryFilter();
    expect.hasAssertions();
  });

  it("should forward multi-source filters without mutating the input array", async () => {
    await runShouldForwardMultiSourceFiltersWithoutMutatingTheInputArray();
    expect.hasAssertions();
  });

  it("should not fetch when disabled", () => {
    runShouldNotFetchWhenDisabled();
    expect.hasAssertions();
  });

  it("should handle API errors gracefully", async () => {
    await runShouldHandleApiErrorsGracefully();
    expect.hasAssertions();
  });

  it("should deduplicate articles with the same ID", async () => {
    await runShouldDeduplicateArticlesWithTheSameId();
    expect.hasAssertions();
  });

  it("should request 500 articles for scroll-sized cached fetches", async () => {
    await runShouldRequest500ArticlesForScrollSizedCachedFetches();
    expect.hasAssertions();
  });
});
