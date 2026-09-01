import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { ArticleDetailModal } from "@/components/article-detail-modal";
import type { ArticleDetailServices } from "@/components/article-detail-modal";
import type { NewsArticle } from "@/lib/api";
import { renderWithQueryClient } from "@/test-utils/render-with-query-client";
import userEvent from "@testing-library/user-event";

const baseArticle: NewsArticle = {
  bias: "center",
  category: "Politics",
  content: "Content",
  country: "US",
  credibility: "high",
  id: 1,
  image: "none",
  originalLanguage: "en",
  publishedAt: "2026-03-13T12:00:00Z",
  source: "Example News",
  sourceId: "example-news",
  summary: "Summary",
  tags: [],
  title: "Test article",
  translated: false,
  url: "article-1",
},

 mockedApi = {
  analyzeArticle: jest.fn<ArticleDetailServices["analyzeArticle"]>(async () => ({ article_url: "", success: false })),
  createHighlight: jest.fn<ArticleDetailServices["createHighlight"]>(async (highlight) => highlight),
  deleteHighlight: jest.fn<ArticleDetailServices["deleteHighlight"]>(async () => {}),
  fetchLanguageDiagnostics: jest.fn<ArticleDetailServices["fetchLanguageDiagnostics"]>(async () => ({
    article_url: "",
    sentence_count: 0,
    success: true,
    word_count: 0,
  })),
  fetchSourceDebugData: jest.fn<ArticleDetailServices["fetchSourceDebugData"]>(() => {
    throw new Error("Source debugging is not expected in this test");
  }),
  getHighlightsForArticle: jest.fn<ArticleDetailServices["getHighlightsForArticle"]>(async () => []),
  getSourceById: jest.fn<ArticleDetailServices["getSourceById"]>(() => Promise.resolve(undefined)),
  performAgenticSearch: jest.fn<ArticleDetailServices["performAgenticSearch"]>(async () => ({ answer: "", success: false })),
  updateHighlight: jest.fn<ArticleDetailServices["updateHighlight"]>(async () => {
    throw new Error("Highlight updates are not expected in this test");
  }),
} satisfies ArticleDetailServices;

function getArticleDetailScrollRegion(): HTMLDivElement {
  const scrollRegion = document.querySelector<HTMLDivElement>("#article-detail-scroll-region");
  if (!scrollRegion) {
    throw new Error("Article detail scroll region was not rendered");
  }
  return scrollRegion;
}

function renderArticleWithScrollControls() {
  const onNavigate = jest.fn(),
   scrollBy = jest.fn();

  renderWithQueryClient(
    <ArticleDetailModal
      article={{ ...baseArticle, id: 4, url: "article-4" }}
      isOpen
      onClose={jest.fn()}
      services={mockedApi}
      onNavigate={onNavigate}
    />
  );

  {
    const scrollRegion = getArticleDetailScrollRegion();
    Object.defineProperty(scrollRegion, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scrollRegion, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
  }
  return { onNavigate, scrollBy };
}

function configureProgressRail(scrollTo: (options: { behavior: "auto"; top: number }) => void) {
  const pointerDownEvent = new Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    }),
    progressRail = screen.getByRole("scrollbar", { name: "Article reading progress" }),
    scrollRegion = getArticleDetailScrollRegion();

  Object.defineProperty(scrollRegion, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(scrollRegion, "scrollHeight", {
    configurable: true,
    get: () => 1400,
  });
  Object.defineProperty(scrollRegion, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(progressRail, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 300,
      height: 200,
      left: 0,
      right: 12,
      toJSON: () => ({}),
      top: 100,
      width: 12,
      x: 0,
      y: 100,
    }),
  });

  return { pointerDownEvent, progressRail };
}

function prepareAnalysisTest() {
  mockedApi.analyzeArticle.mockResolvedValueOnce({
    article_url: "article-6",
    bias_analysis: {
      framing_bias: "Centers the policy conflict",
      overall_bias_score: "6",
      selection_bias: "Focuses on the policy dispute",
      source_diversity: "Uses several relevant sources",
      tone_bias: "Measured but skeptical",
    },
    fact_check_results: [
      {
        claim: "A disputed claim from the article",
        confidence: "low",
        evidence: "No confirming public record was provided.",
        sources: [],
        verification_status: "unverified",
      },
    ],
    source_analysis: {
      credibility_assessment: "medium",
      funding_model: "subscriber supported",
      ownership: "independent",
      political_leaning: "left",
      reputation: "established outlet",
    },
    success: true,
    summary: "A concise summary for the selected article.",
  });
  return userEvent.setup();
}

