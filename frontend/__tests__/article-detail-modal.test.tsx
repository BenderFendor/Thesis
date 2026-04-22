import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { ArticleDetailModal } from "@/components/article-detail-modal";
import type { NewsArticle } from "@/lib/api";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";

jest.mock("next/link", () => {
  return function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const stripMotionProps = <T extends object>(props: T) => {
  const next = { ...(props as T & Record<string, unknown>) };
  delete next.layout;
  delete next.layoutId;
  delete next.transition;
  delete next.initial;
  delete next.animate;
  delete next.exit;
  return next;
};

jest.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...stripMotionProps(props)}>{children}</div>,
    h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 {...stripMotionProps(props)}>{children}</h1>,
    img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", { alt: props.alt ?? "", ...stripMotionProps(props) }),
  },
}));

jest.mock("lucide-react", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg aria-hidden="true" {...props} />;
  return new Proxy(
    {},
    {
      get: () => Icon,
    }
  );
});

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
    if (asChild) {
      return <>{children}</>;
    }
    return <button {...props}>{children}</button>;
  },
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const SheetOpenContext = React.createContext(false);

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    <SheetOpenContext.Provider value={open}>{children}</SheetOpenContext.Provider>
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => {
    const open = React.useContext(SheetOpenContext);
    return open ? <>{children}</> : null;
  },
  SheetDescription: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/inline-definition", () => () => null);
jest.mock("@/components/reporter-profile", () => ({
  ReporterProfilePanel: () => <div>Reporter profile</div>,
}));
jest.mock("@/components/source-research-panel", () => ({
  SourceResearchPanel: () => <div>Source research</div>,
}));
jest.mock("@/components/related-articles", () => ({
  RelatedArticles: () => null,
}));
jest.mock("@/components/article-content", () => ({
  ArticleContent: () => <div>Article content</div>,
}));
jest.mock("@/components/highlight-toolbar", () => ({
  HighlightToolbar: () => null,
}));
jest.mock("@/components/highlight-note-popover", () => ({
  HighlightNotePopover: () => null,
}));

jest.mock("@/hooks/useLikedArticles", () => ({
  useLikedArticles: () => ({
    isLiked: jest.fn(() => false),
    toggleLike: jest.fn(),
  }),
}));

jest.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isBookmarked: jest.fn(() => false),
    toggleBookmark: jest.fn(async () => undefined),
  }),
}));

jest.mock("@/hooks/useReadingQueue", () => ({
  useReadingQueue: () => ({
    addArticleToQueue: jest.fn(),
    removeArticleFromQueue: jest.fn(),
    isArticleInQueue: jest.fn(() => false),
    queuedArticles: [],
  }),
}));

jest.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: jest.fn(() => false),
    toggleFavorite: jest.fn(),
  }),
}));

const markAsRead = jest.fn();

jest.mock("@/hooks/useReadingHistory", () => ({
  useReadingHistory: () => ({
    markAsRead,
  }),
}));

jest.mock("@/hooks/useInlineDefinition", () => ({
  useInlineDefinition: () => ({
    result: null,
    open: false,
    setOpen: jest.fn(),
    anchorPosition: null,
  }),
}));

jest.mock("@/lib/performance-logger", () => ({
  logUserAction: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  isDebugMode: jest.fn(() => false),
}));

jest.mock("@/lib/highlight-store", () => ({
  loadHighlightStore: jest.fn(() => ({ version: 1, article_url: "", highlights: [] })),
  mergeHighlights: jest.fn(({ local }: { local: unknown[] }) => local),
  saveHighlightStore: jest.fn(),
  toRemoteHighlights: jest.fn(() => []),
  generateClientId: jest.fn(() => "client-1"),
  markFailed: jest.fn(({ highlight }: { highlight: unknown }) => highlight),
  markPending: jest.fn(({ highlight }: { highlight: unknown }) => highlight),
  markSynced: jest.fn(({ highlight }: { highlight: unknown }) => highlight),
  createHighlightFingerprint: jest.fn(() => "fingerprint"),
  dedupeLocalHighlights: jest.fn((highlights: unknown[]) => highlights),
}));

jest.mock("@/lib/highlight-utils", () => ({
  buildObsidianMarkdown: jest.fn(() => ""),
  highlightStableId: jest.fn((highlight) =>
    highlight.id ? `server:${highlight.id}` : `client:${highlight.client_id}`
  ),
}));

jest.mock("@/lib/api", () => ({
  API_BASE_URL: "http://localhost:8000",
  getSourceById: jest.fn(async () => null),
  fetchSourceDebugData: jest.fn(async () => null),
  analyzeArticle: jest.fn(async () => null),
  performAgenticSearch: jest.fn(async () => ({ success: false })),
  getHighlightsForArticle: jest.fn(async () => []),
  createHighlight: jest.fn(async (highlight) => highlight),
  updateHighlight: jest.fn(async (id: number, highlight) => ({ id, ...highlight })),
  deleteHighlight: jest.fn(async () => undefined),
}));

const mockedApi = jest.requireMock("@/lib/api") as {
  getSourceById: jest.Mock;
  getHighlightsForArticle: jest.Mock;
};

const baseArticle: NewsArticle = {
  id: 1,
  title: "Test article",
  source: "Example News",
  sourceId: "example-news",
  country: "US",
  credibility: "high",
  bias: "center",
  summary: "Summary",
  content: "Content",
  image: "none",
  publishedAt: "2026-03-13T12:00:00Z",
  category: "Politics",
  url: "article-1",
  tags: [],
  originalLanguage: "en",
  translated: false,
};

describe("ArticleDetailModal", () => {
  beforeEach(() => {
    markAsRead.mockClear();
    mockedApi.getSourceById.mockClear();
    mockedApi.getHighlightsForArticle.mockClear();
  });

  it("renders the reporter label from article.author", async () => {
    renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Zhiqun Zhu", authors: ["Zhiqun Zhu"] }}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByText("Reporter: Zhiqun Zhu")).toBeInTheDocument();
    await waitFor(() => {
      expect(markAsRead).toHaveBeenCalledWith(1, "Test article", "Example News");
      expect(mockedApi.getSourceById).toHaveBeenCalledWith("example-news");
      expect(mockedApi.getHighlightsForArticle).toHaveBeenCalledWith("article-1");
    });
  });

  it("falls back to the first non-empty entry in article.authors", async () => {
    renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, id: 2, url: "article-2", author: "", authors: ["", "Taylor Smith", "Another Name"] }}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByText("Reporter: Taylor Smith")).toBeInTheDocument();
  });

  it("resets the wiki sheet after the modal closes or switches articles", async () => {
    const { rerender } = renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Zhiqun Zhu", authors: ["Zhiqun Zhu"] }}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(await screen.findByText("Reporter: Zhiqun Zhu"));
    expect(await screen.findByText("Reporter profile")).toBeInTheDocument();

    rerender(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Zhiqun Zhu", authors: ["Zhiqun Zhu"] }}
        isOpen={false}
        onClose={jest.fn()}
      />
    );

    rerender(
      <ArticleDetailModal
        article={{ ...baseArticle, id: 3, url: "article-3", author: "Taylor Smith", authors: ["Taylor Smith"] }}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Reporter profile")).not.toBeInTheDocument();
    });
  });
});
