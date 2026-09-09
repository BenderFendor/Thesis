"use client";

import {
  Bell,
  Bookmark,
  Loader2,
  Search,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { Button } from "@/components/ui/button";
import { GlobalNavigation } from "@/components/global-navigation";
import { GridView } from "@/components/grid-view";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ViewMode } from "@/components/global-navigation";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  GRID_VIEW_MODE_STORAGE_KEY,
  getStoredGridViewMode,
  isGridViewMode,
} from "@/lib/view-mode-storage";
import { NEWS_LENSES, filterArticlesByLens, getLensSourceIds } from "@/lib/news-lens";
import type { NewsArticle, NewsSource } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { Notification, NotificationActionType } from "@/components/notification-popup";
import { fetchCacheStatus, fetchCategories, fetchSources } from "@/lib/api";
import {
  getSharedArticleCount,
  getSharedSourceCount,
  getSharedViewArticles,
  getSharedViewLoading,
} from "@/lib/news-view-state";
import { CredibilityBadge } from "@/components/credibility-badge";
import { ErrorBoundary } from "@/components/error-boundary";
import type { NewsLensId } from "@/lib/news-lens";
import { NotificationsPopup } from "@/components/notification-popup";
import { SourceSidebar } from "@/components/source-sidebar";
import { cn, hasText } from "@/lib/utils";
import { formatArticleDate } from "@/lib/date-formatters";
import { useDebugMode } from "@/hooks/use-debug-mode";
import { useDismissedNotifications } from "@/lib/notification-state";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsIndex } from "@/hooks/use-news-index";
import { useNewsLens } from "@/hooks/use-news-lens";
import { useSourceFilter } from "@/hooks/use-source-filter";

const loadGlobeView = async () => {
  const globeModule = await import("@/components/globe-view");
  return globeModule.GlobeView;
};
const loadFeedView = async () => {
  const feedModule = await import("@/components/feed-view");
  return feedModule.FeedView;
};
const loadBlindspotView = async () => {
  const blindspotModule = await import("@/components/blindspot-view");
  return blindspotModule.BlindspotView;
};
const loadLiveNewsView = async () => {
  const liveNewsModule = await import("@/components/live-news-view");
  return liveNewsModule.LiveNewsView;
};
const GlobeView = dynamic(loadGlobeView, {
    loading: () => <Skeleton className="h-[400px] w-full" />,
    ssr: false,
  });
const FeedView = dynamic(loadFeedView, {
    loading: () => <Skeleton className="h-[400px] w-full" />,
    ssr: false,
  });
const BlindspotView = dynamic(loadBlindspotView, {
    loading: () => <Skeleton className="h-[400px] w-full" />,
    ssr: false,
  });
const LiveNewsView = dynamic(loadLiveNewsView, {
    loading: () => <Skeleton className="h-[400px] w-full" />,
    ssr: false,
  });

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
    { label: "Globe", value: "globe" },
    { label: "Grid", value: "grid" },
    { label: "Scroll", value: "scroll" },
    { label: "Blindspot", value: "blindspot" },
    { label: "Live", value: "live-news" },
  ];
const MOBILE_VIEW_OPTIONS = VIEW_OPTIONS;
const EMPTY_SOURCES: NewsSource[] = [];
const HalftoneOverlay = () => (
    <svg className="hidden" aria-hidden="true">
      <filter id="halftone-pattern">
        <feTurbulence type="fractalNoise" baseFrequency="3.0" numOctaves="2" result="noise" />
        <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
        <feComponentTransfer in="mono" result="dots">
          <feFuncR type="discrete" tableValues="0 1" />
          <feFuncG type="discrete" tableValues="0 1" />
          <feFuncB type="discrete" tableValues="0 1" />
        </feComponentTransfer>
        <feComposite operator="in" in="SourceGraphic" in2="dots" />
      </filter>
    </svg>
  );

const ALERTS_BUTTON_ID = "scoop-alerts-button";

type ArticleSortMode = "favorites" | "newest" | "oldest" | "source-freshness";
type TopicSortMode = "sources" | "articles" | "recent";

interface CategoryOption {
  readonly id: string;
  readonly label: string;
}

type SourceRecency = Record<string, number>;
type ReadonlyNewsArticleList = readonly Readonly<NewsArticle>[];
type ReadonlyNewsSourceList = readonly Readonly<NewsSource>[];
type ReadonlyNotificationList = readonly Readonly<Notification>[];

interface LeadDetails {
  readonly dateLabel: string;
  readonly summary: string;
  readonly credibility: string;
  readonly bias: string;
}

interface MobileViewTabsProps {
  readonly currentView: ViewMode;
  readonly onViewChange: (view: ViewMode) => void;
  readonly onViewPreload: (view: ViewMode) => void;
}

interface CategorySelectProps {
  readonly categories: readonly CategoryOption[];
  readonly activeCategory: string;
  readonly onCategoryChange: (category: string) => void;
  readonly isGlobeView: boolean;
}