describe("articleDetailModal", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedApi.getSourceById.mockClear();
    mockedApi.analyzeArticle.mockClear();
    mockedApi.getHighlightsForArticle.mockClear();
    mockedApi.performAgenticSearch.mockClear();
  });

  it("renders the reporter label from article.author", async () => {expect.hasAssertions();
    renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Zhiqun Zhu", authors: ["Zhiqun Zhu"] }}
        isOpen
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    await expect(screen.findByText("Reporter: Zhiqun Zhu")).resolves.toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem("thesis_reading_history")).toContain('"articleId":1');
      expect(mockedApi.getSourceById).toHaveBeenCalledWith("example-news");
      expect(mockedApi.getHighlightsForArticle).toHaveBeenCalledWith("article-1");
    });
  });

  it("falls back to the first non-empty entry in article.authors", async () => {expect.hasAssertions();
    renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "", authors: ["", "Taylor Smith", "Another Name"], id: 2, url: "article-2" }}
        isOpen
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    await expect(screen.findByText("Reporter: Taylor Smith")).resolves.toBeInTheDocument();
  });

  it("resets the wiki sheet after the modal closes or switches articles", async () => {expect.hasAssertions();
    const { rerender } = renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Zhiqun Zhu", authors: ["Zhiqun Zhu"] }}
        isOpen
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    fireEvent.click(await screen.findByText("Reporter: Zhiqun Zhu"));
    await expect(screen.findByRole("heading", { name: "Zhiqun Zhu" })).resolves.toBeInTheDocument();

    rerender(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Zhiqun Zhu", authors: ["Zhiqun Zhu"] }}
        isOpen={false}
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    rerender(
      <ArticleDetailModal
        article={{ ...baseArticle, author: "Taylor Smith", authors: ["Taylor Smith"], id: 3, url: "article-3" }}
        isOpen
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Zhiqun Zhu" })).not.toBeInTheDocument();
    });
  });

  it("uses vertical keys to scroll the popup instead of changing the article", async () => {expect.hasAssertions();
    const { onNavigate, scrollBy } = renderArticleWithScrollControls();

    await waitFor(() => {
      expect(mockedApi.getHighlightsForArticle).toHaveBeenCalledWith("article-4");
    });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "PageDown" });

    expect(scrollBy).toHaveBeenNthCalledWith(1, { behavior: "smooth", top: 72 });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { behavior: "smooth", top: 540 });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("lets the progress rail control the popup scroll position", async () => {expect.hasAssertions();
    renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, id: 5, url: "article-5" }}
        isOpen
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    const scrollTo = jest.fn(),
      { pointerDownEvent, progressRail } = configureProgressRail(scrollTo);

    await waitFor(() => {
      expect(mockedApi.getHighlightsForArticle).toHaveBeenCalledWith("article-5");
    });

    Object.defineProperty(pointerDownEvent, "clientY", {
      configurable: true,
      value: 250,
    });

    progressRail.dispatchEvent(pointerDownEvent);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 750 });
  });

  it("renders AI analysis results after the analysis action runs", async () => {expect.hasAssertions();
    const user = prepareAnalysisTest();

    renderWithQueryClient(
      <ArticleDetailModal
        article={{ ...baseArticle, id: 6, url: "article-6" }}
        isOpen
        onClose={jest.fn()}
        services={mockedApi}
      />
    );

    await user.click(screen.getByRole("button", { name: /run ai analysis/iu }));

    await expect(screen.findByText("AI Summary")).resolves.toBeInTheDocument();
    expect([
      screen.getByText("A concise summary for the selected article."),
      screen.getByText("1 claim ready for verification review"),
    ]).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /expand for full ai analysis/iu }));

    await expect(screen.findByText("Fact Check Results")).resolves.toBeInTheDocument();
    expect(screen.getByText("1 claims")).toBeInTheDocument();
    expect(mockedApi.analyzeArticle).toHaveBeenCalledWith("article-6", "Example News");
  });
});
