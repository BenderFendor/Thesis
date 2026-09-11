import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Component } from "react";
import type { NewsArticle } from "@/lib/api";

import type { ReactNode } from "react";
import { articleContentQueryKey } from "@/lib/article-content";
import { useReadingQueueQueries } from "@/components/reading-queue-queries";

type JsonFixture =
  | boolean
  | null
  | number
  | string
  | readonly JsonFixture[]
  | { readonly [key: string]: JsonFixture | undefined };

type QueryClientWrapperProps = Readonly<{ children?: ReactNode }>;

interface FetchResponseFixture {
  readonly json: () => Promise<JsonFixture>;
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

interface FetchInit {
  readonly body?: BodyInit | null;
  readonly signal?: AbortSignal | null;
}

type FetchBoundary = (
  input: string,
  init?: Readonly<FetchInit>,
) => Promise<FetchResponseFixture>;

const createResponse = (body: JsonFixture, status = 200): FetchResponseFixture => ({
  json: () => Promise.resolve(body),
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify(body) ?? ""),
});

const createArticle = (category: string, url = `https://example.com/${category}`): NewsArticle => ({
  bias: "center",
  category,
  country: "US",
  credibility: "high",
  id: Math.abs(url.length),
  image: "/placeholder.svg",
  originalLanguage: "en",
  publishedAt: "2026-09-05T00:00:00.000Z",
  source: "Test News",
  sourceId: "test-news",
  summary: "Summary",
  tags: [],
  title: "Article",
  translated: false,
  url,
});

const createTestContext = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: 0, retry: false },
    },
  });
  class QueryClientWrapper extends Component<QueryClientWrapperProps> {
    public static displayName = "QueryClientWrapper";

    public render(): ReactNode {
      return <QueryClientProvider client={queryClient}>{this.props.children}</QueryClientProvider>;
    }
  }
  return { queryClient, wrapper: QueryClientWrapper };
};

const fetchMock = jest.fn<FetchBoundary>();
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");

const installFetchMock = (): void => {
  fetchMock.mockReset();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
};

const restoreFetch = (): void => {
  if (originalFetchDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, "fetch");
    return;
  }
  Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
};

const createAnalysisHandler = (article: NewsArticle): FetchBoundary => (input) => {
  if (input.includes("/api/article/analyze")) {
    return Promise.resolve(createResponse({ article_url: article.url, success: true }));
  }
  return Promise.resolve(createResponse([]));
};

const createExtractionSuccessHandler = (article: NewsArticle): FetchBoundary => (input) => {
  if (input.includes("/article/extract")) {
    return Promise.resolve(createResponse({ full_text: "Fallback article", text: "" }));
  }
  if (input.includes("/api/article/analyze")) {
    return Promise.resolve(createResponse({ article_url: article.url, success: true }));
  }
  return Promise.resolve(createResponse([]));
};

const createExtractionFailureHandler = (
  article: NewsArticle,
  captureSignal: (signal: AbortSignal | null | undefined) => void,
): FetchBoundary => (input, init) => {
  if (input.includes("/article/extract")) {
    captureSignal(init?.signal);
    return Promise.resolve(createResponse({}, 503));
  }
  if (input.includes("/api/article/analyze")) {
    return Promise.resolve(createResponse({ article_url: article.url, success: true }));
  }
  return Promise.resolve(createResponse([]));
};

const createSignalCapture = () => {
  let signal: AbortSignal | null = null;
  return {
    capture: (nextSignal: AbortSignal | null | undefined): void => {
      signal = nextSignal ?? null;
    },
    get: (): AbortSignal | null => signal,
  };
};