interface SortSelectProps {
  readonly isGlobeView: boolean;
  readonly isTopicMode: boolean;
  readonly sortValue: string;
  readonly onSortModeChange: (value: string) => void;
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

const getArticleSourceKey = (article: Readonly<NewsArticle>): string =>
  article.sourceId || article.source;

const HALFTONE_STYLE = { filter: "url(#halftone-pattern)" } satisfies React.CSSProperties;

const getArticleTimestamp = (article: Readonly<NewsArticle>): number => {
  const { _parsedTimestamp: parsedTimestamp } = article;
  return parsedTimestamp ?? 0;
};

const getSourceRecency = (articles: readonly NewsArticle[]) => {
  const recency: SourceRecency = {};
  for (const article of articles) {
    const sourceKey = getArticleSourceKey(article),
      timestamp = getArticleTimestamp(article);
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
  a: Readonly<NewsArticle>,
  b: Readonly<NewsArticle>,
  sourceRecency: Readonly<Record<string, number>>,
): number => {
  const aFresh = sourceRecency[getArticleSourceKey(a)] ?? 0,
    bFresh = sourceRecency[getArticleSourceKey(b)] ?? 0;
  return bFresh - aFresh;
};

const compareArticleTimestamps = (
  a: Readonly<NewsArticle>,
  b: Readonly<NewsArticle>,
  sortMode: ArticleSortMode,
): number => {
  const aTime = getArticleTimestamp(a),
    bTime = getArticleTimestamp(b);
  if (sortMode === "oldest") {
  return aTime - bTime;
}
return bTime - aTime;
};

const compareNewsArticles = (
  a: Readonly<NewsArticle>,
  b: Readonly<NewsArticle>,
  sortMode: ArticleSortMode,
  isFavorite: (sourceId: string) => boolean,
  sourceRecency: Readonly<Record<string, number>> | null,
): number => {
  if (sortMode === "favorites") {
    const favoriteDifference = Number(isFavorite(b.sourceId)) - Number(isFavorite(a.sourceId));
    if (favoriteDifference !== 0) {
      return favoriteDifference;
    }
  }
  if (sourceRecency) {
    const freshnessDifference = compareSourceRecency(a, b, sourceRecency);
    if (freshnessDifference !== 0) {
      return freshnessDifference;
    }
  }
  return compareArticleTimestamps(a, b, sortMode);
};

const sortNewsArticles = (
  articles: readonly NewsArticle[],
  sortMode: ArticleSortMode,
  isFavorite: (sourceId: string) => boolean,
): NewsArticle[] => {
  const items = [...articles],
    sourceRecency = (() => {
  if (sortMode === "source-freshness") {
    return getSourceRecency(items);
  }
  return null;
})();
  items.sort((a, b) => compareNewsArticles(a, b, sortMode, isFavorite, sourceRecency));
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
  const next: Notification[] = [],
    notificationCategoryLabel = (() => {
  if (activeCategory === "all") {
    return "All";
  }
  return activeCategory;
})(),
    notificationTimestamp = new Date().toISOString();

  if (browseIndexLoading) {
    next.push(createLoadingNotification(notificationTimestamp, notificationCategoryLabel));
  }

  if (filterActive) {
    next.push(createFilterNotification(notificationTimestamp, selectedSourceCount));
  }

  if (browseIndexError) {
    next.push(createBrowseErrorNotification(notificationTimestamp, browseIndexError.message));
  }

  if (!loading && activeViewArticleCount === 0) {
    next.push(createEmptyFeedNotification(notificationTimestamp));
  }

  return next;
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

const LoadingToast = () => (
  <div className="fixed bottom-4 left-4 sm:bottom-8 sm:left-8 z-[100] pointer-events-none">
    <div className="pointer-events-auto w-64 overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-secondary)]/90 p-4 shadow-2xl backdrop-blur-xl transition-all duration-500 animate-in slide-in-from-bottom-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-primary">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading
          </span>
        </div>
        <h3 className="mt-3 font-serif text-sm font-medium text-foreground">
          Loading live articles...
        </h3>
      </div>
    </div>
  </div>
);

const getViewFromEvent = (event: ViewDataEvent): ViewMode | null => {
  const view = event.currentTarget.dataset.view;
  return VIEW_OPTIONS.find((option) => option.value === view)?.value ?? null;
};

const MobileViewTabs = (props: DeepReadonly<MobileViewTabsProps>) => {
  const { currentView, onViewChange, onViewPreload } = props;
  const handlePreload = useCallback(
      (event: ViewDataEvent) => {
        const view = getViewFromEvent(event);
        if (view) {
          onViewPreload(view);
        }
      },
      [onViewPreload],
    );
  const handleChange = useCallback(
      (event: ViewDataEvent) => {
        const view = getViewFromEvent(event);
        if (view) {
          onViewChange(view);
        }
      },
      [onViewChange],
    );
  return (
    <nav
      aria-label="Mobile view tabs"
      className={cn(
        "flex items-center justify-center gap-5 overflow-x-auto px-1 py-0.5 no-scrollbar lg:hidden",
        "order-first -mb-1 justify-start pr-24",
      )}
    >
      {MOBILE_VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-view={option.value}
          onFocus={handlePreload}
          onPointerEnter={handlePreload}
          onClick={handleChange}
          className={cn(
            "shrink-0 border-b px-0.5 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
            (() => {
  if (currentView === option.value) {
    return "border-primary text-foreground";
  }
  return "border-transparent text-muted-foreground/70";
})(),
          )}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
};

const CategorySelect = (props: DeepReadonly<CategorySelectProps>) => {
  const { categories, activeCategory, onCategoryChange, isGlobeView } = props;
  const handleChange = useCallback(
    (event: SelectChangeEvent) => {
      onCategoryChange(event.target.value);
    },
    [onCategoryChange],
  );
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
        isGlobeView && "bg-black/25 backdrop-blur-xl",
      )}
    >
      <span
        className={cn(
          "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
          isGlobeView && "sr-only sm:not-sr-only",
        )}
      >
        Category
      </span>
      <select
        value={activeCategory}
        onChange={handleChange}
        className={cn(
          "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
          (() => {
  if (isGlobeView) {
    return "py-0.5";
  }
  return "py-1";
})(),
        )}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id} className="bg-[#0a0a0a]">
            {category.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const SortSelect = (props: DeepReadonly<SortSelectProps>) => {
  const { isGlobeView, isTopicMode, sortValue, onSortModeChange } = props;
  const handleChange = useCallback(
    (event: SelectChangeEvent) => {
      onSortModeChange(event.target.value);
    },
    [onSortModeChange],
  );
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
        isGlobeView && "bg-black/25 backdrop-blur-xl",
      )}
    >
      <span
        className={cn(
          "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
          isGlobeView && "sr-only sm:not-sr-only",
        )}
      >
        Sort
      </span>
      <select
        value={sortValue}
        onChange={handleChange}
        className={cn(
          "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
          (() => {
  if (isGlobeView) {
    return "py-0.5";
  }
  return "py-1";
})(),
        )}
      >
        {(() => {
  if (isTopicMode) {
    return <>
            <option value="sources" className="bg-[#0a0a0a]">
              Sources
            </option>
            <option value="articles" className="bg-[#0a0a0a]">
              Articles
            </option>
            <option value="recent" className="bg-[#0a0a0a]">
              Recent
            </option>
          </>;
  }
  return <>
            <option value="favorites" className="bg-[#0a0a0a]">
              Favorites
            </option>
            <option value="newest" className="bg-[#0a0a0a]">
              Newest
            </option>
          </>;
})()}
      </select>
    </div>
  );
};

interface HeaderBarProps {
  readonly isGlobeView: boolean;
  readonly currentView: ViewMode;
  readonly gridMode: "source" | "topic";
  readonly topicSortMode: TopicSortMode;
  readonly sortMode: ArticleSortMode;
  readonly categories: readonly CategoryOption[];
  readonly activeCategory: string;
  readonly onCategoryChange: (category: string) => void;
  readonly onSortModeChange: (value: string) => void;
  readonly articleCount: number;
  readonly actionableNotificationCount: number;
  readonly onAlertsClick: () => void;
  readonly lens: string;
  readonly activeLensLabel: string;
  readonly onOpenSidebar: () => void;
  readonly onViewChange: (view: ViewMode) => void;
  readonly onViewPreload: (view: ViewMode) => void;
}

const HeaderIdentity = ({
  isGlobeView,
  currentView,
  articleCount,
}: Pick<HeaderBarProps, "isGlobeView" | "currentView" | "articleCount">) => (
  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
    <h3
      className={cn(
        "min-w-0 truncate whitespace-nowrap font-serif text-lg font-black uppercase tracking-tight text-foreground/90 sm:text-2xl",
        "hidden lg:block",
      )}
    >
      {VIEW_OPTIONS.find((v) => v.value === currentView)?.label} View
    </h3>
    <div className={cn("hidden h-4 w-px bg-white/10 sm:block", isGlobeView && "lg:block")} />
    <span
      className={cn(
        "hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50 sm:inline",
        isGlobeView && "lg:inline",
      )}
    >
      {articleCount} articles indexed
    </span>
  </div>
);

interface HeaderResourceLinksProps {
  readonly isGlobeView: boolean;
}

const HeaderResourceLinks = (props: HeaderResourceLinksProps) => {
  const { isGlobeView } = props;
  return (
    <div className="contents lg:flex lg:items-center lg:gap-1.5">
    <div className="hidden lg:block">
      <ThemeToggle />
    </div>
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
        isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
      )}
    >
      <Link href="/saved">
        <Bookmark className="mr-1.5 h-3.5 w-3.5" />
        Saved
      </Link>
    </Button>
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
        isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
      )}
    >
      <Link href="/search">
        <Search className="mr-1.5 h-3.5 w-3.5" />
        Research
      </Link>
    </Button>
    </div>
  );
};

