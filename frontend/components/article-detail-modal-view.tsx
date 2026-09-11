"use client";

import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useEffect } from "react";

import type {
  ArticleDetailModalViewProps,
  ArticleScrollAction,
  FactCheckResult,
  ModalHighlightLoaderProps,
  NewsArticle,
} from "../lib/article-detail-modal-data";
import { loadModalHighlights } from "../lib/article-detail-modal-data";
import type { LocalHighlight } from "../lib/highlight-store";
import { ArticleDetailDialogBody } from "./article-detail-modal-layout";
import { isTextInputFocused } from "./article-detail-modal-reader";

interface ModalKeyboardEvent {
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly preventDefault: () => void;
  readonly stopImmediatePropagation: () => void;
  readonly stopPropagation: () => void;
}

interface ModalPointerEvent {
  readonly clientY: number;
  readonly preventDefault: () => void;
  readonly target: EventTarget | null;
}

interface ArticleScrollKeyListenerProps {
  readonly claimsOpen: boolean;
  readonly contentScrollRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly isExpanded: boolean;
  readonly isOpen: boolean;
  readonly onArticleNavigate: (direction: "prev" | "next") => void;
  readonly onNavigateArticle?: (direction: "prev" | "next") => void;
  readonly wikiPanelOpen: boolean;
}

interface ProgressPointerHandlerProps {
  readonly progressTrackRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly resolveProgressFromPointer: (clientY: number) => number | undefined;
  readonly scrollArticleContentToProgress: (nextProgress: number) => void;
}

interface ProgressPointerHandlers {
  readonly handlePointerDown: (event: ModalPointerEvent) => void;
  readonly handlePointerMove: (event: ModalPointerEvent) => void;
  readonly handlePointerUp: () => void;
}

interface ModalProgressPointerProps {
  readonly contentScrollRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly isOpen: boolean;
  readonly progressTrackRef: Readonly<{ current: HTMLDivElement | null }>;
}

const ARTICLE_SCROLL_FACTORS = new Map([
    ["ArrowDown", 0.12],
    ["ArrowUp", -0.12],
    ["PageDown", 0.9],
    ["PageUp", -0.9],
  ]),
  EMPTY_COUNT = 0,
  MINIMUM_SCROLL_DISTANCE = 72,
  PROGRESS_MAXIMUM = 1;

const getArticleNavigationAction = (
  key: string,
  isExpanded: boolean,
  onNavigate?: (direction: "prev" | "next") => void,
): ArticleScrollAction | undefined => {
  if (!isExpanded || !onNavigate) {
    return void 0;
  }
  if (key === "ArrowRight") {
    return { direction: "next", kind: "navigate" };
  }
  if (key === "ArrowLeft") {
    return { direction: "prev", kind: "navigate" };
  }
  return void 0;
};

const getArticleScrollAction = (
  key: string,
  height: number,
  isExpanded: boolean,
  onNavigate?: (direction: "prev" | "next") => void,
): ArticleScrollAction | undefined => {
  const factor = ARTICLE_SCROLL_FACTORS.get(key);
  if (factor !== undefined) {
    return {
      amount: Math.max(height * Math.abs(factor), MINIMUM_SCROLL_DISTANCE) * Math.sign(factor),
      kind: "scroll",
    };
  }
  return getArticleNavigationAction(key, isExpanded, onNavigate);
};

const getProgressFromPointer = (track: HTMLDivElement | null, clientY: number): number | undefined => {
  if (!track) {
    return void 0;
  }

  const rect = track.getBoundingClientRect();
  if (rect.height <= EMPTY_COUNT) {
    return void 0;
  }
  return (clientY - rect.top) / rect.height;
};

const scrollArticleContent = (container: HTMLDivElement | null, nextProgress: number): void => {
  if (!container) {
    return;
  }

  const clampedProgress = Math.min(PROGRESS_MAXIMUM, Math.max(EMPTY_COUNT, nextProgress));
  const maxScroll = Math.max(EMPTY_COUNT, container.scrollHeight - container.clientHeight);
  container.scrollTo({ behavior: "auto", top: maxScroll * clampedProgress });
};

