import type { ApiJsonValue, ApiRequestInit, NewsArticle } from "@/lib/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { useCallback, useEffect, useState } from "react";

import { ReadingQueueSidebar } from "@/components/reading-queue-sidebar";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsStream } from "@/hooks/use-news-stream";
import { useReadingHistory } from "@/hooks/use-reading-history";
import { useSourceFilter } from "@/hooks/use-source-filter";

interface FetchResponseFixture {
  readonly body?: {
    getReader: () => {
      read: () => Promise<{
        done: boolean;
        value?: Uint8Array;
      }>;
    };
  };
  readonly json: () => Promise<ApiJsonValue>;
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
}

type FetchBoundary = (
  input: string,
  init?: ApiRequestInit,
) => Promise<FetchResponseFixture>;

const LOOP_MESSAGES = [
    "Maximum update depth exceeded",
    "The result of getServerSnapshot should be cached",
  ],
  createStreamResponse = (): FetchResponseFixture => {
    let delivered = false;
    const data = [
        `data: ${JSON.stringify({ articles: [], status: "initial" })}\n`,
        `data: ${JSON.stringify({ status: "complete" })}\n`,
      ].join(""),
      value = new TextEncoder().encode(data);

    return {
      body: {
        getReader: () => ({
          read: () => {
            if (delivered) {
              return Promise.resolve({ done: true });
            }
            delivered = true;
            return Promise.resolve({ done: false, value });
          },
        }),
      },
      json: () => Promise.resolve({}),
      ok: true,
      status: 200,
      statusText: "OK",
    };
  },
  fetchMock = jest.fn<FetchBoundary>(),
  installFetchBoundary = (): void => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((input) => {
      const url = input;
      if (url.includes("/news/stream")) {
        return Promise.resolve(createStreamResponse());
      }
      if (url.includes("/api/similarity/article-topics/")) {
        return Promise.resolve({
          json: () => Promise.resolve({ topics: [] }),
          ok: true,
          status: 200,
          statusText: "OK",
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve([]),
        ok: true,
        status: 200,
        statusText: "OK",
      });
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
  },
  originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch"),
  restoreFetchBoundary = (): void => {
    if (originalFetchDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "fetch");
    } else {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    }
  };

const installLoopGuard = () => {
  const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...args: readonly unknown[]) => {
        const message = args
          .map((value) => {
            if (value instanceof Error) {
              return value.message;
            }
            return String(value);
          })
          .join(" ");

        if (LOOP_MESSAGES.some((needle) => message.includes(needle))) {
          throw new Error(message);
        }
    }),
    warnSpy = jest.spyOn(console, "warn").mockImplementation((...args: readonly unknown[]) => {
      const message = args.map(String).join(" ");
      if (LOOP_MESSAGES.some((needle) => message.includes(needle))) {
        throw new Error(message);
      }
    });

  return () => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  };
};

const sampleArticle: NewsArticle = {
  bias: "center",
  category: "general",
  content: "Content",
  country: "US",
  credibility: "high",
  id: 101,
  image: "https://example.com/imuage.jpg",
  originalLanguage: "en",
  publishedAt: "2026-03-06T00:00:00.000Z",
  source: "Reuters",
  sourceId: "reuters",
  summary: "Summary",
  tags: [],
  title: "Test Article",
  translated: false,
  url: "https://example.com/article",
};

const queueArticles: readonly NewsArticle[] = [
  {
    ...sampleArticle,
    _queueData: { fullText: "First article text", preloadedAt: 1 },
  },
  {
    ...sampleArticle,
    _queueData: { fullText: "Second article text", preloadedAt: 1 },
    id: 102,
    title: "Second Article",
    url: "https://example.com/second-article",
  },
];

const ReadTrackingHarness = ({
  article,
  isOpen,
}: Readonly<{
  article: NewsArticle | null;
  isOpen: boolean;
}>) => {
  const { history, markAsRead } = useReadingHistory(),
    articleId = article?.id ?? null,
    articleSource = article?.source ?? "",
    articleTitle = article?.title ?? "";

  useEffect(() => {
    if (isOpen && articleId !== null && articleTitle !== "" && articleSource !== "") {
      markAsRead(articleId, articleTitle, articleSource);
    }
  }, [articleId, articleSource, articleTitle, isOpen, markAsRead]);

  return <div>{history.length}</div>;
};