const HeaderSourceFilterButton = ({
  isGlobeView,
  lens,
  activeLensLabel,
  onOpenSidebar,
}: DeepReadonly<
  Pick<HeaderBarProps, "isGlobeView" | "lens" | "activeLensLabel" | "onOpenSidebar">
>) => (
  <Button
    variant="outline"
    size="sm"
    onClick={onOpenSidebar}
    className={cn(
      "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
      isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
    )}
  >
    {(() => {
  if (lens === "all") {
    return "Sources";
  }
  return activeLensLabel;
})()}
  </Button>
);

const HeaderResourceActions = ({
  isGlobeView,
  lens,
  activeLensLabel,
  onOpenSidebar,
}: Pick<HeaderBarProps, "isGlobeView" | "lens" | "activeLensLabel" | "onOpenSidebar">) => (
  <div className={cn("grid grid-cols-3 gap-2 sm:flex sm:items-center", isGlobeView && "gap-1.5")}>
    <div className="hidden h-4 w-px bg-white/10 lg:block" />
    <HeaderResourceLinks isGlobeView={isGlobeView} />
    <HeaderSourceFilterButton
      activeLensLabel={activeLensLabel}
      isGlobeView={isGlobeView}
      lens={lens}
      onOpenSidebar={onOpenSidebar}
    />
  </div>
);

const HeaderControls = (props: Readonly<Pick<
  HeaderBarProps,
  | "isGlobeView"
  | "currentView"
  | "gridMode"
  | "topicSortMode"
  | "sortMode"
  | "categories"
  | "activeCategory"
  | "onCategoryChange"
  | "onSortModeChange"
  | "lens"
  | "activeLensLabel"
  | "onOpenSidebar"
>> ) => {
  const {
    isGlobeView,
    currentView,
    gridMode,
    topicSortMode,
    sortMode,
    categories,
    activeCategory,
    onCategoryChange,
    onSortModeChange,
    lens,
    activeLensLabel,
    onOpenSidebar,
  } = props;
  const isTopicMode = currentView === "grid" && gridMode === "topic";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end lg:gap-3",
        (() => {
  if (isGlobeView) {
    return "gap-1.5";
  }
  return "gap-2";
})(),
      )}
    >
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center">
        <CategorySelect
          categories={categories}
          activeCategory={activeCategory}
          onCategoryChange={onCategoryChange}
          isGlobeView={isGlobeView}
        />
        <SortSelect
          isGlobeView={isGlobeView}
          isTopicMode={isTopicMode}
          sortValue={(() => {
  if (isTopicMode) {
    return topicSortMode;
  }
  return sortMode;
})()}
          onSortModeChange={onSortModeChange}
        />
      </div>
      <HeaderResourceActions
        activeLensLabel={activeLensLabel}
        isGlobeView={isGlobeView}
        lens={lens}
        onOpenSidebar={onOpenSidebar}
      />
    </div>
  );
};

const HeaderBar = (props: Readonly<HeaderBarProps>) => {
  const {
    isGlobeView,
    currentView,
    gridMode,
    topicSortMode,
    sortMode,
    categories,
    activeCategory,
    onCategoryChange,
    onSortModeChange,
    articleCount,
    actionableNotificationCount,
    onAlertsClick,
    lens,
    activeLensLabel,
    onOpenSidebar,
    onViewChange,
    onViewPreload,
  } = props;
  return (
  <header
    className={cn(
      "z-40 px-3 py-3 backdrop-blur sm:px-4 lg:sticky lg:top-0 lg:border-b-0 lg:bg-[var(--news-bg-primary)]/95 lg:px-6 lg:py-4 supports-[backdrop-filter]:lg:bg-[var(--news-bg-primary)]/80",
      (() => {
  if (isGlobeView) {
    return "absolute inset-x-0 top-0 border-b-0 bg-transparent";
  }
  return "sticky top-0 border-b border-white/5 bg-[var(--news-bg-primary)]/95 supports-[backdrop-filter]:bg-[var(--news-bg-primary)]/80";
})(),
    )}
  >
    <div
      className={cn(
        "flex min-w-0 flex-col lg:flex-row lg:items-center lg:justify-between",
        (() => {
  if (isGlobeView) {
    return "gap-2";
  }
  return "gap-3";
})(),
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between lg:justify-start lg:gap-6",
          "absolute right-3 top-2 z-10 lg:static",
        )}
      >
        <HeaderIdentity
          articleCount={articleCount}
          currentView={currentView}
          isGlobeView={isGlobeView}
        />
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <Button
            id={ALERTS_BUTTON_ID}
            type="button"
            variant="outline"
            size="icon"
            onClick={onAlertsClick}
            className="relative h-8 w-8 border-white/10 bg-[var(--news-bg-secondary)] p-0"
            title="Alerts"
          >
            <Bell className="h-3.5 w-3.5" />
            {actionableNotificationCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
                {actionableNotificationCount}
              </span>
            )}
          </Button>
          <ThemeToggle />
        </div>
      </div>

      <MobileViewTabs
        currentView={currentView}
        onViewChange={onViewChange}
        onViewPreload={onViewPreload}
      />

      <HeaderControls
        activeCategory={activeCategory}
        activeLensLabel={activeLensLabel}
        categories={categories}
        currentView={currentView}
        gridMode={gridMode}
        isGlobeView={isGlobeView}
        lens={lens}
        onCategoryChange={onCategoryChange}
        onOpenSidebar={onOpenSidebar}
        onSortModeChange={onSortModeChange}
        sortMode={sortMode}
        topicSortMode={topicSortMode}
      />
    </div>
  </header>
  );
};

const StatCell = ({
  label,
  value,
  valueClassName,
}: Readonly<{ label: string; value: string; valueClassName: string }>) => (
  <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
    <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">
      {label}
    </span>
    <span className={`block ${valueClassName}`}>{value}</span>
  </div>
);

const LeadStory = ({
  leadArticle,
  leadDateLabel,
  leadSummary,
}: DeepReadonly<{
  leadArticle: NewsArticle | null;
  leadDateLabel: string;
  leadSummary: string;
}>) => (
  <div className="flex-1 min-w-0">
    <div className="mb-2 flex items-center gap-2 sm:mb-3 sm:gap-3">
      <span className="border bg-primary/10 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.28em] text-primary border-primary/30 sm:text-[9px] sm:tracking-[0.4em]">
        Lead
      </span>
      <span className="font-mono text-[9px] text-muted-foreground/60 tracking-wider sm:text-[10px]">
        {leadDateLabel}
      </span>
    </div>

    <h2 className="mb-2 line-clamp-3 font-serif text-2xl font-semibold leading-tight tracking-tight sm:mb-4 sm:text-5xl">
      {leadArticle?.title ?? "Loading coverage..."}
    </h2>

    <p className="max-w-3xl text-sm leading-snug text-foreground/65 font-serif italic line-clamp-2 sm:text-lg sm:leading-relaxed">
      {leadSummary}
    </p>
  </div>
);