const ArticleDetailModalView = (viewProps: DeepReadonly<ArticleDetailModalViewProps>) => {
  const { setHighlights } = viewProps;
  const setModalHighlights = useCallback(
    (highlights: readonly Readonly<LocalHighlight>[]): void => {
      setHighlights([...highlights]);
    },
    [setHighlights],
  );
  const handleNavigateArticle = viewProps.onNavigate;

  return (
    <>
      <ModalUndoShortcut onUndo={viewProps.handleUndo} />
      <ModalHighlightLoader
        articleUrl={viewProps.article.url}
        debugEnabled={viewProps.debugEnabled}
        services={viewProps.services}
        setHighlights={setModalHighlights}
        setStatus={viewProps.setHighlightSyncStatus}
      />
      <ModalReadingHistoryTracker article={viewProps.article} isOpen={viewProps.isOpen} markAsRead={viewProps.markAsRead} />
      <ModalProgressPointer contentScrollRef={viewProps.contentScrollRef} isOpen={viewProps.isOpen} progressTrackRef={viewProps.progressTrackRef} />
      <ModalClaimSelectionEffect
        claimsOpen={viewProps.claimsOpen}
        factCheckResults={viewProps.factCheckResults}
        selectedClaim={viewProps.selectedClaim}
        setSelectedClaim={viewProps.setSelectedClaim}
      />
      <ModalScrollProgressTracker
        contentScrollRef={viewProps.contentScrollRef}
        isOpen={viewProps.isOpen}
        setArticleScrollProgress={viewProps.setArticleScrollProgress}
      />
      <ArticleScrollKeyListener
        claimsOpen={viewProps.claimsOpen}
        contentScrollRef={viewProps.contentScrollRef}
        onArticleNavigate={viewProps.handleNavigate}
        isExpanded={viewProps.isExpanded}
        isOpen={viewProps.isOpen}
        onNavigateArticle={handleNavigateArticle}
        wikiPanelOpen={viewProps.wikiPanelOpen}
      />
      <ArticleDetailDialogBody {...viewProps} />
    </>
  );
};

const applyArticleScrollAction = (
  event: ModalKeyboardEvent,
  action: ArticleScrollAction,
  container: HTMLDivElement,
  onArticleNavigate: (direction: "prev" | "next") => void,
): void => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (action.kind === "scroll") {
    container.scrollBy({ behavior: "smooth", top: action.amount });
    return;
  }
  onArticleNavigate(action.direction);
};

const getArticleScrollKeyHandler = ({
  claimsOpen,
  contentScrollRef,
  isExpanded,
  onArticleNavigate,
  onNavigateArticle,
  wikiPanelOpen,
}: Readonly<Omit<ArticleScrollKeyListenerProps, "isOpen">>): ((event: ModalKeyboardEvent) => void) =>
  (event: ModalKeyboardEvent): void => {
    if (isTextInputFocused() || claimsOpen || wikiPanelOpen) {
      return;
    }
    const container = contentScrollRef.current;
    if (!container) {
      return;
    }
    const action = getArticleScrollAction(
      event.key,
      container.clientHeight,
      isExpanded,
      onNavigateArticle,
    );
    if (!action) {
      return;
    }
    applyArticleScrollAction(event, action, container, onArticleNavigate);
  };

const ArticleScrollKeyListener = ({
  claimsOpen,
  contentScrollRef,
  onArticleNavigate,
  isExpanded,
  isOpen,
  onNavigateArticle,
  wikiPanelOpen,
}: Readonly<ArticleScrollKeyListenerProps>): false => {
  useEffect(() => {
    if (!isOpen) {
      return () => {};
    }

    const handleKeyDown = getArticleScrollKeyHandler({
      claimsOpen,
      contentScrollRef,
      isExpanded,
      onArticleNavigate,
      onNavigateArticle,
      wikiPanelOpen,
    });
    globalThis.addEventListener("keydown", handleKeyDown, true);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    claimsOpen,
    contentScrollRef,
    isExpanded,
    isOpen,
    onArticleNavigate,
    onNavigateArticle,
    wikiPanelOpen,
  ]);
  return false;
};

const ModalClaimSelectionEffect = ({
  claimsOpen,
  factCheckResults,
  selectedClaim,
  setSelectedClaim,
}: Readonly<{
  readonly claimsOpen: boolean;
  readonly factCheckResults: readonly FactCheckResult[];
  readonly selectedClaim: FactCheckResult | undefined;
  readonly setSelectedClaim: (claim: FactCheckResult | undefined) => void;
}>): false => {
  useEffect(() => {
    if (!claimsOpen) {
      return;
    }

    if (factCheckResults.length === EMPTY_COUNT || selectedClaim === undefined) {
      setSelectedClaim(factCheckResults[EMPTY_COUNT]);
      return;
    }

    const stillPresent = factCheckResults.some((claim) => claim.claim === selectedClaim.claim);
    if (!stillPresent) {
      setSelectedClaim(factCheckResults[EMPTY_COUNT]);
    }
  }, [claimsOpen, factCheckResults, selectedClaim, setSelectedClaim]);

  return false;
};

const ModalHighlightLoader = ({
  articleUrl,
  debugEnabled,
  services,
  setHighlights,
  setStatus,
}: Readonly<ModalHighlightLoaderProps>): false => {
  useEffect(() => {
    if (!articleUrl) {
      setHighlights([]);
      setStatus("idle");
      return;
    }

    loadModalHighlights({ articleUrl, debugEnabled, services, setHighlights, setStatus });
  }, [articleUrl, debugEnabled, services, setHighlights, setStatus]);

  return false;
};