const StreamStartupHarness = () => {
  const [runs, setRuns] = useState(0);
  const onComplete = useCallback(() => {}, []);
  const onError = useCallback(() => {}, []);
  const onUpdate = useCallback(() => {}, []);
  const { abortStream, startStream } = useNewsStream({
      onComplete,
      onError,
      onUpdate,
    });

  useEffect(() => {
    void (async () => {
      abortStream(true);
      setRuns((previous) => previous + 1);
      await startStream({ category: "all" });
    })();
  }, [abortStream, startStream]);

  return <div>{runs}</div>;
};

const renderQueue = (): void => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ReadingQueueSidebar />
    </QueryClientProvider>,
  );
};

const openQueueArticle = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: "Open reading queue" }));
  fireEvent.click(screen.getByRole("button", { name: /Test Article/u }));
  fireEvent.click(screen.getByRole("button", { name: "Read Article" }));
};

const navigateQueueAndClose = async (): Promise<void> => {
  fireEvent.keyDown(window, { key: "ArrowRight" });
  await expect(screen.findByRole("heading", { level: 1, name: "Second Article" })).resolves.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "m" });
  expect(screen.getByRole("button", { name: "Read" })).toHaveClass("text-green-400");
  fireEvent.keyDown(window, { key: "Escape" });
  await expect(screen.findByText("Articles to Read")).resolves.toBeInTheDocument();
};

const readStoredHistory = (): string => {
  const stored = globalThis.localStorage.getItem("thesis_reading_history") ?? "";
  if (stored === "") {
    throw new Error("Reading history was not persisted");
  }
  return stored;
};

const setupTestEnvironment = (): void => {
  globalThis.localStorage.clear();
  installFetchBoundary();
};

const cleanupTestEnvironment = (): void => {
  restoreFetchBoundary();
  jest.restoreAllMocks();
};

describe("storage-backed render loop regressions", () => {
  beforeEach(setupTestEnvironment);
  afterEach(cleanupTestEnvironment);

  it("lets storage-backed hooks update without triggering React loop errors", () => {
    expect.hasAssertions();

    const restoreConsole = installLoopGuard(),
      { result } = renderHook(() => ({
        favorites: useFavorites(),
        readingHistory: useReadingHistory(),
        sourceFilter: useSourceFilter(),
      }));

    act(() => {
      result.current.favorites.addMultipleFavorites(["reuters"]);
      result.current.sourceFilter.setSelected(["ap"]);
      result.current.readingHistory.markAsRead(5, "Hook test", "AP");
      result.current.readingHistory.markAsRead(5, "Hook test", "AP");
    });

    expect(result.current.favorites.isFavorite("reuters")).toBe(true);
    expect(result.current.sourceFilter.isSelected("ap")).toBe(true);
    restoreConsole();
    expect(result.current.readingHistory.history).toHaveLength(1);
  });

  it("keeps the article read-tracking effect stable across rerenders", () => {
    expect.hasAssertions();

    const restoreConsole = installLoopGuard(),
      { rerender } = render(<ReadTrackingHarness article={sampleArticle} isOpen />);

    rerender(<ReadTrackingHarness article={sampleArticle} isOpen />);

    restoreConsole();
    expect(JSON.parse(readStoredHistory())).toHaveLength(1);
  });
});

describe("queue render loop regressions", () => {
  beforeEach(setupTestEnvironment);
  afterEach(cleanupTestEnvironment);

  it("renders the reading queue sidebar without React loop errors", async () => {
    expect.hasAssertions();

    const restoreConsole = installLoopGuard();
    expect(renderQueue).not.toThrow();
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    restoreConsole();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps sidebar selection, keyboard navigation, read, and close controls wired", async () => {
    expect.hasAssertions();

    globalThis.localStorage.setItem("readingQueue", JSON.stringify(queueArticles));
    renderQueue();
    await openQueueArticle();
    await expect(screen.findByRole("heading", { level: 1, name: "Test Article" })).resolves.toBeInTheDocument();
    await navigateQueueAndClose();
    expect(screen.queryByRole("heading", { level: 1, name: "Second Article" })).toBeNull();
  });

  it("keeps stream startup effects stable when hook options are recreated", async () => {
    expect.hasAssertions();

    const restoreConsole = installLoopGuard();

    render(<StreamStartupHarness />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/news/stream"),
        expect.objectContaining({ method: "GET" }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    restoreConsole();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
