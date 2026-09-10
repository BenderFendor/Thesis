import type { Notification } from "@/components/notification-popup";
import type { ViewMode } from "@/components/global-navigation";
import type { NewsArticle, NewsSource } from "@/lib/api";
import { formatArticleDate } from "@/lib/date-formatters";
import type { DeepReadonly } from "@/lib/deep-readonly";

const VIEW_OPTIONS: readonly { value: ViewMode; label: string }[] = [
  { label: "Globe", value: "globe" },
  { label: "Grid", value: "grid" },
  { label: "Scroll", value: "scroll" },
  { label: "Blindspot", value: "blindspot" },
  { label: "Live", value: "live-news" },
];
const MOBILE_VIEW_OPTIONS = VIEW_OPTIONS;
const EMPTY_SOURCES: NewsSource[] = [];
const ALERTS_BUTTON_ID = "scoop-alerts-button";

type ArticleSortMode = "favorites" | "newest" | "oldest" | "source-freshness";
type TopicSortMode = "sources" | "articles" | "recent";
type SourceRecency = Record<string, number>;
type ReadonlyNewsArticleList = readonly Readonly<NewsArticle>[];
type ReadonlyNewsSourceList = readonly Readonly<NewsSource>[];
type ReadonlyNotificationList = readonly Readonly<Notification>[];

interface CategoryOption {
  readonly id: string;
  readonly label: string;
}

interface ViewDataEvent {
  readonly currentTarget: Readonly<{ dataset: Readonly<DOMStringMap> }>;
}

interface SelectChangeEvent {
  readonly target: Readonly<{ value: string }>;
}

interface TouchPoint {
  readonly clientX: number;
  readonly clientY: number;
}

interface ReadonlyTouchList {
  readonly length: number;
  readonly [index: number]: TouchPoint;
}

interface ReadonlyTouchEvent {
  readonly touches: ReadonlyTouchList;
  readonly changedTouches: ReadonlyTouchList;
}

interface LeadDetails {
  readonly dateLabel: string;
  readonly summary: string;
  readonly credibility: string;
  readonly bias: string;
}

const getArticleSourceKey = (article: Readonly<NewsArticle>): string =>
  article.sourceId || article.source;

const getArticleTimestamp = (article: Readonly<NewsArticle>): number => {
  const { _parsedTimestamp: parsedTimestamp } = article;
  return parsedTimestamp ?? 0;
};

const getSourceRecency = (articles: readonly NewsArticle[]) => {
  const recency: SourceRecency = {};
  for (const article of articles) {
    const sourceKey = getArticleSourceKey(article);
    const timestamp = getArticleTimestamp(article);
    const previousTimestamp = recency[sourceKey];
    if (
      sourceKey &&
      timestamp > 0 &&
      (previousTimestamp === undefined || timestamp > previousTimestamp)
    ) {
      recency[sourceKey] = timestamp;
    }
  }
  return recency;
};

const compareSourceRecency = (
  articleA: Readonly<NewsArticle>,
  articleB: Readonly<NewsArticle>,
  sourceRecency: Readonly<SourceRecency>,
): number => {
  const sourceAFresh = sourceRecency[getArticleSourceKey(articleA)] ?? 0;
  const sourceBFresh = sourceRecency[getArticleSourceKey(articleB)] ?? 0;
  return sourceBFresh - sourceAFresh;
};

const compareArticleTimestamps = (
  articleA: Readonly<NewsArticle>,
  articleB: Readonly<NewsArticle>,
  sortMode: ArticleSortMode,
): number => {
  const timestampA = getArticleTimestamp(articleA);
  const timestampB = getArticleTimestamp(articleB);
  if (sortMode === "oldest") {
    return timestampA - timestampB;
  }
  return timestampB - timestampA;
};