const LeadMetadata = ({
  leadArticle,
  articleCount,
  sourceCount,
  leadBias,
  leadCredibility,
}: DeepReadonly<{
  leadArticle: NewsArticle | null;
  articleCount: number;
  sourceCount: number;
  leadBias: string;
  leadCredibility: string;
}>) => (
  <div className="shrink-0 flex flex-col gap-1 w-full sm:w-64 lg:w-72">
    <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/10 overflow-hidden">
      <StatCell
        label="Live articles"
        value={String(articleCount)}
        valueClassName="text-sm font-semibold tabular-nums"
      />
      <StatCell
        label="Live sources"
        value={String(sourceCount)}
        valueClassName="text-sm font-semibold tabular-nums"
      />
      <StatCell
        label="Bias"
        value={leadBias}
        valueClassName="text-xs font-semibold text-primary/80 uppercase tracking-tighter"
      />
      <StatCell
        label="Signal"
        value={leadCredibility}
        valueClassName="text-xs font-semibold text-foreground/90 uppercase tracking-tighter"
      />
    </div>
    <div className="px-1 py-1 text-[9px] text-muted-foreground/50 italic leading-tight">
      {(() => {
  if (hasText(leadArticle?.summary)) {
    return "Source metadata available for this story.";
  }
  return "Lead coverage loading...";
})()}
    </div>
    {leadArticle && (
      <CredibilityBadge domain={leadArticle.sourceId || leadArticle.source} size="sm" />
    )}
  </div>
);

const getLeadDetails = (
  leadArticle: Readonly<NewsArticle> | null,
): LeadDetails => ({
  bias: (() => {
  if (leadArticle?.bias) {
    return leadArticle.bias.replace("-", " ").toUpperCase();
  }
  return "UNKNOWN";
})(),
  credibility: (() => {
  if (leadArticle?.credibility) {
    return leadArticle.credibility.toUpperCase();
  }
  return "UNKNOWN";
})(),
  dateLabel: (() => {
  if (leadArticle) {
    return formatArticleDate(leadArticle.publishedAt);
  }
  return "Updating feed";
})(),
  summary: leadArticle?.summary?.trim() ?? "Story summary unavailable.",
});

const LeadSection = ({
  leadArticle,
  articleCount,
  sourceCount,
  isBlindspotView,
  isGlobeView,
  currentView,
}: Readonly<{
  leadArticle: Readonly<NewsArticle> | null;
  articleCount: number;
  sourceCount: number;
  isBlindspotView: boolean;
  isGlobeView: boolean;
  currentView: ViewMode;
}>) => {
  if (isGlobeView || currentView === "scroll") {
    return null;
  }
  const { dateLabel, summary, credibility, bias } = getLeadDetails(leadArticle);
  return (
    <div className={cn("relative p-3 sm:p-6", isBlindspotView && "hidden lg:block")}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
        style={HALFTONE_STYLE}
      />
      <div className="flex flex-col gap-3 sm:gap-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
          <LeadStory leadArticle={leadArticle} leadDateLabel={dateLabel} leadSummary={summary} />
          <LeadMetadata
            articleCount={articleCount}
            leadArticle={leadArticle}
            leadBias={bias}
            leadCredibility={credibility}
            sourceCount={sourceCount}
          />
        </div>
      </div>
    </div>
  );
};

interface ActiveViewProps {
  readonly currentView: ViewMode;
  readonly categoryId: string;
  readonly activeCategory: string;
  readonly articles: ReadonlyNewsArticleList;
  readonly loading: boolean;
  readonly totalCount: number;
  readonly topicSortMode: TopicSortMode;
  readonly gridMode: "source" | "topic";
  readonly onGridModeChange: (mode: "source" | "topic") => void;
  readonly debugMode: boolean;
  readonly selectedSourceIds: readonly string[];
}

const GlobeActiveView = ({
  categoryId,
  articles,
  loading,
}: DeepReadonly<Pick<ActiveViewProps, "categoryId" | "articles" | "loading">>) => (
  <GlobeView key={`${categoryId}-globe`} articles={articles} loading={loading} />
);

const GridActiveView = ({
  articles,
  loading,
  topicSortMode,
  gridMode,
  onGridModeChange,
  totalCount,
}: DeepReadonly<Pick<
  ActiveViewProps,
  "articles" | "loading" | "topicSortMode" | "gridMode" | "onGridModeChange" | "totalCount"
>>) => (
  <GridView
    articles={articles}
    loading={loading}
    showTrending
    topicSortMode={topicSortMode}
    viewMode={gridMode}
    onViewModeChange={onGridModeChange}
    isScrollMode={false}
    totalCount={totalCount}
  />
);

const ScrollActiveView = ({
  categoryId,
  articles,
  loading,
  totalCount,
  debugMode,
}: DeepReadonly<
  Pick<ActiveViewProps, "categoryId" | "articles" | "loading" | "totalCount" | "debugMode">
>) => (
  <FeedView
    key={`${categoryId}-scroll`}
    articles={articles}
    loading={loading}
    totalCount={totalCount}
    debugMode={debugMode}
  />
);

const BlindspotActiveView = ({
  categoryId,
  activeCategory,
  selectedSourceIds,
}: DeepReadonly<Pick<ActiveViewProps, "categoryId" | "activeCategory" | "selectedSourceIds">>) => (
  <BlindspotView
    key={`${categoryId}-blindspot`}
    category={activeCategory}
    sources={selectedSourceIds}
  />
);

const LiveNewsActiveView = ({
  categoryId,
  articles,
  loading,
}: DeepReadonly<Pick<ActiveViewProps, "categoryId" | "articles" | "loading">>) => (
  <LiveNewsView key={`${categoryId}-live-news`} articles={articles} loading={loading} />
);

const ActiveView = (props: DeepReadonly<ActiveViewProps>) => {
  switch (props.currentView) {
    case "globe": {
      return <GlobeActiveView {...props} />;
    }
    case "grid": {
      return <GridActiveView {...props} />;
    }
    case "scroll": {
      return <ScrollActiveView {...props} />;
    }
    case "blindspot": {
      return <BlindspotActiveView {...props} />;
    }
    case "live-news": {
      return <LiveNewsActiveView {...props} />;
    }
  }
  return null;
};

interface PageNavigationProps {
  readonly currentView?: ViewMode;
  readonly onViewChange?: (view: ViewMode) => void;
  readonly onViewPreload?: (view: ViewMode) => void;
  readonly onAlertsClick?: () => void;
  readonly alertCount?: number;
}

interface PageNotificationsProps {
  readonly notifications: readonly Notification[];
  readonly onClear: (id: string) => void;
  readonly onClearAll: () => void;
  readonly onAction?: (type: NotificationActionType, notification: Notification) => void;
  readonly onClose: () => void;
  readonly anchorId?: string;
}

interface PageLeadProps {
  readonly leadArticle: Readonly<NewsArticle> | null;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly isBlindspotView: boolean;
  readonly isGlobeView: boolean;
  readonly currentView: ViewMode;
}

interface PageSourceSidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sourceRecency?: Readonly<Record<string, number>>;
}

interface NewsPageLayoutProps {
  readonly loading: boolean;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly currentView: ViewMode;
  readonly showNotifications: boolean;
  readonly navigation: PageNavigationProps;
  readonly notifications: PageNotificationsProps;
  readonly header: HeaderBarProps;
  readonly lead: PageLeadProps;
  readonly activeView: ActiveViewProps;
  readonly categories: readonly CategoryOption[];
  readonly activeCategory: string;
  readonly onCategoryChange: (category: string) => void;
  readonly onTouchStart: (event: ReadonlyTouchEvent) => void;
  readonly onTouchEnd: (event: ReadonlyTouchEvent) => void;
  readonly sourceSidebar: PageSourceSidebarProps;
}

