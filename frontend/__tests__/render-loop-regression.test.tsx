import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook, waitFor } from "@testing-library/react";

import { ReadingQueueSidebar } from "@/components/reading-queue-sidebar";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsStream } from "@/hooks/useNewsStream";
import { useReadingHistory } from "@/hooks/useReadingHistory";
import { useSourceFilter } from "@/hooks/use-source-filter";
import type { NewsArticle } from "@/lib/api";

interface FetchResponseFixture {
  readonly body?: {
    getReader: () => {
      read: () => Promise<{
        done: boolean;
        value?: Uint8Array;
      }>;
    };
  };
  readonly json: () => Promise<unknown>;
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
}

type FetchBoundary = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<FetchResponseFixture>;

const fetchMock = jest.fn<FetchBoundary>(),
  originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch"),

 createStreamResponse = (): FetchResponseFixture => {
  let delivered = false;
  const data = [
    `data: ${JSON.stringify({ articles: [], status: "initial" })}\n`,
    `data: ${JSON.stringify({ status: "complete" })}\n`,
  ].join(""),
   value = new Uint8Array([...data].map((character) => character.charCodeAt(0)));

  return {
    body: {
      getReader: () => ({
        read: async () => {
          if (delivered) {
            return { done: true };
          }
          delivered = true;
          return { done: false, value };
        },
      }),
    },
    json: async () => ({}),
    ok: true,
    status: 200,
    statusText: "OK",
  };
},

 installFetchBoundary = (): void => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/news/stream")) {
      return createStreamResponse();
    }
    return {
      json: async () => [],
      ok: true,
      status: 200,
      statusText: "OK",
    };
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
},

 restoreFetchBoundary = (): void => {
  if (originalFetchDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, "fetch");
  } else {
    Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
  }
},

 LOOP_MESSAGES = [
  "Maximum update depth exceeded",
  "The result of getServerSnapshot should be cached",
];

function installLoopGuard() {
  const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...args: readonly unknown[]) => {
        const message = args
          .map((value) => (value instanceof Error ? value.message : String(value)))
          .join(" ");

        if (LOOP_MESSAGES.some((needle) => message.includes(needle))) {
          throw new Error(message);
        }
      }),
    warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation((...args: readonly unknown[]) => {
        const message = args.map((value) => String(value)).join(" ");
        if (LOOP_MESSAGES.some((needle) => message.includes(needle))) {
          throw new Error(message);
        }
      });

  return () => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  };
}

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

function ReadTrackingHarness({
  article,
  isOpen,
}: Readonly<{
  article: NewsArticle | null;
  isOpen: boolean;
}>) {
  const { history, markAsRead } = useReadingHistory(),
    articleId = article?.id ?? null,
    articleTitle = article?.title ?? null,
    articleSource = article?.source ?? null;

  useEffect(() => {
    if (isOpen && articleId !== null && articleTitle && articleSource) {
      markAsRead(articleId, articleTitle, articleSource);
    }
  }, [articleId, articleSource, articleTitle, isOpen, markAsRead]);

  return <div>{history.length}</div>;
}

function StreamStartupHarness() {
  const [runs, setRuns] = useState(0),
    onUpdate = useCallback(() => {}, []),
    onComplete = useCallback(() => {}, []),
    onError = useCallback(() => {}, []),
    { abortStream, startStream } = useNewsStream({
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
}

describe("render loop regressions", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    installFetchBoundary();
  });

  afterEach(() => {
    restoreFetchBoundary();
    jest.restoreAllMocks();
  });

  it("lets storage-backed hooks update without triggering React loop errors", () => {  expect.hasAssertions();

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
    expect(result.current.readingHistory.history).toHaveLength(1);
    restoreConsole();
  });

  it("keeps the article read-tracking effect stable across rerenders", () => {  expect.hasAssertions();

    const restoreConsole = installLoopGuard(),
      { rerender } = render(<ReadTrackingHarness article={sampleArticle} isOpen />);

    rerender(<ReadTrackingHarness article={sampleArticle} isOpen />);

    const stored = globalThis.localStorage.getItem("thesis_reading_history");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toHaveLength(1);
    restoreConsole();
  });

  it("renders the reading queue sidebar without React loop errors", async () => {  expect.hasAssertions();

    const restoreConsole = installLoopGuard();

    expect(() => render(<ReadingQueueSidebar />)).not.toThrow();
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    restoreConsole();
  });

  it("keeps stream startup effects stable when hook options are recreated", async () => {  expect.hasAssertions();

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
  });
});