const compareNewsArticles = (
  articleA: Readonly<NewsArticle>,
  articleB: Readonly<NewsArticle>,
  sortMode: ArticleSortMode,
  isFavorite: (sourceId: string) => boolean,
  sourceRecency: Readonly<SourceRecency> | null,
): number => {
  if (sortMode === "favorites") {
    const favoriteDifference =
      Number(isFavorite(articleB.sourceId)) - Number(isFavorite(articleA.sourceId));
    if (favoriteDifference !== 0) {
      return favoriteDifference;
    }
  }
  if (sourceRecency) {
    const freshnessDifference = compareSourceRecency(articleA, articleB, sourceRecency);
    if (freshnessDifference !== 0) {
      return freshnessDifference;
    }
  }
  return compareArticleTimestamps(articleA, articleB, sortMode);
};

const getSortSourceRecency = (
  articles: readonly NewsArticle[],
  sortMode: ArticleSortMode,
): SourceRecency | null => {
  if (sortMode === "source-freshness") {
    return getSourceRecency(articles);
  }
  return null;
};

const sortNewsArticles = (
  articles: readonly NewsArticle[],
  sortMode: ArticleSortMode,
  isFavorite: (sourceId: string) => boolean,
): NewsArticle[] => {
  const items = [...articles];
  const sourceRecency = getSortSourceRecency(items, sortMode);
  items.sort((articleA, articleB) =>
    compareNewsArticles(articleA, articleB, sortMode, isFavorite, sourceRecency),
  );
  return items;
};

const combineSourceIds = (
  lens: string,
  selectedSourceIds: readonly string[],
  lensSourceIds: Set<string>,
): string[] => {
  if (lens === "all") {
    return [...selectedSourceIds];
  }
  if (selectedSourceIds.length > 0) {
    return selectedSourceIds.filter((sourceId) => lensSourceIds.has(sourceId));
  }
  return [...lensSourceIds];
};

const getNotificationCategoryLabel = (category: string): string => {
  if (category === "all") {
    return "All";
  }
  return category;
};

function createLoadingNotification(timestamp: string, category: string): Notification {
  return {
    description: "Loading current live articles.",
    id: "live-index-loading",
    meta: { category },
    timestamp,
    title: "Live index loading",
    type: "info",
  };
}

function createFilterNotification(timestamp: string, sourceCount: number): Notification {
  return {
    action: { label: "Debug", type: "open-debug" },
    description: "Only selected sources are visible.",
    id: "filter-active",
    meta: { sources: sourceCount },
    timestamp,
    title: "Source filter active",
    type: "info",
  };
}

function createBrowseErrorNotification(timestamp: string, description: string): Notification {
  return {
    action: { label: "Retry", type: "retry" },
    description,
    id: "browse-index-error",
    timestamp,
    title: "Browse path unavailable",
    type: "error",
  };
}

function createEmptyFeedNotification(timestamp: string): Notification {
  return {
    action: { label: "Retry", type: "retry" },
    description: "Try changing filters or refreshing the live feed.",
    id: "empty-feed",
    timestamp,
    title: "No articles found",
    type: "warning",
  };
}

const getLoadingNotifications = (
  loading: boolean,
  timestamp: string,
  category: string,
): Notification[] => {
  if (loading) {
    return [createLoadingNotification(timestamp, category)];
  }
  return [];
};

const getFilterNotifications = (
  filterActive: boolean,
  timestamp: string,
  sourceCount: number,
): Notification[] => {
  if (filterActive) {
    return [createFilterNotification(timestamp, sourceCount)];
  }
  return [];
};

const getBrowseErrorNotifications = (error: Error | null, timestamp: string): Notification[] => {
  if (error) {
    return [createBrowseErrorNotification(timestamp, error.message)];
  }
  return [];
};

const getEmptyFeedNotifications = (
  loading: boolean,
  articleCount: number,
  timestamp: string,
): Notification[] => {
  if (!loading && articleCount === 0) {
    return [createEmptyFeedNotification(timestamp)];
  }
  return [];
};