interface NewsCategoryTabsProps {
  readonly currentView: ViewMode;
  readonly activeCategory: string;
  readonly categories: readonly CategoryOption[];
  readonly activeView: ActiveViewProps;
  readonly onCategoryChange: (category: string) => void;
}

const NewsCategoryTabs = (props: NewsCategoryTabsProps) => {
  const { currentView, activeCategory, categories, activeView, onCategoryChange } = props;
  const isCompactView = currentView === "globe" || currentView === "scroll";
  return (
    <Tabs
      value={activeCategory}
      onValueChange={onCategoryChange}
      className={cn("flex-1 flex flex-col", (() => {
  if (isCompactView) {
    return "overflow-hidden";
  }
  return "";
})())}
    >
      {categories.map((category) => (
        <TabsContent
          key={category.id}
          value={category.id}
          className={cn("mt-0 flex-1", (() => {
  if (isCompactView) {
    return "overflow-hidden flex flex-col";
  }
  return "";
})())}
        >
          {activeCategory === category.id && <ActiveView {...activeView} categoryId={category.id} activeCategory={activeCategory} />}
        </TabsContent>
      ))}
    </Tabs>
  );
};

interface NewsMainContentProps {
  readonly currentView: ViewMode;
  readonly activeCategory: string;
  readonly categories: readonly CategoryOption[];
  readonly activeView: ActiveViewProps;
  readonly lead: PageLeadProps;
  readonly onCategoryChange: (category: string) => void;
  readonly onTouchStart: (event: ReadonlyTouchEvent) => void;
  readonly onTouchEnd: (event: ReadonlyTouchEvent) => void;
}

const NewsMainContent = (props: NewsMainContentProps) => {
  const {
    currentView,
    activeCategory,
    categories,
    activeView,
    lead,
    onCategoryChange,
    onTouchStart,
    onTouchEnd,
  } = props;
  const isGlobeView = currentView === "globe";
  const isScrollView = currentView === "scroll";
  const isCompactView = isGlobeView || isScrollView;
  return (
    <main
      className={cn(
        "flex-1 min-w-0 bg-[var(--news-bg-primary)]",
        (() => {
  if (isCompactView) {
    return "overflow-hidden";
  }
  return "";
})(),
      )}
    >
      <div
        className={cn(
          "w-full grid grid-cols-1 lg:grid-cols-12 gap-0",
          (() => {
  if (isCompactView) {
    return "h-full";
  }
  return "";
})(),
        )}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <section
          className={cn(
            "lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col",
            (() => {
  if (isCompactView) {
    return "h-full overflow-hidden";
  }
  return "min-h-[calc(100vh-80px)]";
})(),
          )}
        >
          <LeadSection
            {...lead}
            isBlindspotView={currentView === "blindspot"}
            isGlobeView={isGlobeView}
          />
          <NewsCategoryTabs
            activeCategory={activeCategory}
            activeView={activeView}
            categories={categories}
            currentView={currentView}
            onCategoryChange={onCategoryChange}
          />
        </section>
      </div>
    </main>
  );
};

const NewsPageLayout = (props: Readonly<NewsPageLayoutProps>) => {
  const {
    loading,
    activeViewArticles,
    currentView,
    showNotifications,
    navigation,
    notifications,
    header,
    lead,
    activeView,
    categories,
    activeCategory,
    onCategoryChange,
    onTouchStart,
    onTouchEnd,
    sourceSidebar,
  } = props;
  return (
    <div className="min-h-screen overflow-x-hidden flex bg-[var(--news-bg-primary)] text-foreground">
    <HalftoneOverlay />
    {loading && activeViewArticles.length === 0 && <LoadingToast />}
    <GlobalNavigation {...navigation} />
    {showNotifications && <NotificationsPopup {...notifications} />}
    <div
      className={cn(
        "flex-1 flex flex-col min-w-0",
        (() => {
  if (currentView === "scroll") {
    return "h-screen overflow-hidden";
  }
  return "";
})(),
      )}
    >
      <HeaderBar {...header} />
      <NewsMainContent
        activeCategory={activeCategory}
        activeView={activeView}
        categories={categories}
        currentView={currentView}
        lead={lead}
        onCategoryChange={onCategoryChange}
        onTouchEnd={onTouchEnd}
        onTouchStart={onTouchStart}
      />
    </div>
      <SourceSidebar {...sourceSidebar} />
    </div>
  );
};

interface NewsPageState {
  readonly currentView: ViewMode;
  readonly setCurrentView: React.Dispatch<React.SetStateAction<ViewMode>>;
  readonly activeCategory: string;
  readonly setActiveCategory: React.Dispatch<React.SetStateAction<string>>;
  readonly showNotifications: boolean;
  readonly setShowNotifications: React.Dispatch<React.SetStateAction<boolean>>;
  readonly sidebarOpen: boolean;
  readonly setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  readonly sortMode: ArticleSortMode;
  readonly setSortMode: React.Dispatch<React.SetStateAction<ArticleSortMode>>;
  readonly topicSortMode: TopicSortMode;
  readonly setTopicSortMode: React.Dispatch<React.SetStateAction<TopicSortMode>>;
  readonly gridMode: "source" | "topic";
  readonly setGridMode: React.Dispatch<React.SetStateAction<"source" | "topic">>;
  readonly debugMode: boolean;
  readonly router: AppRouterInstance;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly selectedSources: ReadonlySet<string>;
  readonly isFilterActive: () => boolean;
  readonly lens: NewsLensId;
}

const useGridModeStorageSync = (setGridMode: NewsPageState["setGridMode"]): void => {
  useEffect(() => {
    const handleStorage = (event: DeepReadonly<StorageEvent>) => {
      if (event.key === GRID_VIEW_MODE_STORAGE_KEY && isGridViewMode(event.newValue)) {
        setGridMode(event.newValue);
      }
    };
    globalThis.addEventListener("storage", handleStorage);
    return () => {
      globalThis.removeEventListener("storage", handleStorage);
    };
  }, [setGridMode]);
};

const useNewsPageState = (): NewsPageState => {
  const [currentView, setCurrentView] = useState<ViewMode>("grid"),
    [activeCategory, setActiveCategory] = useState<string>("all"),
    [showNotifications, setShowNotifications] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    debugMode = useDebugMode(),
    [sortMode, setSortMode] = useState<ArticleSortMode>("favorites"),
    [topicSortMode, setTopicSortMode] = useState<TopicSortMode>("sources"),
    [gridMode, setGridMode] = useState<"source" | "topic">(getStoredGridViewMode),
    router = useRouter(),
    { isFavorite } = useFavorites(),
    { selectedSources, isFilterActive } = useSourceFilter(),
    { lens } = useNewsLens();

  useGridModeStorageSync(setGridMode);
  return {
    activeCategory,
    currentView,
    debugMode,
    gridMode,
    isFavorite,
    isFilterActive,
    lens,
    router,
    selectedSources,
    setActiveCategory,
    setCurrentView,
    setGridMode,
    setShowNotifications,
    setSidebarOpen,
    setSortMode,
    setTopicSortMode,
    showNotifications,
    sidebarOpen,
    sortMode,
    topicSortMode,
  };
};

