"use client";

import { useCallback, useRef, useState } from "react";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useQuery } from "@tanstack/react-query";
import type {
  ArticleAnalysis,
  ArticleDetailModalProps,
  ArticleDetailServices,
  FactCheckResult,
  FactCheckStatusFilter,
  Highlight,
  HighlightAnchorElement,
  LanguageDiagnostics,
  LocalHighlight,
  NewsArticle,
  NewsSource,
  SourceDebugData,
} from "../lib/article-detail-modal-data";
import { fetchFullArticleText, getArticleCacheKey, getInitialArticleText } from "../lib/article-detail-modal-data";
import { getRenderedLanguageDiagnostics } from "./article-detail-modal-reader";
import { getLanguageDiagnosticsError } from "./article-detail-modal-operations";
import {
  useModalHighlightActions,
  useModalHighlightEditorActions,
  useModalHighlightHistory,
} from "./article-detail-modal-highlight-hooks";
import { useModalIntegrations } from "../hooks/use-modal-integrations";

const ARTICLE_TEXT_PREVIEW_LENGTH = 120;
const EMPTY_COUNT = 0;
const MILLISECONDS_PER_SECOND = 1000;
const MIN_LANGUAGE_DIAGNOSTIC_WORD_COUNT = 20;
const SECONDS_PER_MINUTE = 60;
const STALE_TIME_MINUTES = 5;

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

const useModalIntegrationValues = () => {
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

    return {
      addArticleToQueue,
      debugMode,
      inlineAnchorPosition,
      inlineOpen,
      inlineResult,
      isArticleInQueue,
      isBookmarked,
      isFavorite,
      isLiked,
      markAsRead,
      removeArticleFromQueue,
      setInlineOpen,
      toggleBookmark,
      toggleFavorite,
      toggleLike,
    };
  };

const useModalArticleUiState = () => {
    const [showSourceDetails, setShowSourceDetails] = useState(false);
    const [debugOpen, setDebugOpen] = useState(false);
    const [debugLoading, setDebugLoading] = useState(false);
    const [debugData, setDebugData] = useState<SourceDebugData | undefined>();
    const [matchedEntryIndex, setMatchedEntryIndex] = useState<number | undefined>();
    const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | undefined>();
    const [isExpanded, setIsExpanded] = useState(false);
    const [bookmarkLoading, setBookmarkLoading] = useState(false);

    return {
      aiAnalysis,
      aiAnalysisLoading,
      bookmarkLoading,
      debugData,
      debugLoading,
      debugOpen,
      isExpanded,
      matchedEntryIndex,
      setAiAnalysis,
      setAiAnalysisLoading,
      setBookmarkLoading,
      setDebugData,
      setDebugLoading,
      setDebugOpen,
      setIsExpanded,
      setMatchedEntryIndex,
      setShowSourceDetails,
      showSourceDetails,
    };
  };

const useModalArticleAnalysisState = () => {
    const [claimsOpen, setClaimsOpen] = useState(false);
    const [activeStatusFilter, setActiveStatusFilter] = useState<FactCheckStatusFilter>("all");
    const [selectedClaim, setSelectedClaim] = useState<FactCheckResult | undefined>();
    const [agenticLoading, setAgenticLoading] = useState(false);
    const [agenticAnswer, setAgenticAnswer] = useState<string | undefined>();
    const [agenticError, setAgenticError] = useState<string | undefined>();
    const [agenticHistory, setAgenticHistory] = useState<
      readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]
    >([]);
    const [aiAnalysisRequested, setAiAnalysisRequested] = useState(false);

    return {
      activeStatusFilter,
      agenticAnswer,
      agenticError,
      agenticHistory,
      agenticLoading,
      aiAnalysisRequested,
      claimsOpen,
      selectedClaim,
      setActiveStatusFilter,
      setAgenticAnswer,
      setAgenticError,
      setAgenticHistory,
      setAgenticLoading,
      setAiAnalysisRequested,
      setClaimsOpen,
      setSelectedClaim,
    };
  };

const useModalHighlightState = () => {
    const [showHighlights, setShowHighlights] = useState(true);
    const [highlightColor, setHighlightColor] = useState<Highlight["color"]>("yellow");
    const [sidebarEditingId, setSidebarEditingId] = useState<string | undefined>();
    const [sidebarEditingNote, setSidebarEditingNote] = useState("");
    const [highlights, setHighlights] = useState<LocalHighlight[]>([]);
    const [highlightSyncStatus, setHighlightSyncStatus] = useState<
      "idle" | "syncing" | "failed" | "offline"
    >("idle");
    const [, setHighlightsHistory] = useState<LocalHighlight[][]>([]);

    return {
      highlightColor,
      highlightSyncStatus,
      highlights,
      setHighlightColor,
      setHighlightSyncStatus,
      setHighlights,
      setHighlightsHistory,
      setShowHighlights,
      setSidebarEditingId,
      setSidebarEditingNote,
      showHighlights,
      sidebarEditingId,
      sidebarEditingNote,
    };
  };

const useModalHighlightPopoverState = () => {
    const articleContentRef = useRef<HTMLDivElement>(null);
    const [activeHighlightId, setActiveHighlightId] = useState<string | undefined>();
    const [highlightPopoverOpen, setHighlightPopoverOpen] = useState(false);
    const [highlightPopoverAnchorEl, setHighlightPopoverAnchorEl] = useState<
      HighlightAnchorElement | undefined
    >();
    const [highlightPopoverHighlight, setHighlightPopoverHighlight] = useState<
      LocalHighlight | undefined
    >();

    return {
      activeHighlightId,
      articleContentRef,
      highlightPopoverAnchorEl,
      highlightPopoverHighlight,
      highlightPopoverOpen,
      setActiveHighlightId,
      setHighlightPopoverAnchorEl,
      setHighlightPopoverHighlight,
      setHighlightPopoverOpen,
    };
  };