const createProgressPointerHandlers = ({
  progressTrackRef,
  resolveProgressFromPointer,
  scrollArticleContentToProgress,
}: Readonly<ProgressPointerHandlerProps>): ProgressPointerHandlers => {
  const updateProgress = (clientY: number): void => {
    const nextProgress = resolveProgressFromPointer(clientY);
    if (nextProgress !== undefined) {
      scrollArticleContentToProgress(nextProgress);
    }
  };
  const handlePointerMove = (event: ModalPointerEvent): void => {
    updateProgress(event.clientY);
  };
  const handlePointerUp = (): void => {
    globalThis.removeEventListener("pointermove", handlePointerMove);
    globalThis.removeEventListener("pointerup", handlePointerUp);
  };
  const handlePointerDown = (event: ModalPointerEvent): void => {
    const track = progressTrackRef.current;
    const target = event.target;
    if (!track || !(target instanceof Node) || !track.contains(target)) {
      return;
    }

    event.preventDefault();
    updateProgress(event.clientY);
    globalThis.addEventListener("pointermove", handlePointerMove);
    globalThis.addEventListener("pointerup", handlePointerUp);
  };
  return { handlePointerDown, handlePointerMove, handlePointerUp };
};

const ModalProgressPointer = ({
  contentScrollRef,
  isOpen,
  progressTrackRef,
}: Readonly<ModalProgressPointerProps>): false => {
  const resolveProgressFromPointer = useCallback(
    (clientY: number): number | undefined => getProgressFromPointer(progressTrackRef.current, clientY),
    [progressTrackRef],
  );
  const scrollArticleContentToProgress = useCallback(
    (nextProgress: number): void => {
      scrollArticleContent(contentScrollRef.current, nextProgress);
    },
    [contentScrollRef],
  );

  useEffect(() => {
    if (!isOpen) {
      return () => {};
    }

    const handlers = createProgressPointerHandlers({
      progressTrackRef,
      resolveProgressFromPointer,
      scrollArticleContentToProgress,
    });
    globalThis.addEventListener("pointerdown", handlers.handlePointerDown);
    return () => {
      globalThis.removeEventListener("pointerdown", handlers.handlePointerDown);
      globalThis.removeEventListener("pointermove", handlers.handlePointerMove);
      globalThis.removeEventListener("pointerup", handlers.handlePointerUp);
    };
  }, [
    isOpen,
    progressTrackRef,
    resolveProgressFromPointer,
    scrollArticleContentToProgress,
  ]);

  return false;
};

const ModalReadingHistoryTracker = ({
  article,
  isOpen,
  markAsRead,
}: Readonly<{
  readonly article: NewsArticle;
  readonly isOpen: boolean;
  readonly markAsRead: (articleId: number, title: string, source: string) => void;
}>): false => {
  useEffect(() => {
    if (isOpen) {
      markAsRead(article.id, article.title, article.source);
    }
  }, [article, isOpen, markAsRead]);

  return false;
};

const ModalScrollProgressTracker = ({
  contentScrollRef,
  isOpen,
  setArticleScrollProgress,
}: Readonly<{
  readonly contentScrollRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly isOpen: boolean;
  readonly setArticleScrollProgress: (progress: number) => void;
}>): false => {
  useEffect(() => {
    const container = contentScrollRef.current;
    if (!container || !isOpen) {
      return () => {};
    }

    const updateProgress = (): void => {
      const maxScroll = Math.max(EMPTY_COUNT, container.scrollHeight - container.clientHeight);
      if (maxScroll === EMPTY_COUNT) {
        setArticleScrollProgress(EMPTY_COUNT);
        return;
      }
      setArticleScrollProgress(Math.min(PROGRESS_MAXIMUM, container.scrollTop / maxScroll));
    };

    updateProgress();
    container.addEventListener("scroll", updateProgress, { passive: true });
    globalThis.addEventListener("resize", updateProgress);

    return () => {
      container.removeEventListener("scroll", updateProgress);
      globalThis.removeEventListener("resize", updateProgress);
    };
  }, [contentScrollRef, isOpen, setArticleScrollProgress]);

  return false;
};

const ModalUndoShortcut = ({ onUndo }: Readonly<{ readonly onUndo: () => void }>): false => {
  useEffect(() => {
    const handleGlobalKeyDown = (event: ModalKeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "z" && !isTextInputFocused()) {
        event.preventDefault();
        onUndo();
      }
    };
    globalThis.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [onUndo]);

  return false;
};

export { ArticleDetailModalView };
