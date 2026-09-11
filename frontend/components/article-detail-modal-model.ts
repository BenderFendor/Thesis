"use client";

import { useCallback } from "react";
import type {
  ArticleAnalysis,
  ArticleDetailModalProps,
  ArticleDetailModalViewProps,
  ArticleDetailServices,
  FactCheckResult,
  FactCheckStatusFilter,
  LocalHighlight,
  NewsArticle,
} from "../lib/article-detail-modal-data";
import {
  getArticleDetailAnalysisState,
  getArticleDetailArticleState,
  getArticleObsidianMarkdown,
  getHighlightDebugEnabled,
  getVisibleRemoteHighlights,
  loadAiAnalysisData,
  loadDebugData,
  openModalWikiPanel,
  runAgenticSearchData,
  toggleArticleBookmark,
  toggleArticleFavorite,
  toggleArticleLike,
  toggleArticleQueue,
  toggleDebugPanel,
  updateClaimsDialog,
} from "./article-detail-modal-operations";
import { useArticleLanguageDiagnostics } from "./article-detail-modal-logic";
import type { ModalArticleState } from "./article-detail-modal-logic";

type ModalAnalysisState = Readonly<
  Pick<
    ModalArticleState,
    | "setAiAnalysis"
    | "setAiAnalysisLoading"
    | "setAiAnalysisRequested"
    | "setAgenticAnswer"
    | "setAgenticError"
    | "setAgenticHistory"
    | "setAgenticLoading"
  >
>;
interface ModalDebugState {
  readonly contentScrollRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly debugOpen: ModalArticleState["debugOpen"];
  readonly setDebugData: ModalArticleState["setDebugData"];
  readonly setDebugLoading: ModalArticleState["setDebugLoading"];
  readonly setDebugOpen: ModalArticleState["setDebugOpen"];
  readonly setMatchedEntryIndex: ModalArticleState["setMatchedEntryIndex"];
}
type ModalLibraryState = Readonly<
  Pick<
    ModalArticleState,
    | "addArticleToQueue"
    | "isArticleInQueue"
    | "isBookmarked"
    | "removeArticleFromQueue"
    | "setBookmarkLoading"
    | "toggleBookmark"
    | "toggleFavorite"
    | "toggleLike"
  >
>;
type ModalWikiState = Readonly<Pick<ModalArticleState, "setWikiPanelOpen" | "setWikiPanelTab">>;
type ModalClaimState = Readonly<
  Pick<
    ModalArticleState,
    | "selectedClaim"
    | "setActiveStatusFilter"
    | "setAgenticAnswer"
    | "setAgenticError"
    | "setClaimsOpen"
    | "setSelectedClaim"
  >
>;
type ModalDialogState = Readonly<
  Pick<ModalArticleState, "setHighlightPopoverOpen" | "setIsExpanded" | "setShowSourceDetails">
>;
interface ModalHighlightState {
  readonly handleCancelEdit: ModalArticleState["handleCancelEdit"];
  readonly handleColorSelect: ModalArticleState["handleColorSelect"];
  readonly handleHighlightClick: ModalArticleState["handleHighlightClick"];
  readonly handleHighlightDelete: ModalArticleState["handleHighlightDelete"];
  readonly handleRetrySync: ModalArticleState["handleRetrySync"];
  readonly handleSaveHighlightNote: ModalArticleState["handleSaveHighlightNote"];
  readonly handleSaveNote: ModalArticleState["handleSaveNote"];
  readonly handleStartEdit: ModalArticleState["handleStartEdit"];
  readonly handleToolbarCreate: ModalArticleState["handleToolbarCreate"];
  readonly handleToolbarDelete: ModalArticleState["handleToolbarDelete"];
  readonly handleToolbarUpdate: ModalArticleState["handleToolbarUpdate"];
  readonly handleToggleShowHighlights: ModalArticleState["handleToggleShowHighlights"];
  readonly setActiveStatusFilter: ModalArticleState["setActiveStatusFilter"];
  readonly setSidebarEditingNote: ModalArticleState["setSidebarEditingNote"];
  readonly sidebarEditingId: ModalArticleState["sidebarEditingId"];
  readonly sidebarEditingNote: ModalArticleState["sidebarEditingNote"];
}