const buildNotifications = ({
  activeCategory,
  browseIndexLoading,
  filterActive,
  browseIndexError,
  loading,
  activeViewArticleCount,
  selectedSourceCount,
}: DeepReadonly<{
  activeCategory: string;
  browseIndexLoading: boolean;
  filterActive: boolean;
  browseIndexError: Error | null;
  loading: boolean;
  activeViewArticleCount: number;
  selectedSourceCount: number;
}>): Notification[] => {
  const notificationTimestamp = new Date().toISOString();
  return [
    ...getLoadingNotifications(
      browseIndexLoading,
      notificationTimestamp,
      getNotificationCategoryLabel(activeCategory),
    ),
    ...getFilterNotifications(filterActive, notificationTimestamp, selectedSourceCount),
    ...getBrowseErrorNotifications(browseIndexError, notificationTimestamp),
    ...getEmptyFeedNotifications(loading, activeViewArticleCount, notificationTimestamp),
  ];
};

const getLeadBias = (article: Readonly<NewsArticle> | null): string => {
  if (article?.bias) {
    return article.bias.replace("-", " ").toUpperCase();
  }
  return "UNKNOWN";
};

const getLeadCredibility = (article: Readonly<NewsArticle> | null): string => {
  if (article?.credibility) {
    return article.credibility.toUpperCase();
  }
  return "UNKNOWN";
};

const getLeadDateLabel = (article: Readonly<NewsArticle> | null): string => {
  if (article) {
    return formatArticleDate(article.publishedAt);
  }
  return "Updating feed";
};

const getLeadSummary = (article: Readonly<NewsArticle> | null): string =>
  article?.summary?.trim() ?? "Story summary unavailable.";

const getLeadDetails = (leadArticle: Readonly<NewsArticle> | null): LeadDetails => ({
  bias: getLeadBias(leadArticle),
  credibility: getLeadCredibility(leadArticle),
  dateLabel: getLeadDateLabel(leadArticle),
  summary: getLeadSummary(leadArticle),
});

const getViewFromEvent = (event: ViewDataEvent): ViewMode | null => {
  const view = event.currentTarget.dataset.view;
  return VIEW_OPTIONS.find((option) => option.value === view)?.value ?? null;
};

const getAdjacentView = (view: ViewMode, direction: 1 | -1): ViewMode => {
  const currentIndex = VIEW_OPTIONS.findIndex((option) => option.value === view);
  const nextIndex = Math.min(VIEW_OPTIONS.length - 1, Math.max(0, currentIndex + direction));
  return VIEW_OPTIONS[nextIndex]?.value ?? view;
};

const getSwipeDirection = (deltaX: number): 1 | -1 => {
  if (deltaX < 0) {
    return 1;
  }
  return -1;
};

const parseTopicSortMode = (value: string): TopicSortMode | null => {
  if (value === "articles" || value === "recent" || value === "sources") {
    return value;
  }
  return null;
};

const parseArticleSortMode = (value: string): ArticleSortMode | null => {
  if (
    value === "favorites" ||
    value === "newest" ||
    value === "oldest" ||
    value === "source-freshness"
  ) {
    return value;
  }
  return null;
};

export {
  ALERTS_BUTTON_ID,
  buildNotifications,
  combineSourceIds,
  EMPTY_SOURCES,
  getAdjacentView,
  getArticleSourceKey,
  getLeadDetails,
  getSourceRecency,
  getSwipeDirection,
  getViewFromEvent,
  MOBILE_VIEW_OPTIONS,
  parseArticleSortMode,
  parseTopicSortMode,
  sortNewsArticles,
  VIEW_OPTIONS,
  type ArticleSortMode,
  type CategoryOption,
  type LeadDetails,
  type ReadonlyNewsArticleList,
  type ReadonlyNewsSourceList,
  type ReadonlyNotificationList,
  type ReadonlyTouchEvent,
  type SelectChangeEvent,
  type SourceRecency,
  type TopicSortMode,
  type ViewDataEvent,
};