interface NewsPageQueryData {
  readonly selectedSourceIds: readonly string[];
  readonly sources: ReadonlyNewsSourceList;
  readonly categories: readonly CategoryOption[];
  readonly browseIndexArticles: ReadonlyNewsArticleList;
  readonly browseIndexTotalCount: number;
  readonly browseIndexLoading: boolean;
  readonly browseIndexError: Error | null;
  readonly refetchBrowseIndex: () => void;
  readonly cacheStatus: Awaited<ReturnType<typeof fetchCacheStatus>> | undefined;
}

const useCategoriesQuery = (): CategoryOption[] => {
  const categoriesQuery = useQuery<string[]>({
    queryFn: fetchCategories,
    queryKey: ["categories"],
    retry: 1,
  });
  return useMemo(() => {
    const backendCategories = categoriesQuery.data ?? [],
      uniqueCategories = [...new Set(["all", ...backendCategories])];
    return uniqueCategories.map((cat) => ({
      id: cat,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
    }));
  }, [categoriesQuery.data]);
};

const useCacheStatusQuery = () => {
  const { data: cacheStatus } = useQuery({
    gcTime: 5 * 60 * 1000,
    queryFn: fetchCacheStatus,
    queryKey: ["news", "cache-status"],
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 1000,
  });
  return cacheStatus;
};

const useSelectedSourcesQuery = (
  selectedSources: ReadonlySet<string>,
  lens: ReturnType<typeof useNewsLens>["lens"],
) => {
  const selectedSourceIds = useMemo(() => [...selectedSources], [selectedSources]);
  const sourcesQuery = useQuery({
      queryFn: fetchSources,
      queryKey: ["all-sources"],
      retry: 1,
      staleTime: 60 * 1000,
    });
  const sources = sourcesQuery.data ?? EMPTY_SOURCES;
  const lensSourceIds = useMemo(() => getLensSourceIds(sources, lens), [lens, sources]);
  const combinedSourceIds = useMemo(
      () => combineSourceIds(lens, selectedSourceIds, lensSourceIds),
      [lens, lensSourceIds, selectedSourceIds],
    );
  return { combinedSourceIds, selectedSourceIds, sources };
};

const useNewsPageQueryData = ({
  activeCategory,
  lens,
  selectedSources,
}: Pick<NewsPageState, "activeCategory" | "lens" | "selectedSources">): NewsPageQueryData => {
  const { combinedSourceIds, selectedSourceIds, sources } = useSelectedSourcesQuery(
      selectedSources,
      lens,
    ),
    {
      articles: browseIndexArticles,
      totalCount: browseIndexTotalCount,
      isLoading: browseIndexLoading,
      error: browseIndexError,
      refetch: refetchBrowseIndex,
    } = useNewsIndex({
      category: (() => {
  if (activeCategory === "all") {
    return void 0;
  }
  return activeCategory;
})(),
      enabled: true,
      mode: "live",
      sources: (() => {
  if (combinedSourceIds.length > 0) {
    return combinedSourceIds;
  }
  return void 0;
})(),
    }),
    cacheStatus = useCacheStatusQuery(),
    categories = useCategoriesQuery();

  return {
    browseIndexArticles,
    browseIndexError,
    browseIndexLoading,
    browseIndexTotalCount,
    cacheStatus,
    categories,
    refetchBrowseIndex,
    selectedSourceIds,
    sources,
  };
};

interface NewsPageSortedData {
  readonly browseArticles: ReadonlyNewsArticleList;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly activeLensLabel: string;
  readonly sourceRecency: Readonly<SourceRecency>;
}

interface NewsPageSortedDataInput {
  readonly currentView: ViewMode;
  readonly sortMode: ArticleSortMode;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly lens: NewsLensId;
  readonly browseIndexArticles: ReadonlyNewsArticleList;
  readonly sources: ReadonlyNewsSourceList;
}

const useNewsPageSortedData = (props: NewsPageSortedDataInput): NewsPageSortedData => {
  const { currentView, sortMode, isFavorite, lens, browseIndexArticles, sources } = props;
  const sortArticles = useCallback(
      (items: readonly NewsArticle[]) => sortNewsArticles(items, sortMode, isFavorite),
      [isFavorite, sortMode],
    );
  const lensFilteredArticles = useMemo(
      () => filterArticlesByLens(browseIndexArticles, sources, lens),
      [browseIndexArticles, lens, sources],
    );
  const browseArticles = useMemo(
      () => sortArticles(lensFilteredArticles),
      [lensFilteredArticles, sortArticles],
    );
  const activeViewArticles = getSharedViewArticles(currentView, browseArticles);
  const activeLensLabel = NEWS_LENSES.find((item) => item.id === lens)?.label ?? "All Sources";
  const sourceRecency = useMemo(() => getSourceRecency(activeViewArticles), [activeViewArticles]);

  return { activeLensLabel, activeViewArticles, browseArticles, sourceRecency };
};

interface PageNotificationsInput {
  readonly activeCategory: string;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly browseIndexError: Error | null;
  readonly browseIndexLoading: boolean;
  readonly filterActive: boolean;
  readonly loading: boolean;
  readonly selectedSourceCount: number;
}

const usePageNotifications = (props: PageNotificationsInput): Notification[] => {
  const {
    activeCategory,
    activeViewArticles,
    browseIndexError,
    browseIndexLoading,
    filterActive,
    loading,
    selectedSourceCount,
  } = props;
  return useMemo(
    () =>
      buildNotifications({
        activeCategory,
        activeViewArticleCount: activeViewArticles.length,
        browseIndexError,
        browseIndexLoading,
        filterActive,
        loading,
        selectedSourceCount,
      }),
    [
      activeCategory,
      activeViewArticles.length,
      browseIndexError,
      browseIndexLoading,
      filterActive,
      loading,
      selectedSourceCount,
    ],
  );
};

interface NewsPageViewData extends NewsPageSortedData {
  readonly loading: boolean;
  readonly filterActive: boolean;
  readonly visibleNotifications: ReadonlyNotificationList;
  readonly dismissOne: (notificationId: string) => void;
  readonly dismissAll: () => void;
  readonly actionableNotificationCount: number;
  readonly leadArticle: NewsArticle | null;
  readonly articleCount: number;
  readonly sourceCount: number;
}

const usePageNotificationState = (notifications: readonly Notification[]) => {
  const dismissed = useDismissedNotifications(notifications);
  const actionableNotificationCount = dismissed.visibleNotifications.filter(
      (item) => item.type === "error" || item.type === "warning",
    ).length;
  return {
    actionableNotificationCount,
    dismissAll: dismissed.dismissAll,
    dismissOne: dismissed.dismissOne,
    visibleNotifications: dismissed.visibleNotifications,
  };
};

interface NewsPageViewStateInput {
  readonly activeCategory: string;
  readonly currentView: ViewMode;
  readonly isFilterActive: () => boolean;
  readonly selectedSources: ReadonlySet<string>;
  readonly sortMode: ArticleSortMode;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly lens: NewsLensId;
}

interface NewsPageViewQueriesInput {
  readonly browseIndexArticles: ReadonlyNewsArticleList;
  readonly browseIndexTotalCount: number;
  readonly browseIndexLoading: boolean;
  readonly browseIndexError: Error | null;
  readonly sources: ReadonlyNewsSourceList;
  readonly cacheStatus: Awaited<ReturnType<typeof fetchCacheStatus>> | undefined;
}