const useModalContentData = ({
  activeStatusFilter,
  aiAnalysis,
  aiAnalysisLoading,
  aiAnalysisRequested,
  article,
  fullArticleText,
  highlights,
  isOpen,
  services,
}: Readonly<{
  readonly activeStatusFilter: FactCheckStatusFilter;
  readonly aiAnalysis: ArticleAnalysis | undefined;
  readonly aiAnalysisLoading: boolean;
  readonly aiAnalysisRequested: boolean;
  readonly article: NewsArticle;
  readonly fullArticleText: string | undefined;
  readonly highlights: readonly LocalHighlight[];
  readonly isOpen: boolean;
  readonly services: Readonly<ArticleDetailServices>;
}>) => {
  const articleState = getArticleDetailArticleState(article, fullArticleText);
  const diagnostics = useArticleLanguageDiagnostics({
    aiAnalysis,
    article,
    articleTextForMetrics: articleState.articleTextForMetrics,
    isOpen,
    services,
    wordCount: articleState.wordCount,
  });
  const visibleHighlights = getVisibleRemoteHighlights(highlights);

  return {
    ...getArticleDetailAnalysisState(
      aiAnalysis,
      aiAnalysisLoading,
      aiAnalysisRequested,
      activeStatusFilter,
    ),
    ...articleState,
    ...diagnostics,
    canPersistArticle: article.isPersisted !== false,
    obsidianMarkdown: getArticleObsidianMarkdown(
      article,
      fullArticleText,
      articleState.reporterName,
      visibleHighlights,
    ),
    visibleHighlights,
  };
};

const useModalAnalysisActions = ({
  article,
  services,
  state,
}: Readonly<{
  readonly article: NewsArticle;
  readonly services: Readonly<ArticleDetailServices>;
  readonly state: ModalAnalysisState;
}>) => {
  const loadAiAnalysis = () =>
    loadAiAnalysisData({
      article,
      services,
      setAiAnalysis: state.setAiAnalysis,
      setAiAnalysisLoading: state.setAiAnalysisLoading,
      setAiAnalysisRequested: state.setAiAnalysisRequested,
    });
  const onAiAnalysis = () => {
    void loadAiAnalysis();
  };
  const onRunAgenticSearch = (claim: FactCheckResult | undefined) =>
    runAgenticSearchData({
      article,
      claim,
      services,
      setAgenticAnswer: state.setAgenticAnswer,
      setAgenticError: state.setAgenticError,
      setAgenticHistory: state.setAgenticHistory,
      setAgenticLoading: state.setAgenticLoading,
    });

  return { onAiAnalysis, onRunAgenticSearch };
};

const useModalDebugActions = ({
  article,
  services,
  state,
}: Readonly<{
  readonly article: NewsArticle;
  readonly services: Readonly<ArticleDetailServices>;
  readonly state: ModalDebugState;
}>) => {
  const loadDebug = () =>
    loadDebugData({
      article,
      services,
      setDebugData: state.setDebugData,
      setDebugLoading: state.setDebugLoading,
      setMatchedEntryIndex: state.setMatchedEntryIndex,
    });
  const onBackToTop = () => {
    state.contentScrollRef.current?.scrollTo({ behavior: "smooth", top: 0 });
  };
  const onToggleDebug = () => {
    toggleDebugPanel({
      isOpen: state.debugOpen,
      loadDebug: () => {
        void loadDebug();
      },
      setOpen: state.setDebugOpen,
    });
  };

  return { onBackToTop, onToggleDebug };
};

const useModalLibraryActions = ({
  article,
  onBookmarkChange,
  state,
}: Readonly<{
  readonly article: NewsArticle;
  readonly onBookmarkChange?: ArticleDetailModalProps["onBookmarkChange"];
  readonly state: ModalLibraryState;
}>) => {
  const onLike = () => {
    void toggleArticleLike(article, state.toggleLike);
  };
  const onBookmark = () => {
    void toggleArticleBookmark({
      article,
      isBookmarked: state.isBookmarked,
      onBookmarkChange,
      setBookmarkLoading: state.setBookmarkLoading,
      toggleBookmark: state.toggleBookmark,
    });
  };
  const onFavorite = () => {
    toggleArticleFavorite(article, state.toggleFavorite);
  };
  const onQueueToggle = () => {
    toggleArticleQueue({
      addArticleToQueue: (queuedArticle) => {
        void state.addArticleToQueue(queuedArticle);
      },
      article,
      isArticleInQueue: state.isArticleInQueue,
      removeArticleFromQueue: (articleUrl) => {
        void state.removeArticleFromQueue(articleUrl);
      },
    });
  };

  return { onBookmark, onFavorite, onLike, onQueueToggle };
};

