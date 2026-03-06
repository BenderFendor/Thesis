import { type ReactNode, useEffect } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { useFavorites } from "@/hooks/useFavorites";
import { useReadingHistory } from "@/hooks/useReadingHistory";
import { useSourceFilter } from "@/hooks/useSourceFilter";
import { type NewsArticle } from "@/lib/api";
import { ReadingQueueSidebar } from "@/components/reading-queue-sidebar";

jest.mock("@/hooks/useReadingQueue", () => ({
  useReadingQueue: () => ({
    queuedArticles: [],
    removeArticleFromQueue: jest.fn(),
    isLoaded: true,
  }),
}));

jest.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isBookmarked: () => false,
    toggleBookmark: jest.fn(),
    isLoaded: true,
  }),
}));

jest.mock("@/hooks/useLikedArticles", () => ({
  useLikedArticles: () => ({
    isLiked: () => false,
    toggleLike: jest.fn(),
    isLoaded: true,
    error: null,
  }),
}));

jest.mock("@/lib/api", () => ({
  API_BASE_URL: "http://localhost:8000",
  analyzeArticle: jest.fn(),
  getSourceById: jest.fn(),
  fetchSourceDebugData: jest.fn(),
}));

jest.mock("@/components/article-detail-modal", () => ({
  ArticleDetailModal: () => null,
}));

jest.mock("@/components/article-inline-embed", () => ({
  ArticleInlineEmbed: () => null,
}));

jest.mock("@/components/novelty-badge", () => ({
  NoveltyBadge: () => null,
}));

jest.mock("@/components/semantic-tags", () => ({
  SemanticTags: () => null,
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const LOOP_MESSAGES = [
  "Maximum update depth exceeded",
  "The result of getServerSnapshot should be cached",
];

function installLoopGuard() {
  const errorSpy = jest
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      const message = args
        .map((value) =>
          value instanceof Error ? value.message : String(value)
        )
        .join(" ");

      if (LOOP_MESSAGES.some((needle) => message.includes(needle))) {
        throw new Error(message);
      }
    });

  const warnSpy = jest
    .spyOn(console, "warn")
    .mockImplementation((...args: unknown[]) => {
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
  id: 101,
  title: "Test Article",
  source: "Reuters",
  sourceId: "reuters",
  country: "US",
  credibility: "high",
  bias: "center",
  summary: "Summary",
  content: "Content",
  image: "https://example.com/image.jpg",
  publishedAt: "2026-03-06T00:00:00.000Z",
  category: "general",
  url: "https://example.com/article",
  tags: [],
  originalLanguage: "en",
  translated: false,
};

function ReadTrackingHarness({
  article,
  isOpen,
}: {
  article: NewsArticle | null;
  isOpen: boolean;
}) {
  const { history, markAsRead } = useReadingHistory();

  useEffect(() => {
    if (isOpen && article) {
      markAsRead(article.id, article.title, article.source);
    }
  }, [article?.id, article?.source, article?.title, isOpen, markAsRead]);

  return <div>{history.length}</div>;
}

describe("render loop regressions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lets storage-backed hooks update without triggering React loop errors", () => {
    const restoreConsole = installLoopGuard();
    const { result } = renderHook(() => ({
      favorites: useFavorites(),
      sourceFilter: useSourceFilter(),
      readingHistory: useReadingHistory(),
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

  it("keeps the article read-tracking effect stable across rerenders", () => {
    const restoreConsole = installLoopGuard();
    const { rerender } = render(
      <ReadTrackingHarness article={sampleArticle} isOpen />
    );

    rerender(<ReadTrackingHarness article={sampleArticle} isOpen />);

    const stored = window.localStorage.getItem("thesis_reading_history");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toHaveLength(1);

    restoreConsole();
  });

  it("renders the reading queue sidebar without React loop errors", () => {
    const restoreConsole = installLoopGuard();

    render(<ReadingQueueSidebar />);

    restoreConsole();
  });
});
