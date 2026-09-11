"use client";

import type {
QueueAnalysisView,
QueueSourceDebugView,
QueueSourceView,
} from "@/components/reading-queue-article-detail";
import { Sheet,SheetContent,SheetDescription,SheetTrigger } from "@/components/ui/sheet";
import { useCallback,useEffect,useMemo,useState } from "react";
import { useReadingQueueContext,useReadingQueueQueries } from "@/components/reading-queue-queries";
import { ArticleDetailView } from "@/components/reading-queue-article-detail";
import { Button } from "@/components/ui/button";
import { List } from "lucide-react";
import type { NewsArticle } from "@/lib/api";
import { QueueDigestView } from "@/components/reading-queue-digest";
import { QueueListView } from "@/components/reading-queue-list";
import type { ReactElement } from "react";
import { calculateReadTime } from "@/lib/reading-queue-content";

const NO_ARTICLE_INDEX = -1;
const ZERO = 0;
const MARK_AS_READ_KEY = "m";
type DigestDirection = "next" | "previous";
const ARTICLE_DIRECTION_OFFSETS = { next: 1, previous: -1 } as const;

const getSheetContentClassName = (selectedArticle: NewsArticle | undefined): string => {
  if (selectedArticle === undefined) {
    return "bg-[var(--news-bg-primary)] max-w-full w-[540px]";
  }
  return "bg-[var(--news-bg-primary)] max-w-[70vw] w-[70vw]";
};
const READING_HISTORY_LIMIT = 50;

const getArticleIdState = (
  article: Readonly<{ readonly id: number }> | undefined,
  getState: (articleId: number) => boolean,
): boolean => article?.id !== undefined && article.id !== ZERO && getState(article.id);

type QueueContext = Readonly<ReturnType<typeof useReadingQueueContext>>;

interface QueueKeyEvent {
  readonly key: string;
  readonly preventDefault: () => void;
}

const useQueueSelectionState = (
  queuedArticles: readonly NewsArticle[],
) => {
  const [expandedIndex, setExpandedIndex] = useState<number | undefined>();
  const [selectedArticleUrl, setSelectedArticleUrl] = useState<string>();
  const [readArticles, setReadArticles] = useState<ReadonlySet<string>>(() => new Set<string>());
  const { selectedArticle, selectedArticleIndex } = useMemo(() => {
    const index = queuedArticles.findIndex((article) => article.url === selectedArticleUrl);
    if (index === NO_ARTICLE_INDEX) {
      return { selectedArticle: undefined, selectedArticleIndex: index };
    }
    return { selectedArticle: queuedArticles[index], selectedArticleIndex: index };
  }, [queuedArticles, selectedArticleUrl]);
  const handleOpenArticle = useCallback((url: string): void => {
    setSelectedArticleUrl(url);
  }, []);
  return {
    expandedIndex,
    handleOpenArticle,
    readArticles,
    selectedArticle,
    selectedArticleIndex,
    selectedArticleUrl,
    setExpandedIndex,
    setReadArticles,
    setSelectedArticleUrl,
  };
};

const useQueuePanelState = () => {
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [showQueueOverview, setShowQueueOverview] = useState(false);
  const [embedModalArticle, setEmbedModalArticle] = useState<NewsArticle>();
  return {
    debugOpen,
    embedModalArticle,
    setDebugOpen,
    setEmbedModalArticle,
    setShowQueueOverview,
    setShowSourceDetails,
    showQueueOverview,
    showSourceDetails,
  };
};

type QueueSelectionState = ReturnType<typeof useQueueSelectionState>;
type QueuePanelState = ReturnType<typeof useQueuePanelState>;

const getAdjacentArticle = (
  queuedArticles: readonly NewsArticle[],
  selectedArticleUrl: string | undefined,
  direction: DigestDirection,
): NewsArticle | null => {
  if (selectedArticleUrl === undefined) {
    return null;
  }
  const currentIndex = queuedArticles.findIndex((article) => article.url === selectedArticleUrl);
  if (currentIndex === NO_ARTICLE_INDEX) {
    return null;
  }
  const nextIndex = Math.max(
    ZERO,
    Math.min(currentIndex + ARTICLE_DIRECTION_OFFSETS[direction], queuedArticles.length - 1),
  );
  if (nextIndex === currentIndex) {
    return null;
  }
  return queuedArticles[nextIndex] ?? null;
};

