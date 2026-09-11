"use client";
import { hasText } from "@/lib/utils";

import type {
  ArticleAnalysis,
  ArticleBookmarkActionProps,
  ArticleDetailModalProps,
  ArticleDetailModalViewProps,
  ArticleDetailServices,
  CreateHighlightPayload,
  DebugLoaderState,
  DeleteHighlightPayload,
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
  Highlight,
  HighlightAnchorElement,
  HighlightRange,
  LanguageDiagnostics,
  LocalHighlight,
  ModalHighlightActionsProps,
  ModalHighlightEditorActionsProps,
  ModalHighlightHistoryProps,
  NewsArticle,
  NewsSource,
  SourceDebugData,
  UpdateHighlightPayload,
} from "../lib/article-detail-modal-data";
import {
  DEFAULT_ARTICLE_DETAIL_SERVICES,
  HIGHLIGHT_STORE_VERSION,
  buildObsidianMarkdown,
  createHighlightFingerprint,
  dedupeLocalHighlights,
  fetchFullArticleText,
  generateClientId,
  getArticleCacheKey,
  getInitialArticleText,
  highlightStableId,
  markPending,
  saveHighlightStore,
  toRemoteHighlights,
} from "../lib/article-detail-modal-data";
import {
  getArticleHost,
  getArticleTextForMetrics,
  getArticleWikiContext,
  getArticleWordMetrics,
  getRenderedLanguageDiagnostics,
  getReporterName,
  shouldShowSummary,
  syncHighlights,
} from "./article-detail-modal-reader";
import { useCallback, useRef, useState } from "react";
import { ArticleDetailModalView } from "./article-detail-modal-view";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { toast } from "sonner";
import { useModalIntegrations } from "../hooks/use-modal-integrations";
import { useQuery } from "@tanstack/react-query";

interface HighlightHistoryState {
  readonly nextHistory: LocalHighlight[][];
  readonly previousState: LocalHighlight[] | undefined;
}

const useArticleLanguageDiagnostics = ({
  article,
  articleTextForMetrics,
  isOpen,
  services,
  wordCount,
  aiAnalysis,
}: Readonly<{
  article: Readonly<{ source: string; title: string; url: string }>;
  articleTextForMetrics: string;
  isOpen: boolean;
  services: NonNullable<ArticleDetailModalProps["services"]>;
  wordCount: number;
  aiAnalysis: ArticleAnalysis | null | undefined;
}>) => {
  const {
    data: languageDiagnostics,
    isFetching: languageDiagnosticsLoading,
    error: languageDiagnosticsQueryError,
  } = useQuery<LanguageDiagnostics>({
    enabled: isOpen && wordCount >= MIN_LANGUAGE_DIAGNOSTIC_WORD_COUNT,
    queryFn: () =>
      services.fetchLanguageDiagnostics({
        sourceName: article.source,
        text: articleTextForMetrics,
        title: article.title,
        url: article.url,
      }),
    queryKey: [
      "article-language-diagnostics",
      article.url,
      articleTextForMetrics.slice(EMPTY_COUNT, ARTICLE_TEXT_PREVIEW_LENGTH),
    ],
    retry: 1,
    staleTime: MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * STALE_TIME_MINUTES,
  });

  return {
    languageDiagnostics: getRenderedLanguageDiagnostics(aiAnalysis, languageDiagnostics),
    languageDiagnosticsError: getLanguageDiagnosticsError(
      languageDiagnosticsQueryError,
      languageDiagnostics,
    ),
    languageDiagnosticsLoading,
  };
};