const useModalWikiActions = ({
  hasReporterWiki,
  hasSourceWiki,
  state,
}: Readonly<{
  readonly hasReporterWiki: boolean;
  readonly hasSourceWiki: boolean;
  readonly state: ModalWikiState;
}>) => {
  const onOpenSourceWiki = () => {
    openModalWikiPanel({
      available: hasSourceWiki,
      setOpen: state.setWikiPanelOpen,
      setTab: state.setWikiPanelTab,
      tab: "source",
    });
  };
  const onOpenReporterWiki = () => {
    openModalWikiPanel({
      available: hasReporterWiki,
      setOpen: state.setWikiPanelOpen,
      setTab: state.setWikiPanelTab,
      tab: "reporter",
    });
  };

  return { onOpenReporterWiki, onOpenSourceWiki };
};

const useModalClaimActions = ({
  factCheckResults,
  state,
}: Readonly<{
  readonly factCheckResults: readonly FactCheckResult[];
  readonly state: ModalClaimState;
}>) => {
  const onClaimsOpenChange = (open: boolean) => {
    updateClaimsDialog({
      factCheckResults,
      open,
      selectedClaim: state.selectedClaim,
      setActiveStatusFilter: state.setActiveStatusFilter,
      setAgenticAnswer: state.setAgenticAnswer,
      setAgenticError: state.setAgenticError,
      setClaimsOpen: state.setClaimsOpen,
      setSelectedClaim: state.setSelectedClaim,
    });
  };
  const onSelectClaim = (claim: FactCheckResult) => {
    state.setSelectedClaim(claim);
    state.setAgenticAnswer(undefined);
    state.setAgenticError(undefined);
  };

  return { onClaimsOpenChange, onSelectClaim };
};

const useModalDialogActions = ({
  onClose,
  state,
}: Readonly<{
  readonly onClose: () => void;
  readonly state: ModalDialogState;
}>) => {
  const setHighlightPopoverOpen = state.setHighlightPopoverOpen;
  const setIsExpanded = state.setIsExpanded;
  const setShowSourceDetails = state.setShowSourceDetails;
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
  const onRelatedArticleClick = useCallback((relatedArticle: Readonly<{ url: string }>) => {
    globalThis.open(relatedArticle.url, "_blank", "noopener,noreferrer");
  }, []);
  const onToggleExpanded = useCallback(() => {
    setIsExpanded((expanded) => !expanded);
  }, [setIsExpanded]);
  const onToggleSourceDetails = useCallback(() => {
    setShowSourceDetails((visible) => !visible);
  }, [setShowSourceDetails]);

  return {
    onCloseHighlightPopover,
    onDialogOpenChange,
    onRelatedArticleClick,
    onToggleExpanded,
    onToggleSourceDetails,
  };
};

const useModalContentActions = ({
  analysisState,
  article,
  claimState,
  debugState,
  dialogState,
  factCheckResults,
  hasReporterWiki,
  hasSourceWiki,
  libraryState,
  onBookmarkChange,
  onClose,
  services,
  wikiState,
}: Readonly<{
  readonly analysisState: ModalAnalysisState;
  readonly article: NewsArticle;
  readonly claimState: ModalClaimState;
  readonly debugState: ModalDebugState;
  readonly dialogState: ModalDialogState;
  readonly factCheckResults: readonly FactCheckResult[];
  readonly hasReporterWiki: boolean;
  readonly hasSourceWiki: boolean;
  readonly libraryState: ModalLibraryState;
  readonly onBookmarkChange?: ArticleDetailModalProps["onBookmarkChange"];
  readonly onClose: () => void;
  readonly services: Readonly<ArticleDetailServices>;
  readonly wikiState: ModalWikiState;
}>) => {
  const analysisActions = useModalAnalysisActions({ article, services, state: analysisState });
  const debugActions = useModalDebugActions({ article, services, state: debugState });
  const libraryActions = useModalLibraryActions({ article, onBookmarkChange, state: libraryState });
  const wikiActions = useModalWikiActions({ hasReporterWiki, hasSourceWiki, state: wikiState });
  const claimActions = useModalClaimActions({ factCheckResults, state: claimState });
  const dialogActions = useModalDialogActions({ onClose, state: dialogState });

  return {
    actions: libraryActions,
    analysisActions,
    claimActions,
    debugActions,
    dialogActions,
    wikiActions,
  };
};