const handleQueueKeyDown = (
  event: Readonly<QueueKeyEvent>,
  selectedArticle: NewsArticle | undefined,
  navigate: (direction: DigestDirection) => void,
  markAsRead: (articleUrl: string) => void,
  closeArticle: () => void,
): void => {
  if (selectedArticle === undefined) {
    return;
  }
  const actionByKey = {
    ArrowLeft: () => {
      navigate("previous");
    },
    ArrowRight: () => {
      navigate("next");
    },
    Escape: closeArticle,
    [MARK_AS_READ_KEY]: () => {
      markAsRead(selectedArticle.url);
    },
  } satisfies Readonly<Record<string, () => void>>;
  const action = Object.entries(actionByKey).find(([key]) => key === event.key)?.[1];
  if (action === undefined) {
    return;
  }
  event.preventDefault();
  action();
};

const useQueueArticleActions = (
  removeArticleFromQueue: QueueContext["removeArticleFromQueue"],
  selection: Readonly<QueueSelectionState>,
) => {
  const { selectedArticle, setReadArticles, setSelectedArticleUrl } = selection;
  const handleMarkAsRead = useCallback((articleUrl: string): void => {
    setReadArticles((previous) => new Set(previous).add(articleUrl));
  }, [setReadArticles]);
  const handleMarkSelected = useCallback((): void => {
    if (selectedArticle !== undefined) {
      handleMarkAsRead(selectedArticle.url);
    }
  }, [handleMarkAsRead, selectedArticle]);
  const handleRemoveArticle = useCallback(
    (articleUrl: string): void => {
      void removeArticleFromQueue(articleUrl);
    },
    [removeArticleFromQueue],
  );
  const handleRemoveSelected = useCallback((): void => {
    if (selectedArticle !== undefined) {
      handleRemoveArticle(selectedArticle.url);
      setSelectedArticleUrl(undefined);
    }
  }, [handleRemoveArticle, selectedArticle, setSelectedArticleUrl]);
  return { handleMarkAsRead, handleMarkSelected, handleRemoveArticle, handleRemoveSelected };
};

type QueueReactionContext = Pick<
  QueueContext,
  "toggleBookmark" | "toggleFavorite" | "toggleLike"
>;

const useQueueReactionActions = (
  reactionContext: QueueReactionContext,
  selectedArticle: NewsArticle | undefined,
) => {
  const { toggleBookmark, toggleFavorite, toggleLike } = reactionContext;
  const handleBookmark = useCallback((): void => {
    const article = selectedArticle;
    if (article === undefined || article.id === ZERO) {
      return;
    }
    void toggleBookmark(article.id);
  }, [selectedArticle, toggleBookmark]);
  const handleFavorite = useCallback((): void => {
    const article = selectedArticle;
    if (article !== undefined) {
      toggleFavorite(article.sourceId);
    }
  }, [selectedArticle, toggleFavorite]);
  const handleLike = useCallback((): void => {
    const article = selectedArticle;
    if (article === undefined || article.id === ZERO) {
      return;
    }
    void toggleLike(article.id);
  }, [selectedArticle, toggleLike]);
  return { handleBookmark, handleFavorite, handleLike };
};