const AGENTIC_HISTORY_LIMIT = 5,
  AGENTIC_MAX_RESULTS = 10,
  ARTICLE_TEXT_PREVIEW_LENGTH = 120,
  ArticleDetailModal = (props: Readonly<ArticleDetailModalProps>) => {
    const { article, isOpen } = props;
    if (!isOpen || !article) {
      return false;
    }

    return (
      <ArticleDetailModalContent
        key={`${article.id}:${article.url}`}
        article={article}
        isOpen={props.isOpen}
        layoutIdPrefix={props.layoutIdPrefix}
        onBookmarkChange={props.onBookmarkChange}
        onClose={props.onClose}
        onNavigate={props.onNavigate}
        services={props.services}
      />
    );
  },
  ArticleDetailModalContent = ({
    article,
    isOpen,
    onClose,
    onBookmarkChange,
    onNavigate,
    layoutIdPrefix,
    services = DEFAULT_ARTICLE_DETAIL_SERVICES,
  }: Readonly<ArticleDetailModalProps & { article: NewsArticle }>) => {
    const {
        activeHighlightId,
        activeStatusFilter,
        addArticleToQueue,
        agenticAnswer,
        agenticError,
        agenticHistory,
        agenticLoading,
        aiAnalysis,
        aiAnalysisLoading,
        aiAnalysisRequested,
        articleContentRef,
        articleLoading,
        articleScrollProgress,
        bookmarkLoading,
        claimsOpen,
        contentScrollRef,
        debugData,
        debugLoading,
        debugMode,
        debugOpen,
        setDebugOpen,
        fullArticleText,
        handleCancelEdit,
        handleColorSelect,
        handleHighlightClick,
        handleHighlightDelete,
        handleNavigate,
        handleRetrySync,
        handleSaveHighlightNote,
        handleSaveNote,
        handleStartEdit,
        handleToolbarCreate,
        handleToolbarDelete,
        handleToolbarUpdate,
        handleUndo,
        handleToggleShowHighlights,
        highlightColor,
        highlightPopoverAnchorEl,
        highlightPopoverHighlight,
        highlightPopoverOpen,
        highlightSyncStatus,
        highlights,
        isArticleInQueue,
        isBookmarked,
        isExpanded,
        isFavorite,
        isLiked,
        inlineAnchorPosition,
        inlineOpen,
        inlineResult,
        markAsRead,
        matchedEntryIndex,
        progressTrackRef,
        removeArticleFromQueue,
        selectedClaim,
        setActiveStatusFilter,
        setAgenticAnswer,
        setAgenticError,
        setAgenticHistory,
        setAgenticLoading,
        setAiAnalysis,
        setAiAnalysisLoading,
        setAiAnalysisRequested,
        setArticleScrollProgress,
        setBookmarkLoading,
        setClaimsOpen,
        setDebugData,
        setDebugLoading,
        setHighlightPopoverOpen,
        setHighlightSyncStatus,
        setHighlights,
        setInlineOpen,
        setIsExpanded,
        setMatchedEntryIndex,
        setSelectedClaim,
        setShowSourceDetails,
        setSidebarEditingNote,
        setWikiPanelOpen,
        setWikiPanelTab,
        showHighlights,
        showSourceDetails,
        sidebarEditingId,
        sidebarEditingNote,
        source,
        sourceLoading,
        toggleBookmark,
        toggleFavorite,
        toggleLike,
        wikiPanelOpen,
        wikiPanelTab,
      } = useModalArticleState({ article, onNavigate, services });
    const HIGHLIGHT_DEBUG = getHighlightDebugEnabled();
    const loadDebug = () =>
        loadDebugData({
          article,
          services,
          setDebugData,
          setDebugLoading,
          setMatchedEntryIndex,
        });
    const loadAiAnalysis = () =>
        loadAiAnalysisData({
          article,
          services,
          setAiAnalysis,
          setAiAnalysisLoading,
          setAiAnalysisRequested,
        });
    const runAgenticSearch = (claim: FactCheckResult | undefined) =>
        runAgenticSearchData({
          article,
          claim,
          services,
          setAgenticAnswer,
          setAgenticError,
          setAgenticHistory,
          setAgenticLoading,
        });
    const handleLikeToggle = () => {
        void toggleArticleLike(article, toggleLike);
      };
    const handleBookmarkToggle = () => {
        void toggleArticleBookmark({
          article,
          isBookmarked,
          onBookmarkChange,
          setBookmarkLoading,
          toggleBookmark,
        });
      };
    const {
        aiActionLabel,
        aiHasError,
        canRequestAiAnalysis,
        factCheckResults,
        filteredClaims,
        statusCounts,
      } = getArticleDetailAnalysisState(
        aiAnalysis,
        aiAnalysisLoading,
        aiAnalysisRequested,
        activeStatusFilter,
      );
    const currentArticle = article;
    const canPersistArticle = currentArticle.isPersisted !== false;
    const {
        articleHost,
        articleTextForMetrics,
        articleWikiContext,
        estimatedReadMinutes,
        hasReporterWiki,
        hasSourceWiki,
        reporterName,
        showSummary,
        wordCount,
      } = getArticleDetailArticleState(currentArticle, fullArticleText);
    const { languageDiagnostics, languageDiagnosticsError, languageDiagnosticsLoading } =
        useArticleLanguageDiagnostics({
          aiAnalysis,
          article: currentArticle,
          articleTextForMetrics,
          isOpen,
          services,
          wordCount,
        });
    const openSourceWiki = () => {
        openModalWikiPanel({
          available: hasSourceWiki,
          setOpen: setWikiPanelOpen,
          setTab: setWikiPanelTab,
          tab: "source",
        });
      };
    const openReporterWiki = () => {
        openModalWikiPanel({
          available: hasReporterWiki,
          setOpen: setWikiPanelOpen,
          setTab: setWikiPanelTab,
          tab: "reporter",
        });
      };
    const handleClaimsOpenChange = (open: boolean) => {
        updateClaimsDialog({
          factCheckResults,
          open,
          selectedClaim,
          setActiveStatusFilter,
          setAgenticAnswer,
          setAgenticError,
          setClaimsOpen,
          setSelectedClaim,
        });
      };
    const visibleHighlights = getVisibleRemoteHighlights(highlights);
    const obsidianMarkdown = getArticleObsidianMarkdown(
        currentArticle,
        fullArticleText,
        reporterName,
        visibleHighlights,
      );
    const handleBackToTop = () => {
        contentScrollRef.current?.scrollTo({ behavior: "smooth", top: 0 });
      };
    const handleToggleDebug = () => {
        toggleDebugPanel({
          isOpen: debugOpen,
          loadDebug: () => {
            void loadDebug();
          },
          setOpen: setDebugOpen,
        });
      };
    const handleSelectClaim = (claim: FactCheckResult) => {
        setSelectedClaim(claim);
        setAgenticAnswer(undefined);
        setAgenticError(undefined);
      };
    const handleQueueToggle = () => {
        toggleArticleQueue({
          addArticleToQueue: (queuedArticle) => {
            void addArticleToQueue(queuedArticle);
          },
          article,
          isArticleInQueue,
          removeArticleFromQueue: (articleUrl) => {
            void removeArticleFromQueue(articleUrl);
          },
        });
      };
    const handleFavoriteToggle = () => {
        toggleArticleFavorite(article, toggleFavorite);
      };
    const onDialogOpenChange = useCallback(
        (open: boolean) => {
          if (!open) {
            onClose();
          }
        },
        [onClose],
      );
    const onCloseHighlightPopover = useCallback(() => {
        setHighlightPopoverOpen(false);
      }, [setHighlightPopoverOpen]);
    const onToggleExpanded = useCallback(() => {
        setIsExpanded((expanded) => !expanded);
      }, [setIsExpanded]);
    const onToggleSourceDetails = useCallback(() => {
        setShowSourceDetails((visible) => !visible);
      }, [setShowSourceDetails]);
    const onRelatedArticleClick = useCallback((relatedArticle: Readonly<{ url: string }>) => {
        globalThis.open(relatedArticle.url, "_blank", "noopener,noreferrer");
      }, []);

    if (!isOpen || currentArticle === null) {
      return false;
    }

    {
      const viewProps: ArticleDetailModalViewProps = {
        activeHighlightId,
        activeStatusFilter,
        agenticAnswer,
        agenticError,
        agenticHistory,
        agenticLoading,
        aiActionLabel,
        aiAnalysis,
        aiAnalysisLoading,
        aiAnalysisRequested,
        aiHasError,
        article,
        articleContentRef,
        articleHost,
        articleLoading,
        articleScrollProgress,
        articleWikiContext,
        bookmarkLoading,
        canPersistArticle,
        canRequestAiAnalysis,
        claimsOpen,
        contentScrollRef,
        currentArticle,
        debugData,
        debugEnabled: HIGHLIGHT_DEBUG,
        debugLoading,
        debugMode,
        debugOpen,
        editingId: sidebarEditingId,
        editingNote: sidebarEditingNote,
        estimatedReadMinutes,
        factCheckResults,
        filteredClaims,
        fullArticleText,
        handleNavigate,
        handleUndo,
        hasReporterWiki,
        hasSourceWiki,
        highlightColor,
        highlightPopoverAnchorEl,
        highlightPopoverHighlight,
        highlightPopoverOpen,
        highlightSyncStatus,
        highlights,
        inlineAnchorPosition,
        inlineOpen,
        inlineResult,
        isArticleInQueue,
        isBookmarked,
        isExpanded,
        isFavorite,
        isLiked,
        isOpen,
        languageDiagnostics,
        languageDiagnosticsError,
        languageDiagnosticsLoading,
        layoutIdPrefix,
        markAsRead,
        matchedEntryIndex,
        obsidianMarkdown,
        onAiAnalysis: () => {
          void loadAiAnalysis();
        },
        onBackToTop: handleBackToTop,
        onBookmark: handleBookmarkToggle,
        onCancelEdit: handleCancelEdit,
        onClaimsOpenChange: handleClaimsOpenChange,
        onClose,
        onCloseHighlightPopover,
        onColorSelect: handleColorSelect,
        onCreate: handleToolbarCreate,
        onDelete: handleToolbarDelete,
        onDialogOpenChange,
        onFavorite: handleFavoriteToggle,
        onFilterChange: setActiveStatusFilter,
        onHighlightClick: handleHighlightClick,
        onHighlightDelete: handleHighlightDelete,
        onLike: handleLikeToggle,
        onNavigate,
        onNoteChange: setSidebarEditingNote,
        onOpenReporterWiki: openReporterWiki,
        onOpenSourceWiki: openSourceWiki,
        onQueueToggle: handleQueueToggle,
        onRelatedArticleClick,
        onRetrySync: handleRetrySync,
        onRunAgenticSearch: runAgenticSearch,
        onSaveHighlightNote: handleSaveHighlightNote,
        onSaveNote: (stableId, note) => {
          void handleSaveNote(stableId, note);
        },
        onSelectClaim: handleSelectClaim,
        onStartEdit: handleStartEdit,
        onToggleDebug: handleToggleDebug,
        onToggleExpanded,
        onToggleShowHighlights: handleToggleShowHighlights,
        onToggleSourceDetails,
        onUpdate: handleToolbarUpdate,
        progressTrackRef,
        reporterName,
        selectedClaim,
        services,
        setArticleScrollProgress,
        setHighlightSyncStatus,
        setHighlights,
        setInlineOpen,
        setSelectedClaim,
        setWikiPanelOpen,
        setWikiPanelTab,
        showHighlights,
        showSourceDetails,
        showSummary,
        source: source ?? undefined,
        sourceLoading,
        statusCounts,
        visibleHighlights,
        wikiPanelOpen,
        wikiPanelTab,
        wordCount,
      };

      return <ArticleDetailModalView {...viewProps} />;
    }
  },
  COUNT_INCREMENT = 1,
  EMPTY_COUNT = 0,
  HIGHLIGHT_HISTORY_LIMIT = 20,
  HIGHLIGHT_POPOVER_DELAY_MS = 10,
  MILLISECONDS_PER_SECOND = 1000,
  MIN_LANGUAGE_DIAGNOSTIC_WORD_COUNT = 20,
  NOT_FOUND = -1,
  SECONDS_PER_MINUTE = 60,
  STALE_TIME_MINUTES = 5,
  appendAgenticQueryPart = (
    parts: readonly string[],
    label: string,
    value: string | undefined,
  ): string[] => ((() => {
  if (value === undefined || value === "") {
    return [...parts];
  }
  return [...parts, `${label}: ${value}`];
})()),
  appendHighlightHistory = (
    history: readonly (readonly LocalHighlight[])[],
    currentHighlights: readonly LocalHighlight[],
  ): LocalHighlight[][] =>
    [...history.map((entry) => [...entry]), [...currentHighlights]].slice(-HIGHLIGHT_HISTORY_LIMIT),
  buildAgenticQuery = (article: NewsArticle, claim: FactCheckResult): string => {
    let parts = [`Fact-check this claim: ${claim.claim}`];
    parts = appendAgenticQueryPart(parts, "Article title", article.title);
    parts = appendAgenticQueryPart(parts, "Publisher", article.source);
    parts = appendAgenticQueryPart(parts, "Existing evidence summary", claim.evidence);
    parts = [...parts, "Respond with a concise verification summary and cite authoritative sources."];
    return parts.join(" \n");
  },
  buildPendingHighlight = ({
    articleUrl,
    clientId,
    color,
    highlightedText,
    range,
  }: Readonly<{
    articleUrl: string;
    clientId: string;
    color: Highlight["color"];
    highlightedText: string;
    range: HighlightRange;
  }>): LocalHighlight =>
    markPending({
      highlight: {
        article_url: articleUrl,
        character_end: range.end,
        character_start: range.start,
        client_id: clientId,
        color,
        highlighted_text: highlightedText,
        local_updated_at: new Date().toISOString(),
        pending_op: "create",
        sync_status: "pending",
      },
      op: "create",
    }),
  deleteHighlightWithUndo = ({
    getNextHighlightOp: resolveNextHighlightOp,
    removed,
    updateHighlightByStableId,
    updateHighlightsWithHistory,
  }: Readonly<{
    readonly getNextHighlightOp: (
      highlight: LocalHighlight,
      fallback: "update" | "delete",
    ) => "create" | "update" | "delete";
    readonly removed: LocalHighlight;
    readonly updateHighlightByStableId: (
      stableId: string,
      updater: (highlight: LocalHighlight) => LocalHighlight,
    ) => void;
    readonly updateHighlightsWithHistory: (
      updater: (previous: readonly Readonly<LocalHighlight>[]) => LocalHighlight[],
    ) => void;
  }>): void => {
    try {
      updateHighlightByStableId(highlightStableId(removed), (item) =>
        markPending({
          highlight: item,
          op: resolveNextHighlightOp(item, "delete"),
        }),
      );

      toast("Annotation removed", {
        action: {
          label: "Undo",
          onClick: () => {
            updateHighlightsWithHistory((previous) =>
              restoreDeletedHighlight(previous, removed.client_id),
            );
          },
        },
      });
    } catch (error) {
      console.error("Failed to delete highlight", error);
      toast.error("Failed to delete annotation");
    }
  },
  filterFactCheckResults = (
    results: readonly FactCheckResult[],
    filter: FactCheckStatusFilter,
  ): FactCheckResult[] => {
    if (filter === "all") {
      return [...results];
    }
    return results.filter((claim) => claim.verification_status === filter);
  },
  findDebugEntryIndex = (
    data: DeepReadonly<SourceDebugData> | undefined,
    article: NewsArticle,
  ): number | undefined => {
    const articleTitle = normalizeDebugText(article.title),
      entries = data?.parsed_entries ?? [],
      titleIndex = entries.findIndex((entry) => normalizeDebugText(entry.title) === articleTitle),
      urlIndex = entries.findIndex((entry) => entry.link === article.url);
    if (entries.length === EMPTY_COUNT) {
      return void 0;
    }
    if (urlIndex !== NOT_FOUND) {
      return urlIndex;
    }
    if (titleIndex !== NOT_FOUND) {
      return titleIndex;
    }
    return void 0;
  },
  getAiActionLabel = (
    requested: boolean,
    loading: boolean,
    analysis: ArticleAnalysis | undefined,
  ): string => {
    if (!requested) {
      return "Run AI Analysis";
    }
    if (loading) {
      return "Running AI Analysis";
    }
    if (hasText(analysis?.error)) {
      return "Retry AI Analysis";
    }
    return "AI Analysis Ready";
  },
  getArticleDetailAnalysisState = (
    analysis: ArticleAnalysis | undefined,
    analysisLoading: boolean,
    analysisRequested: boolean,
    activeStatusFilter: FactCheckStatusFilter,
  ) => {
    const factCheckResults = analysis?.fact_check_results ?? [];
    return {
      aiActionLabel: getAiActionLabel(analysisRequested, analysisLoading, analysis),
      aiHasError: Boolean(analysis?.error),
      canRequestAiAnalysis: !analysisRequested || Boolean(analysis?.error),
      factCheckResults,
      filteredClaims: filterFactCheckResults(factCheckResults, activeStatusFilter),
      statusCounts: getFactCheckStatusCounts(factCheckResults),
    };
  },
  getArticleDetailArticleState = (article: NewsArticle, fullArticleText: string | undefined) => {
    const articleTextForMetrics = getArticleTextForMetrics(
        fullArticleText,
        article.content,
        article.summary,
      ),
      { wordCount, estimatedReadMinutes } = getArticleWordMetrics(articleTextForMetrics),
      reporterName = getReporterName(article);
    return {
      articleHost: getArticleHost(article.url),
      articleTextForMetrics,
      articleWikiContext: getArticleWikiContext(fullArticleText, article.content, article.summary),
      estimatedReadMinutes,
      hasReporterWiki: Boolean(reporterName),
      hasSourceWiki: Boolean(article.source.trim()),
      reporterName,
      showSummary: shouldShowSummary(article.summary, article.content, fullArticleText),
      wordCount,
    };
  },
  getArticleObsidianMarkdown = (
    article: Readonly<NewsArticle>,
    fullArticleText: string | undefined,
    reporterName: string,
    highlights: readonly Highlight[],
  ): string =>
    buildObsidianMarkdown({
      article: {
        author: reporterName || article.author,
        content: article.content,
        publishedAt: article.publishedAt || "",
        summary: article.summary || "",
        title: article.title || "",
        url: article.url || "",
      },
      fullArticleText,
      highlights,
    }),
  getErrorMessage = (error: Error | string, fallback: string): string => {
    if (error instanceof Error) {
      return error.message;
    }
    return fallback;
  },
  getFactCheckStatusCounts = (
    results: readonly FactCheckResult[],
  ): Record<FactCheckStatus, number> =>
    results.reduce<Record<FactCheckStatus, number>>(
      (counts, result) => {
        counts[result.verification_status] += COUNT_INCREMENT;
        return counts;
      },
      { false: 0, "partially-verified": 0, unverified: 0, verified: 0 },
    ),
  getHighlightDebugEnabled = (): boolean =>
    globalThis.window !== undefined && globalThis.localStorage.getItem("debug_highlights") === "1",
  getHighlightPendingOperation = (highlight: LocalHighlight): "create" | "update" => {
    if (highlight.server_id !== undefined) {
      return "update";
    }
    return "create";
  },
  getLanguageDiagnosticsError = (
    error: Error | string | null | undefined,
    diagnostics: Readonly<LanguageDiagnostics> | null | undefined,
  ): string | undefined => {
    if (error instanceof Error) {
      return error.message;
    }
    return error ?? diagnostics?.error ?? undefined;
  },
  getNextHighlightOp = (
    highlight: LocalHighlight,
    fallback: "update" | "delete",
  ): "create" | "update" | "delete" => {
    const fallbackOperations = {
        delete: "delete",
        update: "create",
      } satisfies Record<"update" | "delete", "create" | "delete">,
      highlightId = highlight.server_id ?? highlight.id;
    if (highlight.pending_op === "create") {
      return "create";
    }
    if (highlightId !== undefined && highlightId !== EMPTY_COUNT) {
      return fallback;
    }
    return fallbackOperations[fallback];
  },
  getPreviousHighlightHistory = (
    history: readonly (readonly LocalHighlight[])[],
  ): HighlightHistoryState => {
    const nextHistory: LocalHighlight[][] = history.map((entry) => [...entry]),
      previousState = nextHistory.pop();
    return { nextHistory, previousState };
  },
  getVisibleRemoteHighlights = (highlights: readonly LocalHighlight[]): Highlight[] =>
    toRemoteHighlights(highlights.filter((highlight) => highlight.deleted !== true)),
  hasDuplicateHighlight = (
    highlights: readonly LocalHighlight[],
    highlightedText: string,
    range: HighlightRange,
  ): boolean => {
    const fingerprint = createHighlightFingerprint({
      character_end: range.end,
      character_start: range.start,
      highlighted_text: highlightedText,
    });
    return highlights.some((highlight) => {
      if (highlight.deleted === true) {
        return false;
      }
      return (
        createHighlightFingerprint({
          character_end: highlight.character_end,
          character_start: highlight.character_start,
          highlighted_text: highlight.highlighted_text,
        }) === fingerprint
      );
    });
  },
  loadAiAnalysisData = async ({
    article,
    services,
    setAiAnalysis,
    setAiAnalysisLoading,
    setAiAnalysisRequested,
  }: Readonly<{
    article: NewsArticle;
    services: ArticleDetailServices;
    setAiAnalysis: (analysis: ArticleAnalysis) => void;
    setAiAnalysisLoading: (loading: boolean) => void;
    setAiAnalysisRequested: (requested: boolean) => void;
  }>): Promise<void> => {
    setAiAnalysisRequested(true);
    setAiAnalysisLoading(true);
    try {
      setAiAnalysis(await services.analyzeArticle(article.url, article.source));
    } catch (error) {
      console.error("Failed to analyze article:", error);
      setAiAnalysis({
        article_url: article.url,
        error: getErrorMessage(
          (() => {
  if (error instanceof Error) {
    return error;
  }
  return String(error);
})(),
          "Failed to analyze article",
        ),
        success: false,
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  },
  loadDebugData = async ({
    article,
    services,
    setDebugData,
    setDebugLoading,
    setMatchedEntryIndex,
  }: Readonly<DebugLoaderState>): Promise<void> => {
    setDebugLoading(true);
    try {
      const data = await services.fetchSourceDebugData(article.source);
      setDebugData(data);
      setMatchedEntryIndex(findDebugEntryIndex(data, article));
    } catch (error) {
      console.error("Failed to fetch debug data:", error);
      setDebugData(undefined);
      setMatchedEntryIndex(undefined);
    } finally {
      setDebugLoading(false);
    }
  },
  normalizeDebugText = (value: string): string =>
    value.toLowerCase().replaceAll(/\s+/gu, " ").trim(),
  openModalWikiPanel = ({
    available,
    setOpen,
    setTab,
    tab,
  }: Readonly<{
    readonly available: boolean;
    readonly setOpen: (open: boolean) => void;
    readonly setTab: (tab: "source" | "reporter") => void;
    readonly tab: "source" | "reporter";
  }>): void => {
    if (!available) {
      return;
    }
    setTab(tab);
    setOpen(true);
  },
  persistHighlightChanges = (
    articleUrl: string | undefined,
    highlights: readonly LocalHighlight[],
    runHighlightOperations: (url: string, current: readonly LocalHighlight[]) => void,
  ): void => {
    if (articleUrl === undefined || articleUrl === "") {
      return;
    }
    saveHighlightStore({
      article_url: articleUrl,
      highlights: [...highlights],
      version: HIGHLIGHT_STORE_VERSION,
    });
    runHighlightOperations(articleUrl, highlights);
  },
  publishAgenticAnswer = (
    response: Awaited<ReturnType<ArticleDetailServices["performAgenticSearch"]>>,
    claim: FactCheckResult,
    setAgenticAnswer: (answer: string | undefined) => void,
    setAgenticHistory: (
      update: (
        previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
      ) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
    ) => void,
  ): boolean => {
    if (!(response.success && response.answer)) {
      return false;
    }
    setAgenticAnswer(response.answer);
    setAgenticHistory((previous) =>
      [{ answer: response.answer, claim: claim.claim, timestamp: Date.now() }, ...previous].slice(
        EMPTY_COUNT,
        AGENTIC_HISTORY_LIMIT,
      ),
    );
    return true;
  },
  restoreDeletedHighlight = (
    highlights: readonly LocalHighlight[],
    clientId: string,
  ): LocalHighlight[] =>
    highlights.map((highlight) => {
      if (highlight.client_id !== clientId) {
        return highlight;
      }
      return {
        ...highlight,
        deleted: false,
        last_error: undefined,
        local_updated_at: new Date().toISOString(),
        pending_op: undefined,
        sync_status: "pending",
      };
    }),
  restoreHighlightState = (
    previousState: readonly LocalHighlight[],
    current: readonly LocalHighlight[],
  ): LocalHighlight[] => [
    ...previousState.map((previousHighlight) =>
      restorePreviousHighlight(
        previousHighlight,
        current.find((highlight) => highlight.client_id === previousHighlight.client_id),
      ),
    ),
    ...current
      .filter((currentHighlight) => shouldRestoreDeletedHighlight(previousState, currentHighlight))
      .map((currentHighlight) =>
        markPending({
          highlight: { ...currentHighlight, deleted: true },
          op: "delete",
        }),
      ),
  ],
  restorePreviousHighlight = (
    previousHighlight: LocalHighlight,
    currentEquivalent: LocalHighlight | undefined,
  ): LocalHighlight => {
    if (currentEquivalent === undefined && previousHighlight.deleted !== true) {
      return markPending({
        highlight: previousHighlight,
        op: getHighlightPendingOperation(previousHighlight),
      });
    }
    if (currentEquivalent?.deleted === true && previousHighlight.deleted !== true) {
      return markPending({
        highlight: { ...previousHighlight, deleted: false },
        op: getHighlightPendingOperation(previousHighlight),
      });
    }
    return previousHighlight;
  },
  runAgenticSearchData = async ({
    article,
    claim,
    services,
    setAgenticAnswer,
    setAgenticError,
    setAgenticHistory,
    setAgenticLoading,
  }: Readonly<{
    article: NewsArticle;
    claim: FactCheckResult | undefined;
    services: ArticleDetailServices;
    setAgenticAnswer: (answer: string | undefined) => void;
    setAgenticError: (error: string | undefined) => void;
    setAgenticHistory: (
      update: (
        previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
      ) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
    ) => void;
    setAgenticLoading: (loading: boolean) => void;
  }>): Promise<void> => {
    if (claim === undefined) {
      return;
    }
    setAgenticLoading(true);
    setAgenticAnswer(undefined);
    setAgenticError(undefined);
    try {
      await runAgenticSearchRequest({
        article,
        claim,
        services,
        setAgenticAnswer,
        setAgenticError,
        setAgenticHistory,
      });
    } catch (error) {
      setAgenticError(
        getErrorMessage((() => {
  if (error instanceof Error) {
    return error;
  }
  return String(error);
})(), "Agentic search failed."),
      );
    } finally {
      setAgenticLoading(false);
    }
  },
  runAgenticSearchRequest = async ({
    article,
    claim,
    services,
    setAgenticAnswer,
    setAgenticError,
    setAgenticHistory,
  }: Readonly<{
    article: NewsArticle;
    claim: FactCheckResult;
    services: ArticleDetailServices;
    setAgenticAnswer: (answer: string | undefined) => void;
    setAgenticError: (error: string | undefined) => void;
    setAgenticHistory: (
      update: (
        previous: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
      ) => readonly Readonly<{ claim: string; answer: string; timestamp: number }>[],
    ) => void;
  }>): Promise<void> => {
    const response = await services.performAgenticSearch(
      buildAgenticQuery(article, claim),
      AGENTIC_MAX_RESULTS,
    );
    if (!publishAgenticAnswer(response, claim, setAgenticAnswer, setAgenticHistory)) {
      setAgenticError(
        "Agentic search returned no direct answer. Try again or open the research workspace for a deeper dive.",
      );
    }
  },
  shouldRestoreDeletedHighlight = (
    previousState: readonly LocalHighlight[],
    currentHighlight: LocalHighlight,
  ): boolean =>
    !previousState.some((highlight) => highlight.client_id === currentHighlight.client_id) &&
    currentHighlight.deleted !== true,
  toggleArticleBookmark = async ({
    article,
    isBookmarked,
    onBookmarkChange,
    setBookmarkLoading,
    toggleBookmark,
  }: Readonly<ArticleBookmarkActionProps>): Promise<void> => {
    if (!article.id || article.isPersisted === false) {
      return;
    }

    setBookmarkLoading(true);
    try {
      const currentlyBookmarked = isBookmarked(article.id);
      await toggleBookmark(article.id);
      onBookmarkChange?.(article.id, !currentlyBookmarked);
    } catch (error) {
      console.error("Failed to toggle bookmark:", error);
    } finally {
      setBookmarkLoading(false);
    }
  },
  toggleArticleFavorite = (
    article: NewsArticle,
    toggleFavorite: (sourceId: string) => void,
  ): void => {
    toggleFavorite(article.sourceId);
  },
  toggleArticleLike = async (
    article: NewsArticle,
    toggleLike: (articleId: number) => Promise<void>,
  ): Promise<void> => {
    if (!article.id || article.isPersisted === false) {
      return;
    }
    await toggleLike(article.id);
  },
  toggleArticleQueue = ({
    addArticleToQueue,
    article,
    isArticleInQueue,
    removeArticleFromQueue,
  }: Readonly<{
    readonly addArticleToQueue: (article: NewsArticle) => void;
    readonly article: NewsArticle;
    readonly isArticleInQueue: (url: string) => boolean;
    readonly removeArticleFromQueue: (url: string) => void;
  }>): void => {
    if (isArticleInQueue(article.url)) {
      removeArticleFromQueue(article.url);
      return;
    }
    addArticleToQueue(article);
  },
  toggleDebugPanel = ({
    isOpen,
    loadDebug,
    setOpen,
  }: Readonly<{
    readonly isOpen: boolean;
    readonly loadDebug: () => void;
    readonly setOpen: (open: boolean) => void;
  }>): void => {
    setOpen(!isOpen);
    if (!isOpen) {
      loadDebug();
    }
  },
  updateClaimsDialog = ({
    factCheckResults,
    open,
    selectedClaim,
    setActiveStatusFilter,
    setAgenticAnswer,
    setAgenticError,
    setClaimsOpen,
    setSelectedClaim,
  }: Readonly<{
    readonly factCheckResults: readonly FactCheckResult[];
    readonly open: boolean;
    readonly selectedClaim: FactCheckResult | undefined;
    readonly setActiveStatusFilter: (filter: FactCheckStatusFilter) => void;
    readonly setAgenticAnswer: (answer: string | undefined) => void;
    readonly setAgenticError: (error: string | undefined) => void;
    readonly setClaimsOpen: (open: boolean) => void;
    readonly setSelectedClaim: (claim: FactCheckResult | undefined) => void;
  }>): void => {
    setClaimsOpen(open);
    if (!open) {
      setSelectedClaim(undefined);
      setAgenticAnswer(undefined);
      setAgenticError(undefined);
      setActiveStatusFilter("all");
      return;
    }

    if (!selectedClaim && factCheckResults.length > EMPTY_COUNT) {
      setSelectedClaim(factCheckResults[EMPTY_COUNT]);
    }
  },
  updateHighlightByClientId = (
    highlights: readonly LocalHighlight[],
    clientId: string,
    updater: (highlight: LocalHighlight) => LocalHighlight,
  ): LocalHighlight[] =>
    highlights.map((highlight) => {
      if (highlight.client_id !== clientId) {
        return highlight;
      }
      return updater(highlight);
    }),
  updateHighlightByServerId = (
    highlights: readonly LocalHighlight[],
    highlightId: number,
    updater: (highlight: LocalHighlight) => LocalHighlight,
  ): LocalHighlight[] =>
    highlights.map((highlight) => {
      const id = highlight.server_id ?? highlight.id;
      if (id !== highlightId) {
        return highlight;
      }
      return updater(highlight);
    }),
  useModalArticleState = ({
    article,
    services,
    onNavigate,
  }: Readonly<{
    article: NewsArticle;
    services: ArticleDetailServices;
    onNavigate?: (direction: "prev" | "next") => void;
  }>) => {
    const {
        bookmarks: { isBookmarked, toggleBookmark },
        debugMode,
        favorites: { isFavorite, toggleFavorite },
        inlineDefinition: {
          result: inlineResult,
          open: inlineOpen,
          setOpen: setInlineOpen,
          anchorPosition: inlineAnchorPosition,
        },
        likedArticles: { isLiked, toggleLike },
        readingHistory: { markAsRead },
        readingQueue: { addArticleToQueue, removeArticleFromQueue, isArticleInQueue },
      } = useModalIntegrations();
    const [showSourceDetails, setShowSourceDetails] = useState(false);
    const [debugOpen, setDebugOpen] = useState(false);
    const [debugLoading, setDebugLoading] = useState(false);
    const [debugData, setDebugData] = useState<SourceDebugData | undefined>();
    const [matchedEntryIndex, setMatchedEntryIndex] = useState<number | undefined>();
    const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | undefined>();
    const [isExpanded, setIsExpanded] = useState(false);
    const handleNavigate = useCallback(
        (direction: "prev" | "next") => {
          onNavigate?.(direction);
        },
        [onNavigate],
      );
    const [bookmarkLoading, setBookmarkLoading] = useState(false);
    const [claimsOpen, setClaimsOpen] = useState(false);
    const [activeStatusFilter, setActiveStatusFilter] = useState<FactCheckStatusFilter>("all");
    const [selectedClaim, setSelectedClaim] = useState<FactCheckResult | undefined>();
    const [agenticLoading, setAgenticLoading] = useState(false);
    const [agenticAnswer, setAgenticAnswer] = useState<string | undefined>();
    const [agenticError, setAgenticError] = useState<string | undefined>();
    const [agenticHistory, setAgenticHistory] = useState<
        readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]
      >([]);
    const [showHighlights, setShowHighlights] = useState(true);
    const [highlightColor, setHighlightColor] = useState<Highlight["color"]>("yellow");
    const [sidebarEditingId, setSidebarEditingId] = useState<string | undefined>();
    const [sidebarEditingNote, setSidebarEditingNote] = useState("");
    const [aiAnalysisRequested, setAiAnalysisRequested] = useState(false);
    const [highlights, setHighlights] = useState<LocalHighlight[]>([]);
    const [highlightSyncStatus, setHighlightSyncStatus] = useState<
        "idle" | "syncing" | "failed" | "offline"
      >("idle");
    const [, setHighlightsHistory] = useState<LocalHighlight[][]>([]);
    const articleContentRef = useRef<HTMLDivElement>(null);
    const [activeHighlightId, setActiveHighlightId] = useState<string | undefined>();
    const [highlightPopoverOpen, setHighlightPopoverOpen] = useState(false);
    const [highlightPopoverAnchorEl, setHighlightPopoverAnchorEl] = useState<
        HighlightAnchorElement | undefined
      >();
    const [highlightPopoverHighlight, setHighlightPopoverHighlight] = useState<
        LocalHighlight | undefined
      >();
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const progressTrackRef = useRef<HTMLDivElement>(null);
    const [articleScrollProgress, setArticleScrollProgress] = useState(0);
    const [wikiPanelOpen, setWikiPanelOpen] = useState(false);
    const [wikiPanelTab, setWikiPanelTab] = useState<"source" | "reporter">("source");
    const articleCacheKey = getArticleCacheKey(article);
    const { data: source, isLoading: sourceLoading } = useQuery<NewsSource | null>({
        queryFn: async () => (await services.getSourceById(article.sourceId)) ?? null,
        queryKey: ["source", article.sourceId],
        retry: 1,
      });
    const { data: fullArticleText, isFetching: articleLoading } = useQuery<string | undefined>({
        placeholderData: getInitialArticleText(article),
        queryFn: async ({ signal }) => (await fetchFullArticleText(article, signal)) ?? "",
        queryKey: ["article-full-text", articleCacheKey],
        retry: 1,
        staleTime: MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * STALE_TIME_MINUTES,
      });
    const { handleUndo, runHighlightOperations, updateHighlightsWithHistory } =
        useModalHighlightHistory({
          article,
          services,
          setHighlightSyncStatus,
          setHighlights,
          setHighlightsHistory,
        });
    const {
        handleColorSelect,
        handleHighlightClick,
        handleRetrySync,
        handleSaveHighlightNote,
        handleToggleShowHighlights,
        handleToolbarCreate,
        handleToolbarDelete,
        handleToolbarUpdate,
        updateHighlightByStableId,
      } = useModalHighlightActions({
        article,
        articleContentRef,
        highlights,
        runHighlightOperations,
        setActiveHighlightId,
        setHighlightColor,
        setHighlightPopoverAnchorEl,
        setHighlightPopoverHighlight,
        setHighlightPopoverOpen,
        setShowHighlights,
        updateHighlightsWithHistory,
      });
    const { handleCancelEdit, handleHighlightDelete, handleSaveNote, handleStartEdit } =
        useModalHighlightEditorActions({
          handleSaveHighlightNote,
          setSidebarEditingId,
          setSidebarEditingNote,
          updateHighlightByStableId,
          updateHighlightsWithHistory,
        });

    return {
      activeHighlightId,
      activeStatusFilter,
      addArticleToQueue,
      agenticAnswer,
      agenticError,
      agenticHistory,
      agenticLoading,
      aiAnalysis,
      aiAnalysisLoading,
      aiAnalysisRequested,
      articleCacheKey,
      articleContentRef,
      articleLoading,
      articleScrollProgress,
      bookmarkLoading,
      claimsOpen,
      contentScrollRef,
      debugData,
      debugLoading,
      debugMode,
      debugOpen,
      fullArticleText,
      handleCancelEdit,
      handleColorSelect,
      handleHighlightClick,
      handleHighlightDelete,
      handleNavigate,
      handleRetrySync,
      handleSaveHighlightNote,
      handleSaveNote,
      handleStartEdit,
      handleToggleShowHighlights,
      handleToolbarCreate,
      handleToolbarDelete,
      handleToolbarUpdate,
      handleUndo,
      highlightColor,
      highlightPopoverAnchorEl,
      highlightPopoverHighlight,
      highlightPopoverOpen,
      highlightSyncStatus,
      highlights,
      inlineAnchorPosition,
      inlineOpen,
      inlineResult,
      isArticleInQueue,
      isBookmarked,
      isExpanded,
      isFavorite,
      isLiked,
      markAsRead,
      matchedEntryIndex,
      progressTrackRef,
      removeArticleFromQueue,
      selectedClaim,
      setActiveStatusFilter,
      setAgenticAnswer,
      setAgenticError,
      setAgenticHistory,
      setAgenticLoading,
      setAiAnalysis,
      setAiAnalysisLoading,
      setAiAnalysisRequested,
      setArticleScrollProgress,
      setBookmarkLoading,
      setClaimsOpen,
      setDebugData,
      setDebugLoading,
      setDebugOpen,
      setHighlightColor,
      setHighlightPopoverOpen,
      setHighlightSyncStatus,
      setHighlights,
      setInlineOpen,
      setIsExpanded,
      setMatchedEntryIndex,
      setSelectedClaim,
      setShowSourceDetails,
      setSidebarEditingNote,
      setWikiPanelOpen,
      setWikiPanelTab,
      showHighlights,
      showSourceDetails,
      sidebarEditingId,
      sidebarEditingNote,
      source,
      sourceLoading,
      toggleBookmark,
      toggleFavorite,
      toggleLike,
      wikiPanelOpen,
      wikiPanelTab,
    };
  },
  useModalHighlightActions = ({
    article,
    articleContentRef,
    highlights,
    runHighlightOperations,
    setActiveHighlightId,
    setHighlightColor,
    setHighlightPopoverAnchorEl,
    setHighlightPopoverHighlight,
    setHighlightPopoverOpen,
    setShowHighlights,
    updateHighlightsWithHistory,
  }: Readonly<ModalHighlightActionsProps>) => {
    const lastCreatedClientIdRef = useRef<string | undefined>(void 0);
    const updateHighlightByStableId = useCallback(
        (stableId: string, updater: (highlight: LocalHighlight) => LocalHighlight) => {
          updateHighlightsWithHistory((previous) =>
            updateHighlightByClientId(previous, stableId, updater),
          );
        },
        [updateHighlightsWithHistory],
      );
    const handleHighlightClick = useCallback(
        (stableId: string, element: HighlightAnchorElement) => {
          const found = highlights.find((item) => highlightStableId(item) === stableId);
          setActiveHighlightId(stableId);
          setHighlightPopoverHighlight(found);
          setHighlightPopoverAnchorEl(element);
          setHighlightPopoverOpen(true);
        },
        [
          highlights,
          setActiveHighlightId,
          setHighlightPopoverAnchorEl,
          setHighlightPopoverHighlight,
          setHighlightPopoverOpen,
        ],
      );
    const handleSaveHighlightNote = useCallback(
        (highlightId: string, note: string): Promise<void> => {
          updateHighlightByStableId(highlightId, (item) =>
            markPending({
              highlight: { ...item, note },
              op: getNextHighlightOp(item, "update"),
            }),
          );
          return Promise.resolve();
        },
        [updateHighlightByStableId],
      );
    const handleToolbarCreate = useCallback(
        ({ highlightedText, color, range }: Readonly<CreateHighlightPayload>): void => {
          if (hasDuplicateHighlight(highlights, highlightedText, range)) {
            toast.error("That exact text is already highlighted");
            return;
          }

          const clientId = generateClientId();
          lastCreatedClientIdRef.current = clientId;
          {
            const nextLocal = buildPendingHighlight({
              articleUrl: article.url,
              clientId,
              color,
              highlightedText,
              range,
            });
            updateHighlightsWithHistory((previous) =>
              dedupeLocalHighlights([...previous, nextLocal]),
            );

            setTimeout(() => {
              const anchor = articleContentRef.current?.querySelector<HTMLElement>(
                `mark[data-highlight-stable-id="client:${clientId}"]`,
              );
              setHighlightPopoverHighlight(nextLocal);
              setHighlightPopoverAnchorEl(anchor ?? undefined);
              setHighlightPopoverOpen(true);
            }, HIGHLIGHT_POPOVER_DELAY_MS);
          }
        },
        [
          article.url,
          articleContentRef,
          highlights,
          lastCreatedClientIdRef,
          setHighlightPopoverAnchorEl,
          setHighlightPopoverHighlight,
          setHighlightPopoverOpen,
          updateHighlightsWithHistory,
        ],
      );
    const handleToolbarUpdate = useCallback(
        ({ highlightId, note }: Readonly<UpdateHighlightPayload>): void => {
          updateHighlightsWithHistory((previous) =>
            updateHighlightByServerId(previous, highlightId, (item) =>
              markPending({ highlight: { ...item, note }, op: "update" }),
            ),
          );
        },
        [updateHighlightsWithHistory],
      );
    const handleToolbarDelete = useCallback(
        ({ highlightId }: Readonly<DeleteHighlightPayload>): void => {
          updateHighlightsWithHistory((previous) =>
            updateHighlightByServerId(previous, highlightId, (item) =>
              markPending({ highlight: item, op: "delete" }),
            ),
          );
        },
        [updateHighlightsWithHistory],
      );
    const handleRetrySync = useCallback(() => {
        runHighlightOperations(article.url, highlights);
      }, [article.url, highlights, runHighlightOperations]);
    const handleToggleShowHighlights = useCallback(() => {
        setShowHighlights((previous) => !previous);
      }, [setShowHighlights]);
    const handleColorSelect = useCallback(
        (color: Highlight["color"]) => {
          setHighlightColor(color);
          const lastClientId = lastCreatedClientIdRef.current;
          if (lastClientId === undefined || lastClientId === "") {
            return;
          }
          updateHighlightsWithHistory((previous) =>
            updateHighlightByClientId(previous, lastClientId, (item) =>
              markPending({
                highlight: { ...item, color },
                op: getNextHighlightOp(item, "update"),
              }),
            ),
          );
        },
        [lastCreatedClientIdRef, setHighlightColor, updateHighlightsWithHistory],
      );

    return {
      handleColorSelect,
      handleHighlightClick,
      handleRetrySync,
      handleSaveHighlightNote,
      handleToggleShowHighlights,
      handleToolbarCreate,
      handleToolbarDelete,
      handleToolbarUpdate,
      updateHighlightByStableId,
    };
  },
  useModalHighlightEditorActions = ({
    handleSaveHighlightNote,
    setSidebarEditingId,
    setSidebarEditingNote,
    updateHighlightByStableId,
    updateHighlightsWithHistory,
  }: Readonly<ModalHighlightEditorActionsProps>) => {
    const handleCancelEdit = useCallback(() => {
        setSidebarEditingId(undefined);
        setSidebarEditingNote("");
      }, [setSidebarEditingId, setSidebarEditingNote]),
      handleHighlightDelete = useCallback(
        (removed: LocalHighlight) => {
          deleteHighlightWithUndo({
            getNextHighlightOp,
            removed,
            updateHighlightByStableId,
            updateHighlightsWithHistory,
          });
        },
        [updateHighlightByStableId, updateHighlightsWithHistory],
      ),
      handleSaveNote = useCallback(
        async (stableId: string, note: string): Promise<void> => {
          await handleSaveHighlightNote(stableId, note);
          setSidebarEditingId(undefined);
          setSidebarEditingNote("");
        },
        [handleSaveHighlightNote, setSidebarEditingId, setSidebarEditingNote],
      ),
      handleStartEdit = useCallback(
        (highlight: LocalHighlight) => {
          setSidebarEditingId(highlightStableId(highlight));
          setSidebarEditingNote(highlight.note ?? "");
        },
        [setSidebarEditingId, setSidebarEditingNote],
      );

    return { handleCancelEdit, handleHighlightDelete, handleSaveNote, handleStartEdit };
  },
  useModalHighlightHistory = ({
    article,
    services,
    setHighlightSyncStatus,
    setHighlights,
    setHighlightsHistory,
  }: Readonly<ModalHighlightHistoryProps>) => {
    const latestHighlightSyncRef = useRef(EMPTY_COUNT);
    const setReadonlyHighlights = useCallback(
        (next: readonly Readonly<LocalHighlight>[]): void => {
          setHighlights([...next]);
        },
        [setHighlights],
      );
    const pushToHistory = useCallback(
        (currentHighlights: readonly LocalHighlight[]) => {
          setHighlightsHistory((previous) => appendHighlightHistory(previous, currentHighlights));
        },
        [setHighlightsHistory],
      );
    const runHighlightOperations = useCallback(
        (articleUrl: string, current: readonly LocalHighlight[]) => {
          void syncHighlights(articleUrl, current, {
            latestSyncToken: latestHighlightSyncRef,
            services,
            setHighlights: setReadonlyHighlights,
            setLatestSyncToken: (syncToken) => {
              latestHighlightSyncRef.current = syncToken;
            },
            setStatus: setHighlightSyncStatus,
          });
        },
        [latestHighlightSyncRef, services, setHighlightSyncStatus, setReadonlyHighlights],
      );
    const handleUndo = useCallback(() => {
        setHighlightsHistory((previous) => {
          const { nextHistory, previousState } = getPreviousHighlightHistory(previous);
          if (!previousState || !article.url) {
            return nextHistory;
          }

          setHighlights((current) => {
            const nextState = restoreHighlightState(previousState, current);
            persistHighlightChanges(article.url, nextState, runHighlightOperations);
            return nextState;
          });
          return nextHistory;
        });
      }, [article.url, runHighlightOperations, setHighlights, setHighlightsHistory]);
    const updateHighlightsWithHistory = useCallback(
        (updater: (previous: readonly Readonly<LocalHighlight>[]) => LocalHighlight[]) => {
          setHighlights((previous) => {
            pushToHistory(previous);
            const next = updater(previous);
            persistHighlightChanges(article.url, next, runHighlightOperations);
            return next;
          });
        },
        [article.url, pushToHistory, runHighlightOperations, setHighlights],
      );

    return { handleUndo, runHighlightOperations, updateHighlightsWithHistory };
  };

export { ArticleDetailModal };
export type { ArticleDetailServices } from "../lib/article-detail-modal-types";