const useNewsPageViewData = (
  state: NewsPageViewStateInput,
  queries: NewsPageViewQueriesInput,
): NewsPageViewData => {
  const sorted = useNewsPageSortedData({
      browseIndexArticles: queries.browseIndexArticles,
      currentView: state.currentView,
      isFavorite: state.isFavorite,
      lens: state.lens,
      sortMode: state.sortMode,
      sources: queries.sources,
    });
  const loading = getSharedViewLoading(queries.browseIndexLoading);
  const filterActive = state.isFilterActive();
  const notifications = usePageNotifications({
      activeCategory: state.activeCategory,
      activeViewArticles: sorted.activeViewArticles,
      browseIndexError: queries.browseIndexError,
      browseIndexLoading: queries.browseIndexLoading,
      filterActive,
      loading,
      selectedSourceCount: state.selectedSources.size,
    });
  const { actionableNotificationCount, dismissAll, dismissOne, visibleNotifications } =
      usePageNotificationState(notifications);
  const leadArticle = sorted.activeViewArticles[0] ?? null;
  const articleCount = getSharedArticleCount(
      queries.cacheStatus,
      queries.browseIndexTotalCount,
      sorted.browseArticles,
      loading,
    );
  const sourceCount = getSharedSourceCount(queries.cacheStatus, sorted.browseArticles, loading);

  return {
    ...sorted,
    actionableNotificationCount,
    articleCount,
    dismissAll,
    dismissOne,
    filterActive,
    leadArticle,
    loading,
    sourceCount,
    visibleNotifications,
  };
};

const preloadNewsView = (view: ViewMode): void => {
  switch (view) {
    case "globe": {
      void loadGlobeView();
      break;
    }
    case "scroll": {
      void loadFeedView();
      break;
    }
    case "blindspot": {
      void loadBlindspotView();
      break;
    }
    case "live-news": {
      void loadLiveNewsView();
      break;
    }
    case "grid": {
      break;
    }
  }
};

const getAdjacentView = (view: ViewMode, direction: 1 | -1): ViewMode => {
  const currentIndex = VIEW_OPTIONS.findIndex((option) => option.value === view),
    nextIndex = Math.min(VIEW_OPTIONS.length - 1, Math.max(0, currentIndex + direction));
  return VIEW_OPTIONS[nextIndex]?.value ?? view;
};

interface NewsPageNavigation {
  handleCategoryChange: (category: string) => void;
  handleViewChange: (view: ViewMode) => void;
  preloadView: (view: ViewMode) => void;
  handleTouchStart: (event: ReadonlyTouchEvent) => void;
  handleTouchEnd: (event: ReadonlyTouchEvent) => void;
}

interface NewsPageNavigationState {
  readonly setActiveCategory: React.Dispatch<React.SetStateAction<string>>;
  readonly setCurrentView: React.Dispatch<React.SetStateAction<ViewMode>>;
}

const useNewsPageNavigation = (
  state: NewsPageNavigationState,
): NewsPageNavigation => {
  const { setActiveCategory, setCurrentView } = state,
    touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleCategoryChange = useCallback(
      (category: string) => {
        setActiveCategory(category);
      },
      [setActiveCategory],
    );
  const handleViewChange = useCallback(
      (view: ViewMode) => {
        setCurrentView(view);
      },
      [setCurrentView],
    );
  const moveView = useCallback(
      (direction: 1 | -1) => {
        setCurrentView((view) => getAdjacentView(view, direction));
      },
      [setCurrentView],
    );
  const handleTouchStart = useCallback(
      (event: ReadonlyTouchEvent) => {
        const touch = event.touches[0];
        if (touch) {
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }
      },
      [touchStartRef],
    );
  const handleTouchEnd = useCallback(
      (event: ReadonlyTouchEvent) => {
        const start = touchStartRef.current;
        touchStartRef.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) {
          return;
        }
        const deltaX = touch.clientX - start.x,
          deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {
          return;
        }
        moveView((() => {
  if (deltaX < 0) {
    return 1;
  }
  return -1;
})());
      },
      [moveView, touchStartRef],
    );

  return {
    handleCategoryChange,
    handleTouchEnd,
    handleTouchStart,
    handleViewChange,
    preloadView: preloadNewsView,
  };
};

interface NewsPageActions {
  handleRetry: () => void;
  handleNotificationAction: (actionType: NotificationActionType) => void;
  handleSortModeChange: (value: string) => void;
  toggleNotifications: () => void;
  closeNotifications: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
}

const parseTopicSortMode = (value: string): TopicSortMode | null => {
  switch (value) {
    case "articles":
    case "recent":
    case "sources": {
      return value;
    }
    default: {
      return null;
    }
  }
};

const parseArticleSortMode = (value: string): ArticleSortMode | null => {
  switch (value) {
    case "favorites":
    case "newest":
    case "oldest":
    case "source-freshness": {
      return value;
    }
    default: {
      return null;
    }
  }
};

const useNewsPageActions = (
  state: Readonly<Pick<
    NewsPageState,
    | "currentView"
    | "gridMode"
    | "router"
    | "setShowNotifications"
    | "setTopicSortMode"
    | "setSortMode"
    | "setSidebarOpen"
  >>,
  refetchBrowseIndex: () => void,
): NewsPageActions => {
  const {
    currentView,
    gridMode,
    router,
    setShowNotifications,
    setSidebarOpen,
    setSortMode,
    setTopicSortMode,
  } = state;
  const handleRetry = useCallback(() => {
      refetchBrowseIndex();
    }, [refetchBrowseIndex]);
  const handleNotificationAction = useCallback(
      (actionType: NotificationActionType) => {
        if (actionType === "open-debug") {
          router.push("/debug");
          setShowNotifications(false);
          return;
        }
        if (actionType === "retry") {
          handleRetry();
          setShowNotifications(false);
        }
      },
      [handleRetry, router, setShowNotifications],
    );
  const handleSortModeChange = useCallback(
      (value: string) => {
        if (currentView === "grid" && gridMode === "topic") {
          const topicSortMode = parseTopicSortMode(value);
          if (topicSortMode) {
            setTopicSortMode(topicSortMode);
          }
          return;
        }
        const articleSortMode = parseArticleSortMode(value);
        if (articleSortMode) {
          setSortMode(articleSortMode);
        }
      },
      [currentView, gridMode, setSortMode, setTopicSortMode],
    );
  const toggleNotifications = useCallback(() => {
      setShowNotifications((visible) => !visible);
    }, [setShowNotifications]);
  const closeNotifications = useCallback(() => {
      setShowNotifications(false);
    }, [setShowNotifications]);
  const openSidebar = useCallback(() => {
      setSidebarOpen(true);
    }, [setSidebarOpen]);
  const closeSidebar = useCallback(() => {
      setSidebarOpen(false);
    }, [setSidebarOpen]);

  return {
    closeNotifications,
    closeSidebar,
    handleNotificationAction,
    handleRetry,
    handleSortModeChange,
    openSidebar,
    toggleNotifications,
  };
};
interface PageFactoryData {
  readonly activeCategory: string;
  readonly activeLensLabel: string;
  readonly activeViewArticles: ReadonlyNewsArticleList;
  readonly actionableNotificationCount: number;
  readonly articleCount: number;
  readonly articles: ReadonlyNewsArticleList;
  readonly browseIndexTotalCount: number;
  readonly categories: readonly CategoryOption[];
  readonly currentView: ViewMode;
  readonly debugMode: boolean;
  readonly dismissAll: () => void;
  readonly dismissOne: (notificationId: string) => void;
  readonly gridMode: "source" | "topic";
  readonly handleNotificationAction: (actionType: NotificationActionType) => void;
  readonly handleTouchEnd: (event: ReadonlyTouchEvent) => void;
  readonly handleTouchStart: (event: ReadonlyTouchEvent) => void;
  readonly handleViewChange: (view: ViewMode) => void;
  readonly handleViewPreload: (view: ViewMode) => void;
  readonly isSidebarOpen: boolean;
  readonly isGlobeView: boolean;
  readonly leadArticle: Readonly<NewsArticle> | null;
  readonly lens: string;
  readonly loading: boolean;
  readonly onAlertsClick: () => void;
  readonly onCategoryChange: (category: string) => void;
  readonly onCloseNotifications: () => void;
  readonly onCloseSidebar: () => void;
  readonly onGridModeChange: (mode: "source" | "topic") => void;
  readonly onOpenSidebar: () => void;
  readonly onSortModeChange: (value: string) => void;
  readonly notifications: ReadonlyNotificationList;
  readonly sourceCount: number;
  readonly sourceRecency: SourceRecency;
  readonly sortMode: ArticleSortMode;
  readonly selectedSourceIds: readonly string[];
  readonly showNotifications: boolean;
  readonly topicSortMode: TopicSortMode;
}

