import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Tests for pagination hooks and components
 * Run with: npm test -- --testPathPattern=pagination
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the API functions
jest.mock<typeof import('@/lib/api')>("@/lib/api", () => ({
  fetchCachedNewsPaginated: jest.fn(),
  fetchNewsPaginated: jest.fn(),
}));

import { usePaginatedNews } from "@/hooks/usePaginatedNews";
import { fetchCachedNewsPaginated } from "@/lib/api";

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
  );
  QueryClientWrapper.displayName = "QueryClientWrapper";
  return QueryClientWrapper;
},

 mockArticles = [
  {
    bias: "center" as const,
    category: "technology",
    country: "United States",
    credibility: "high" as const,
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
    bias: "center" as const,
    category: "technology",
    country: "United States",
    credibility: "high" as const,
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

describe("usePaginatedNews", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch initial page of articles", async () => {  expect.hasAssertions();
  
    (jest.mocked(fetchCachedNewsPaginated)).mockResolvedValue({
      articles: mockArticles,
      has_more: true,
      limit: 50,
      next_cursor: "50",
      prev_cursor: null,
      total: 100,
    });

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
  
    (jest.mocked(fetchCachedNewsPaginated)).mockResolvedValue({
      articles: [],
      has_more: false,
      limit: 50,
      next_cursor: null,
      prev_cursor: null,
      total: 0,
    });

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
  
    (jest.mocked(fetchCachedNewsPaginated)).mockResolvedValue({
      articles: mockArticles.filter((a) => a.category === "technology"),
      has_more: false,
      limit: 50,
      next_cursor: null,
      prev_cursor: null,
      total: 2,
    });

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

    expect(fetchCachedNewsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "technology",
      })
    );
  });

  it("should forward multi-source filters without mutating the input array", async () => {  expect.hasAssertions();
  
    (jest.mocked(fetchCachedNewsPaginated)).mockResolvedValue({
      articles: mockArticles,
      has_more: false,
      limit: 50,
      next_cursor: null,
      prev_cursor: null,
      total: 2,
    });

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

    expect(fetchCachedNewsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: "alpha-news,zeta-news",
      })
    );
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
    expect(fetchCachedNewsPaginated).not.toHaveBeenCalled();
  });

  it("should handle API errors gracefully", async () => {  expect.hasAssertions();
  
    (jest.mocked(fetchCachedNewsPaginated)).mockRejectedValue(
      new Error("Network error")
    );

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
    const duplicateArticles = [
      {
        bias: "center" as const,
        category: "technology",
        country: "United States",
        credibility: "high" as const,
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
        bias: "left" as const,
        category: "technology",
        country: "United States",
        credibility: "high" as const,
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
        bias: "center" as const,
        category: "technology",
        country: "United States",
        credibility: "high" as const,
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

    (jest.mocked(fetchCachedNewsPaginated)).mockResolvedValue({
      articles: duplicateArticles,
      has_more: false,
      limit: 50,
      next_cursor: null,
      prev_cursor: null,
      total: 3,
    });

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
  
    (jest.mocked(fetchCachedNewsPaginated)).mockResolvedValue({
      articles: mockArticles,
      has_more: true,
      limit: 500,
      next_cursor: "500",
      prev_cursor: null,
      total: 1000,
    });

    const { result } = renderHook(
      () => usePaginatedNews({ limit: 500, useCached: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchCachedNewsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 })
    );
    expect(result.current.hasNextPage).toBe(true);
  });
});