const getModalHighlightProps = (state: ModalHighlightState) => ({
  editingId: state.sidebarEditingId,
  editingNote: state.sidebarEditingNote,
  onCancelEdit: state.handleCancelEdit,
  onColorSelect: state.handleColorSelect,
  onCreate: state.handleToolbarCreate,
  onDelete: state.handleToolbarDelete,
  onFilterChange: state.setActiveStatusFilter,
  onHighlightClick: state.handleHighlightClick,
  onHighlightDelete: state.handleHighlightDelete,
  onNoteChange: state.setSidebarEditingNote,
  onRetrySync: state.handleRetrySync,
  onSaveHighlightNote: state.handleSaveHighlightNote,
  onSaveNote: (stableId: string, note: string) => {
    void state.handleSaveNote(stableId, note);
  },
  onStartEdit: state.handleStartEdit,
  onToggleShowHighlights: state.handleToggleShowHighlights,
  onUpdate: state.handleToolbarUpdate,
});

type ModalContentData = Readonly<
  Pick<
    ArticleDetailModalViewProps,
    | "aiActionLabel"
    | "aiHasError"
    | "articleHost"
    | "articleWikiContext"
    | "canPersistArticle"
    | "canRequestAiAnalysis"
    | "factCheckResults"
    | "filteredClaims"
    | "estimatedReadMinutes"
    | "hasReporterWiki"
    | "hasSourceWiki"
    | "languageDiagnostics"
    | "languageDiagnosticsError"
    | "languageDiagnosticsLoading"
    | "obsidianMarkdown"
    | "reporterName"
    | "showSummary"
    | "statusCounts"
    | "visibleHighlights"
    | "wordCount"
  >
>;

const createArticleDetailModalViewProps = (
  input: Readonly<{
    readonly actions: Readonly<ReturnType<typeof useModalLibraryActions>>;
    readonly analysisActions: Readonly<ReturnType<typeof useModalAnalysisActions>>;
    readonly article: Readonly<NewsArticle>;
    readonly claimActions: Readonly<ReturnType<typeof useModalClaimActions>>;
    readonly data: ModalContentData;
    readonly debugActions: Readonly<ReturnType<typeof useModalDebugActions>>;
    readonly dialogActions: Readonly<ReturnType<typeof useModalDialogActions>>;
    readonly isOpen: boolean;
    readonly layoutIdPrefix?: string;
    readonly onClose: () => void;
    readonly onNavigate?: (direction: "prev" | "next") => void;
    readonly services: Readonly<ArticleDetailServices>;
    readonly state: Readonly<ModalArticleState>;
    readonly wikiActions: Readonly<ReturnType<typeof useModalWikiActions>>;
  }>,
): ArticleDetailModalViewProps => ({
  ...input.state,
  ...input.data,
  ...input.actions,
  ...input.analysisActions,
  ...input.debugActions,
  ...input.dialogActions,
  ...input.wikiActions,
  article: input.article,
  currentArticle: input.article,
  debugEnabled: getHighlightDebugEnabled(),
  ...getModalHighlightProps(input.state),
  isOpen: input.isOpen,
  layoutIdPrefix: input.layoutIdPrefix,
  onClaimsOpenChange: input.claimActions.onClaimsOpenChange,
  onClose: input.onClose,
  onNavigate: input.onNavigate,
  onSelectClaim: input.claimActions.onSelectClaim,
  services: input.services,
  source: input.state.source ?? undefined,
});

export {
  createArticleDetailModalViewProps,
  useModalAnalysisActions,
  useModalClaimActions,
  useModalContentActions,
  useModalContentData,
  useModalDebugActions,
  useModalDialogActions,
  useModalLibraryActions,
  useModalWikiActions,
};