const useModalArticleNavigationState = () => {
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const progressTrackRef = useRef<HTMLDivElement>(null);
    const [articleScrollProgress, setArticleScrollProgress] = useState(0);
    const [wikiPanelOpen, setWikiPanelOpen] = useState(false);
    const [wikiPanelTab, setWikiPanelTab] = useState<"source" | "reporter">("source");

    return {
      articleScrollProgress,
      contentScrollRef,
      progressTrackRef,
      setArticleScrollProgress,
      setWikiPanelOpen,
      setWikiPanelTab,
      wikiPanelOpen,
      wikiPanelTab,
    };
  };

const useModalArticleQueries = ({
    article,
    services,
  }: Readonly<{ article: NewsArticle; services: ArticleDetailServices }>) => {
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

    return { articleCacheKey, articleLoading, fullArticleText, source, sourceLoading };
  };

interface ModalHighlightActionState {
  readonly highlights: ModalArticleState["highlights"];
  readonly setHighlightColor: ModalArticleState["setHighlightColor"];
  readonly setHighlights: ModalArticleState["setHighlights"];
  readonly setHighlightsHistory: ModalArticleState["setHighlightsHistory"];
  readonly setHighlightSyncStatus: ModalArticleState["setHighlightSyncStatus"];
  readonly setShowHighlights: ModalArticleState["setShowHighlights"];
  readonly setSidebarEditingId: ModalArticleState["setSidebarEditingId"];
  readonly setSidebarEditingNote: ModalArticleState["setSidebarEditingNote"];
}

interface ModalHighlightPopoverActionState {
  readonly articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly setActiveHighlightId: ModalArticleState["setActiveHighlightId"];
  readonly setHighlightPopoverAnchorEl: ModalArticleState["setHighlightPopoverAnchorEl"];
  readonly setHighlightPopoverHighlight: ModalArticleState["setHighlightPopoverHighlight"];
  readonly setHighlightPopoverOpen: ModalArticleState["setHighlightPopoverOpen"];
}

const useModalArticleActions = ({
    article,
    services,
    highlightState,
    popoverState,
  }: Readonly<{
    article: Readonly<NewsArticle>;
    services: ArticleDetailServices;
    highlightState: ModalHighlightActionState;
    popoverState: ModalHighlightPopoverActionState;
  }>) => {
    const history = useModalHighlightHistory({
      article,
      services,
      setHighlightSyncStatus: highlightState.setHighlightSyncStatus,
      setHighlights: highlightState.setHighlights,
      setHighlightsHistory: highlightState.setHighlightsHistory,
    });
    const highlightActions = useModalHighlightActions({
      article,
      articleContentRef: popoverState.articleContentRef,
      highlights: highlightState.highlights,
      runHighlightOperations: history.runHighlightOperations,
      setActiveHighlightId: popoverState.setActiveHighlightId,
      setHighlightColor: highlightState.setHighlightColor,
      setHighlightPopoverAnchorEl: popoverState.setHighlightPopoverAnchorEl,
      setHighlightPopoverHighlight: popoverState.setHighlightPopoverHighlight,
      setHighlightPopoverOpen: popoverState.setHighlightPopoverOpen,
      setShowHighlights: highlightState.setShowHighlights,
      updateHighlightsWithHistory: history.updateHighlightsWithHistory,
    });
    const editorActions = useModalHighlightEditorActions({
      handleSaveHighlightNote: highlightActions.handleSaveHighlightNote,
      setSidebarEditingId: highlightState.setSidebarEditingId,
      setSidebarEditingNote: highlightState.setSidebarEditingNote,
      updateHighlightByStableId: highlightActions.updateHighlightByStableId,
      updateHighlightsWithHistory: history.updateHighlightsWithHistory,
    });

    return { ...editorActions, ...highlightActions, ...history };
  };

const useModalArticleState = ({
    article,
    services,
    onNavigate,
  }: Readonly<{
    article: NewsArticle;
    services: ArticleDetailServices;
    onNavigate?: (direction: "prev" | "next") => void;
  }>): ModalArticleState => {
    const integrations = useModalIntegrationValues();
    const ui = useModalArticleUiState();
    const analysis = useModalArticleAnalysisState();
    const highlightState = useModalHighlightState();
    const popoverState = useModalHighlightPopoverState();
    const navigationState = useModalArticleNavigationState();
    const queries = useModalArticleQueries({ article, services });
    const actions = useModalArticleActions({
      article,
      highlightState,
      popoverState,
      services,
    });
    const handleNavigate = useCallback(
      (direction: "prev" | "next") => {
        onNavigate?.(direction);
      },
      [onNavigate],
    );

    return {
      ...actions,
      ...analysis,
      ...highlightState,
      ...integrations,
      ...navigationState,
      ...popoverState,
      ...queries,
      ...ui,
      handleNavigate,
    };
  };

type ModalArticleState = DeepReadonly<
  ReturnType<typeof useModalIntegrationValues> &
    ReturnType<typeof useModalArticleUiState> &
    ReturnType<typeof useModalArticleAnalysisState> &
    ReturnType<typeof useModalHighlightState> &
    ReturnType<typeof useModalHighlightPopoverState> &
    ReturnType<typeof useModalArticleNavigationState> &
    ReturnType<typeof useModalArticleQueries> &
    ReturnType<typeof useModalArticleActions> & {
      readonly handleNavigate: (direction: "prev" | "next") => void;
    }
>;

export { useArticleLanguageDiagnostics, useModalArticleState };
export type { ModalArticleState };
