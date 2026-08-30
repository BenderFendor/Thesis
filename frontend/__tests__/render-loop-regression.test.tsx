import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useFavorites } from "@/hooks/useFavorites";
import { useNewsStream } from "@/hooks/useNewsStream";
import { useReadingHistory } from "@/hooks/useReadingHistory";
import { useSourceFilter } from "@/hooks/use-source-filter";
import type { NewsArticle } from '@/lib/api';
import { ReadingQueueSidebar } from "@/components/reading-queue-sidebar";

const mockStreamNews = jest.fn();

jest.mock<typeof import('@/hooks/useReadingQueue')>("@/hooks/useReadingQueue", () => ({
  useReadingQueue: () => ({
    isLoaded: true,
    queuedArticles: [],
    removeArticleFromQueue: jest.fn(),
  }),
}));

jest.mock<typeof import('@/hooks/useBookmarks')>("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isBookmarked: () => false,
    isLoaded: true,
    toggleBookmark: jest.fn(),
  }),
}));

jest.mock<typeof import('@/hooks/use-liked-articles')>("@/hooks/use-liked-articles", () => ({
  useLikedArticles: () => ({
    error: null,
    isLiked: () => false,
    isLoaded: true,
    toggleLike: jest.fn(),
  }),
}));

jest.mock<typeof import('@/lib/api')>("@/lib/api", () => ({
  API_BASE_URL: "http://localhost:8000",
  analyzeArticle: jest.fn(),
  fetchSourceDebugData: jest.fn(),
  getSourceById: jest.fn(),
  streamNews: (...args:readonly  unknown[]) => mockStreamNews(...args),
}));

jest.mock<typeof import('@/components/article-detail-modal')>("@/components/article-detail-modal", () => ({
  ArticleDetailModal: () => null,
}));

jest.mock<typeof import('@/components/article-inline-embed')>("@/components/article-inline-embed", () => ({
  ArticleInlineEmbed: () => null,
}));

jest.mock<typeof import('@/components/novelty-badge')>("@/components/novelty-badge", () => ({
  NoveltyBadge: () => null,
}));

jest.mock<typeof import('@/components/semantic-tags')>("@/components/semantic-tags", () => ({
  SemanticTags: () => null,
}));

jest.mock<typeof import('@/lib/performance-logger')>("@/lib/performance-logger", () => ({
  endStream: jest.fn(),
  logStreamEvent: jest.fn(),
  perfLogger: {
    logEvent: jest.fn(),
  },
  startStream: jest.fn(),
}));

jest.mock<typeof import('react-markdown')>("react-markdown", () => ({
  __esModule: true,
  default: ({ children }:Readonly< { children?: ReactNode }>) => <>{children}</>,
}));

const LOOP_MESSAGES = [
  "Maximum update depth exceeded",
  "The result of getServerSnapshot should be cached",
];

function installLoopGuard() {
  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation((...args:readonly  unknown[]) => {
      const message = args
        .map((value) =>
          value instanceof Error ? value.message : String(value)
        )
        .join(" ");

      if (LOOP_MESSAGES.some((needle) => message.includes(needle))) {
        throw new Error(message);
      }
    }),

   warnSpy = jest
    .spyOn(console, "warn")
    .mockImplementation((...args:readonly  unknown[]) => {
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
}:Readonly< {
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
      setRuns((prev) => prev + 1);
      await startStream({ category: "all" });
    })();
  }, [abortStream, startStream]);

  return <div>{runs}</div>;
}

describe("render loop regressions", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    mockStreamNews.mockReset();
    mockStreamNews.mockReturnValue({
      promise: Promise.resolve({
        articles: [],
        errors: [],
        sources: [],
        streamId: "stream-1",
      }),
      url: "http://localhost:8000/api/stream",
    });

    global.WebSocket = jest.fn(() => ({
      close: jest.fn(),
      onmessage: null,
    })) as unknown as typeof WebSocket;
  });

  afterEach(() => {
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
     { rerender } = render(
      <ReadTrackingHarness article={sampleArticle} isOpen />
    );

    rerender(<ReadTrackingHarness article={sampleArticle} isOpen />);

    const stored = globalThis.localStorage.getItem("thesis_reading_history");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toHaveLength(1);

    restoreConsole();
  });

  it("renders the reading queue sidebar without React loop errors", () => {  expect.hasAssertions();
  
    const restoreConsole = installLoopGuard();

    render(<ReadingQueueSidebar />);

    restoreConsole();
  });

  it("keeps stream startup effects stable when hook options are recreated", async () => {  expect.hasAssertions();
  
    const restoreConsole = installLoopGuard();

    render(<StreamStartupHarness />);

    await waitFor(() => {
      expect(mockStreamNews).toHaveBeenCalledTimes(1);
    });

    restoreConsole();
  });
});
