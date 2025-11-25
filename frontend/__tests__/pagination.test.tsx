/**
 * Tests for pagination hooks and components
 * Run with: npm test -- --testPathPattern=pagination
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

// Mock the API functions
jest.mock("@/lib/api", () => ({
  fetchNewsPaginated: jest.fn(),
  fetchCachedNewsPaginated: jest.fn(),
}));

import { usePaginatedNews } from "@/hooks/usePaginatedNews";
import { fetchCachedNewsPaginated } from "@/lib/api";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockArticles = [
  {
    id: 1,
    title: "Test Article 1",
    source: "Test Source",
    sourceId: "test-source",
    country: "United States",
    credibility: "high" as const,
    bias: "center" as const,
    summary: "Test summary",
    image: "/placeholder.svg",
    publishedAt: new Date().toISOString(),
    category: "technology",
    url: "https://example.com/1",
    tags: ["test"],
    originalLanguage: "en",
    translated: false,
  },
  {
    id: 2,
    title: "Test Article 2",
    source: "Test Source",
    sourceId: "test-source",
    country: "United States",
    credibility: "high" as const,
    bias: "center" as const,
    summary: "Test summary 2",
    image: "/placeholder.svg",
    publishedAt: new Date().toISOString(),
    category: "technology",
    url: "https://example.com/2",
    tags: ["test"],
    originalLanguage: "en",
    translated: false,
  },
];

describe("usePaginatedNews", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch initial page of articles", async () => {
    (fetchCachedNewsPaginated as jest.Mock).mockResolvedValue({
      articles: mockArticles,
      total: 100,
      limit: 50,
      next_cursor: "50",
      prev_cursor: null,
      has_more: true,
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

  it("should handle empty results", async () => {
    (fetchCachedNewsPaginated as jest.Mock).mockResolvedValue({
      articles: [],
      total: 0,
      limit: 50,
      next_cursor: null,
      prev_cursor: null,
      has_more: false,
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

  it("should apply category filter", async () => {
    (fetchCachedNewsPaginated as jest.Mock).mockResolvedValue({
      articles: mockArticles.filter((a) => a.category === "technology"),
      total: 2,
      limit: 50,
      next_cursor: null,
      prev_cursor: null,
      has_more: false,
    });

    const { result } = renderHook(
      () =>
        usePaginatedNews({
          limit: 50,
          category: "technology",
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

  it("should not fetch when disabled", async () => {
    const { result } = renderHook(
      () =>
        usePaginatedNews({
          limit: 50,
          useCached: true,
          enabled: false,
        }),
      { wrapper: createWrapper() }
    );

    // Should not be loading when disabled
    expect(result.current.isLoading).toBe(false);
    expect(fetchCachedNewsPaginated).not.toHaveBeenCalled();
  });

  it("should handle API errors gracefully", async () => {
    (fetchCachedNewsPaginated as jest.Mock).mockRejectedValue(
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
});