const createPageNavigationProps = (data: DeepReadonly<PageFactoryData>): PageNavigationProps => ({
  alertCount: data.actionableNotificationCount,
  currentView: data.currentView,
  onAlertsClick: data.onAlertsClick,
  onViewChange: data.handleViewChange,
  onViewPreload: data.handleViewPreload,
});

const createPageNotificationProps = (data: DeepReadonly<PageFactoryData>): PageNotificationsProps => ({
  anchorId: ALERTS_BUTTON_ID,
  notifications: data.notifications,
  onAction: data.handleNotificationAction,
  onClear: data.dismissOne,
  onClearAll: data.dismissAll,
  onClose: data.onCloseNotifications,
});

const createPageHeaderProps = (data: DeepReadonly<PageFactoryData>): HeaderBarProps => ({
  actionableNotificationCount: data.actionableNotificationCount,
  activeCategory: data.activeCategory,
  activeLensLabel: data.activeLensLabel,
  articleCount: data.articleCount,
  categories: data.categories,
  currentView: data.currentView,
  gridMode: data.gridMode,
  isGlobeView: data.isGlobeView,
  lens: data.lens,
  onAlertsClick: data.onAlertsClick,
  onCategoryChange: data.onCategoryChange,
  onOpenSidebar: data.onOpenSidebar,
  onSortModeChange: data.onSortModeChange,
  onViewChange: data.handleViewChange,
  onViewPreload: data.handleViewPreload,
  sortMode: data.sortMode,
  topicSortMode: data.topicSortMode,
});

const createPageLeadProps = (data: DeepReadonly<PageFactoryData>): PageLeadProps => ({
  articleCount: data.articleCount,
  currentView: data.currentView,
  isBlindspotView: data.currentView === "blindspot",
  isGlobeView: data.isGlobeView,
  leadArticle: data.leadArticle,
  sourceCount: data.sourceCount,
});

const createPageActiveViewProps = (data: DeepReadonly<PageFactoryData>): ActiveViewProps => ({
  activeCategory: data.activeCategory,
  articles: data.articles,
  categoryId: data.activeCategory,
  currentView: data.currentView,
  debugMode: data.debugMode,
  gridMode: data.gridMode,
  loading: data.loading,
  onGridModeChange: data.onGridModeChange,
  selectedSourceIds: data.selectedSourceIds,
  topicSortMode: data.topicSortMode,
  totalCount: data.browseIndexTotalCount,
});

const createPageSidebarProps = (data: DeepReadonly<PageFactoryData>): PageSourceSidebarProps => ({
  isOpen: data.isSidebarOpen,
  onClose: data.onCloseSidebar,
  sourceRecency: data.sourceRecency,
});

const buildNewsPageLayoutProps = (data: DeepReadonly<PageFactoryData>): NewsPageLayoutProps => ({
  activeCategory: data.activeCategory,
  activeView: createPageActiveViewProps(data),
  activeViewArticles: data.activeViewArticles,
  categories: data.categories,
  currentView: data.currentView,
  header: createPageHeaderProps(data),
  lead: createPageLeadProps(data),
  loading: data.loading,
  navigation: createPageNavigationProps(data),
  notifications: createPageNotificationProps(data),
  onCategoryChange: data.onCategoryChange,
  onTouchEnd: data.handleTouchEnd,
  onTouchStart: data.handleTouchStart,
  showNotifications: data.showNotifications,
  sourceSidebar: createPageSidebarProps(data),
});

const useNewsPageController = (): NewsPageLayoutProps => {
  const state = useNewsPageState();
  const queries = useNewsPageQueryData(state);
  const view = useNewsPageViewData(state, queries);
  const navigation = useNewsPageNavigation(state);
  const actions = useNewsPageActions(state, queries.refetchBrowseIndex);
  return buildNewsPageLayoutProps({
    actionableNotificationCount: view.actionableNotificationCount,
    activeCategory: state.activeCategory,
    activeLensLabel: view.activeLensLabel,
    activeViewArticles: view.activeViewArticles,
    articleCount: view.articleCount,
    articles: view.browseArticles,
    browseIndexTotalCount: queries.browseIndexTotalCount,
    categories: queries.categories,
    currentView: state.currentView,
    debugMode: state.debugMode,
    dismissAll: view.dismissAll,
    dismissOne: view.dismissOne,
    gridMode: state.gridMode,
    handleNotificationAction: actions.handleNotificationAction,
    handleTouchEnd: navigation.handleTouchEnd,
    handleTouchStart: navigation.handleTouchStart,
    handleViewChange: navigation.handleViewChange,
    handleViewPreload: navigation.preloadView,
    isGlobeView: state.currentView === "globe",
    isSidebarOpen: state.sidebarOpen,
    leadArticle: view.leadArticle,
    lens: state.lens,
    loading: view.loading,
    notifications: view.visibleNotifications,
    onAlertsClick: actions.toggleNotifications,
    onCategoryChange: navigation.handleCategoryChange,
    onCloseNotifications: actions.closeNotifications,
    onCloseSidebar: actions.closeSidebar,
    onGridModeChange: state.setGridMode,
    onOpenSidebar: actions.openSidebar,
    onSortModeChange: actions.handleSortModeChange,
    selectedSourceIds: queries.selectedSourceIds,
    showNotifications: state.showNotifications,
    sortMode: state.sortMode,
    sourceCount: view.sourceCount,
    sourceRecency: view.sourceRecency,
    topicSortMode: state.topicSortMode,
  });
};

const NewsPageController = () => {
  const props = useNewsPageController();
  return <NewsPageLayout {...props} />;
};

const Page = () => (
  <ErrorBoundary>
    <NewsPageController />
  </ErrorBoundary>
);

export default Page;