describe("useReadingQueueQueries digest grouping", () => {
  beforeEach(installFetchMock);
  afterEach(restoreFetch);

  it("groups reserved categories through the real digest request", async () => {  expect.hasAssertions();

    const articles = ["__proto__", "constructor", "toString"].map((category) =>
      createArticle(category),
    );
    fetchMock.mockResolvedValue(createResponse({ digest: "Digest" }));
    const { result } = renderHook(
      () => useReadingQueueQueries(undefined, false, articles),
      { wrapper: createTestContext().wrapper },
    );

    act(() => {
      result.current.generateDigest();
    });
    await waitFor(() => {
      expect(result.current.queueDigest).toBe("Digest");
    });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toStrictEqual(
      expect.stringContaining('"__proto__":['),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toStrictEqual(
      expect.stringContaining('"constructor":['),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toStrictEqual(
      expect.stringContaining('"toString":['),
    );
  });
});

describe("useReadingQueueQueries digest failures", () => {
  beforeEach(installFetchMock);
  afterEach(restoreFetch);

  it.each([
    ["HTTP failures", createResponse({}, 503), "Queue digest failed (503)"],
    ["invalid payloads", createResponse({ unexpected: true }), "Queue digest returned an invalid response"],
    [
      "invalid JSON",
      { ...createResponse(null), text: () => Promise.resolve("{not-json") },
      "Queue digest returned an invalid response",
    ],
  ])("exposes digest errors for %s", async (_description, response, expectedMessage) => {
    fetchMock.mockResolvedValue(response);
    const { result } = renderHook(
      () => useReadingQueueQueries(undefined, false, []),
      { wrapper: createTestContext().wrapper },
    );

    act(() => {
      result.current.generateDigest();
    });
    await waitFor(() => {
      expect(result.current.digestError).toBe(expectedMessage);
    });
    expect(result.current.queueDigest).toBeUndefined();
  });
});

describe("useReadingQueueQueries analysis", () => {
  beforeEach(installFetchMock);
  afterEach(restoreFetch);

  it("does not report an analysis failure before the query has failed", () => {  expect.hasAssertions();

    const article = { ...createArticle("general"), _queueData: { fullText: "Preloaded text" } };
    fetchMock.mockImplementation(createAnalysisHandler(article));
    const { result, unmount } = renderHook(
      () => useReadingQueueQueries(article, false, [article]),
      { wrapper: createTestContext().wrapper },
    );

    unmount();
    expect(result.current.aiAnalysis).toBeUndefined();
  });

  it("keeps preloaded text and skips the extraction request", () => {  expect.hasAssertions();

    const article = { ...createArticle("general"), _queueData: { fullText: "Preloaded text" } };
    fetchMock.mockImplementation(createAnalysisHandler(article));
    const { result } = renderHook(
      () => useReadingQueueQueries(article, false, [article]),
      { wrapper: createTestContext().wrapper },
    );

    expect(result.current.fullArticleText).toBe("Preloaded text");
    expect(fetchMock.mock.calls.filter(([input]) => input.includes("/article/extract"))).toHaveLength(0);
  });
});

describe("useReadingQueueQueries article content", () => {
  beforeEach(installFetchMock);
  afterEach(restoreFetch);

  it("surfaces extraction failures and forwards the query signal", async () => {  expect.hasAssertions();

    const article = createArticle("general", "https://example.com/extraction-failure");
    const signalCapture = createSignalCapture();
    fetchMock.mockImplementation(createExtractionFailureHandler(article, signalCapture.capture));
    const { queryClient, wrapper } = createTestContext();
    const { result } = renderHook(
      () => useReadingQueueQueries(article, false, [article]),
      { wrapper },
    );

    await waitFor(() => {
      expect(queryClient.getQueryState(articleContentQueryKey(article.url))?.status).toBe("error");
    });
    expect(queryClient.getQueryState(articleContentQueryKey(article.url))?.error).toMatchObject({
      message: "Article extraction failed (503)",
    });
    expect(signalCapture.get()).not.toBeNull();
    expect(result.current.fullArticleText).toBeUndefined();
  });

  it("uses the shared content fallback when text is empty", async () => {  expect.hasAssertions();

    const article = createArticle("general", "https://example.com/extraction-success");
    fetchMock.mockImplementation(createExtractionSuccessHandler(article));
    const { result } = renderHook(
      () => useReadingQueueQueries(article, false, [article]),
      { wrapper: createTestContext().wrapper },
    );

    await waitFor(() => {
      expect(result.current.fullArticleText).toBeDefined();
    });
    expect(result.current.fullArticleText).toBe("Fallback article");
  });
});