const useQueueNavigationHandlers = (
  queuedArticles: readonly NewsArticle[],
  selection: Readonly<QueueSelectionState>,
  handleMarkAsRead: (articleUrl: string) => void,
  closeArticle: () => void,
) => {
  const { selectedArticle, selectedArticleUrl, setSelectedArticleUrl } = selection;
  const handleNavigateArticle = useCallback(
    (direction: DigestDirection): void => {
      const nextArticle = getAdjacentArticle(
        queuedArticles,
        selectedArticleUrl,
        direction,
      );
      if (nextArticle !== null) {
        setSelectedArticleUrl(nextArticle.url);
      }
    },
    [queuedArticles, selectedArticleUrl, setSelectedArticleUrl],
  );
  const handleNext = useCallback((): void => {
    handleNavigateArticle("next");
  }, [handleNavigateArticle]);
  const handlePrevious = useCallback((): void => {
    handleNavigateArticle("previous");
  }, [handleNavigateArticle]);
  useEffect(() => {
    const handleKeyDown = (event: QueueKeyEvent): void => {
      handleQueueKeyDown(
        event,
        selectedArticle,
        handleNavigateArticle,
        handleMarkAsRead,
        closeArticle,
      );
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeArticle, handleMarkAsRead, handleNavigateArticle, selectedArticle]);
  return { handleNavigateArticle, handleNext, handlePrevious };
};

const useQueueDisplayActions = (
  selection: Readonly<QueueSelectionState>,
  panel: Readonly<QueuePanelState>,
  queuedArticleCount: number,
  generateDigest: () => void,
) => {
  const { expandedIndex, setExpandedIndex, setSelectedArticleUrl } = selection,
    { setDebugOpen, setEmbedModalArticle, setShowQueueOverview, setShowSourceDetails } = panel;
  return useMemo(
    () => ({
      handleCloseArticle: (): void => { setSelectedArticleUrl(undefined); },
      handleCloseEmbedded: (): void => { setEmbedModalArticle(undefined); },
      handleCloseOverview: (): void => { setShowQueueOverview(false); },
      handleOpenDigest: (): void => {
        setShowQueueOverview(true);
        if (queuedArticleCount > ZERO) {
          generateDigest();
        }
      },
      handleOpenEmbeddedArticle: setEmbedModalArticle,
      handleToggleArticle: (index: number): void => {
        if (expandedIndex === index) {
          setExpandedIndex(undefined);
          return;
        }
        setExpandedIndex(index);
      },
      handleToggleDebug: (): void => { setDebugOpen((previous) => !previous); },
      handleToggleSourceDetails: (): void => { setShowSourceDetails((previous) => !previous); },
    }),
    [expandedIndex, generateDigest, queuedArticleCount, setDebugOpen, setEmbedModalArticle,
      setExpandedIndex, setSelectedArticleUrl, setShowQueueOverview, setShowSourceDetails],
  );
};

const getEstimatedReadTimes = (
  queuedArticles: readonly NewsArticle[],
  selectedArticle: NewsArticle | undefined,
  fullArticleText: string | undefined,
) => {
  const readTimes = new Map<string, number>();
  for (const article of queuedArticles) {
    const { _queueData: queueData } = article;
    const fullText = queueData?.fullText;
    if (fullText !== undefined && fullText !== "") {
      readTimes.set(article.url, calculateReadTime(fullText));
    }
  }
  if (selectedArticle !== undefined && fullArticleText !== undefined && fullArticleText !== "") {
    readTimes.set(selectedArticle.url, calculateReadTime(fullArticleText));
  }
  return Object.fromEntries(readTimes);
};

const useReadingQueueController = () => {
  const context = useReadingQueueContext(),
    { queuedArticles } = context;
  const selection = useQueueSelectionState(queuedArticles);
  const panel = useQueuePanelState();
  const query = useReadingQueueQueries(selection.selectedArticle, panel.debugOpen, queuedArticles);
  const estimatedReadTimes = useMemo(() => getEstimatedReadTimes(queuedArticles, selection.selectedArticle, query.fullArticleText), [queuedArticles, query.fullArticleText, selection.selectedArticle]);
  const articleActions = useQueueArticleActions(context.removeArticleFromQueue, selection),
    reactionActions = useQueueReactionActions(context, selection.selectedArticle);
  const displayActions = useQueueDisplayActions(selection, panel, queuedArticles.length, query.generateDigest),
    navigationActions = useQueueNavigationHandlers(queuedArticles, selection, articleActions.handleMarkAsRead, displayActions.handleCloseArticle);
  return {
    ...displayActions,
    ...navigationActions,
    ...query,
    ...reactionActions,
    ...context,
    ...panel,
    ...selection,
    ...articleActions,
    estimatedReadTimes,
    handleMarkRead: articleActions.handleMarkSelected,
    readingHistoryIds: context.getRecentIds(READING_HISTORY_LIMIT),
  } as const;
};

type ReadingQueueController = Readonly<
  Omit<
    ReturnType<typeof useReadingQueueController>,
    "aiAnalysis" | "debugData" | "estimatedReadTimes" | "queuedArticles" | "readingHistoryIds" | "source"
  >
> & {
  readonly aiAnalysis?: QueueAnalysisView;
  readonly debugData?: QueueSourceDebugView;
  readonly estimatedReadTimes: Readonly<Record<string, number>>;
  readonly queuedArticles: readonly NewsArticle[];
  readonly readingHistoryIds: readonly number[];
  readonly source?: QueueSourceView;
};

interface QueueTriggerButtonProps {
  readonly "aria-controls"?: string;
  readonly "aria-expanded"?: boolean;
  readonly "aria-haspopup"?: "dialog";
  readonly isLoaded: boolean;
  readonly onClick?: React.MouseEventHandler<HTMLButtonElement>;
  readonly queuedArticleCount: number;
  readonly type?: "button" | "reset" | "submit";
  readonly "data-state"?: string;
}

const QueueTriggerButton = ({
  "aria-controls": ariaControls,
  "aria-expanded": ariaExpanded,
  "aria-haspopup": ariaHaspopup,
  "data-state": dataState,
  isLoaded,
  onClick,
  queuedArticleCount,
  type,
}: QueueTriggerButtonProps): ReactElement => (
  <Button
    aria-controls={ariaControls}
    aria-expanded={ariaExpanded}
    aria-haspopup={ariaHaspopup}
    data-state={dataState}
    onClick={onClick}
    type={type}
    variant="outline"
    size="icon"
    className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg transition-shadow hover:shadow-xl"
    aria-label="Open reading queue"
  >
    <List className="h-6 w-6 text-primary-foreground" />
    {isLoaded && queuedArticleCount > ZERO && (
      <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-semibold">
        {queuedArticleCount}
      </span>
    )}
  </Button>
);

const getArticleDetails = ({
  controller,
  selectedArticle,
}: Readonly<{
  readonly controller: ReadingQueueController;
  readonly selectedArticle: NewsArticle;
}>) => ({
  aiAnalysis: controller.aiAnalysis,
  aiAnalysisLoading: controller.aiAnalysisLoading,
  article: selectedArticle,
  articleLoading: controller.articleLoading,
  count: controller.queuedArticles.length,
  debugData: controller.debugData,
  debugLoading: controller.debugLoading,
  debugOpen: controller.debugOpen,
  fullArticleText: controller.fullArticleText,
  handleBookmark: controller.handleBookmark,
  handleClose: controller.handleCloseArticle,
  handleFavorite: controller.handleFavorite,
  handleLike: controller.handleLike,
  handleMarkRead: controller.handleMarkRead,
  handleNext: controller.handleNext,
  handlePrevious: controller.handlePrevious,
  handleRemove: controller.handleRemoveSelected,
  handleToggleDebug: controller.handleToggleDebug,
  handleToggleSourceDetails: controller.handleToggleSourceDetails,
  index: controller.selectedArticleIndex,
  isBookmarked: getArticleIdState(selectedArticle, controller.isBookmarked),
  isFavorite: controller.isFavorite(selectedArticle.sourceId),
  isLiked: getArticleIdState(selectedArticle, controller.isLiked),
  isRead: controller.readArticles.has(selectedArticle.url),
  readTime: controller.estimatedReadTimes[selectedArticle.url],
  showSourceDetails: controller.showSourceDetails,
  source: controller.source,
  sourceLoading: controller.sourceLoading,
});

const renderQueueDigest = (controller: Readonly<ReadingQueueController>): ReactElement => (
  <QueueDigestView
    articleCount={controller.queuedArticles.length}
    digestError={controller.digestError}
    digestLoading={controller.digestLoading}
    embedModalArticle={controller.embedModalArticle}
    onClose={controller.handleCloseOverview}
    onEmbedClose={controller.handleCloseEmbedded}
    onNavigateArticle={controller.handleNavigateArticle}
    onOpenArticle={controller.handleOpenEmbeddedArticle}
    queueDigest={controller.queueDigest}
  />
);

const renderQueueList = (controller: Readonly<ReadingQueueController>): ReactElement => (
  <QueueListView
    estimatedReadTimes={controller.estimatedReadTimes}
    expandedIndex={controller.expandedIndex}
    isLoaded={controller.isLoaded}
    onOpenArticle={controller.handleOpenArticle}
    onOpenDigest={controller.handleOpenDigest}
    onRemoveArticle={controller.handleRemoveArticle}
    onToggleArticle={controller.handleToggleArticle}
    queuedArticles={controller.queuedArticles}
    readingHistoryIds={controller.readingHistoryIds}
  />
);

const QueueSheetBody = (
  props: Readonly<{ readonly controller: ReadingQueueController }>,
): ReactElement => {
  const { controller } = props;
  const { selectedArticle } = controller;
  if (selectedArticle !== undefined) {
    return <ArticleDetailView details={getArticleDetails({ controller, selectedArticle })} />;
  }
  if (controller.showQueueOverview) {
    return renderQueueDigest(controller);
  }
  return renderQueueList(controller);
};

export const ReadingQueueSidebar = (): ReactElement => {
  const controller = useReadingQueueController();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <QueueTriggerButton
          isLoaded={controller.isLoaded}
          queuedArticleCount={controller.queuedArticles.length}
        />
      </SheetTrigger>
      <SheetContent
        className={`flex flex-col p-0 ${getSheetContentClassName(controller.selectedArticle)}`}
      >
        <SheetDescription className="sr-only">Review and manage your reading queue.</SheetDescription>
        <QueueSheetBody controller={controller} />
      </SheetContent>
    </Sheet>
  );
};
