"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent } from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  Globe,
  Grid3X3,
  Scroll,
  ArrowRightLeft,
  Search,
  Bell,
  Bug,
  SlidersHorizontal,
  Bookmark,
  Building2,
  Gamepad2,
  Shirt,
  Palette,
  Laptop,
  Trophy,
  Newspaper,
  Loader2,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GridView } from "@/components/grid-view"
import { FeedView } from "@/components/feed-view"
import { BlindspotView } from "@/components/blindspot-view"
import { ArticleDetailModal } from "@/components/article-detail-modal"
import { ThemeToggle } from "@/components/theme-toggle"

const GlobeView = dynamic(
  () => import("@/components/globe-view").then((mod) => mod.GlobeView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  }
)

import { useNewsStream } from "@/hooks/useNewsStream"
import { useDebugMode } from "@/hooks/useDebugMode"
import { useFavorites } from "@/hooks/useFavorites"
import { useBrowseIndex } from "@/hooks/useBrowseIndex"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCategories, NewsArticle } from "@/lib/api"
import { logger } from "@/lib/logger"
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationsPopup, Notification, type NotificationActionType } from '@/components/notification-popup';
import { SourceSidebar } from "@/components/source-sidebar";
import { cn } from "@/lib/utils";

type ViewMode = "globe" | "grid" | "scroll" | "blindspot"

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "globe", label: "Globe" },
  { value: "grid", label: "Grid" },
  { value: "scroll", label: "Scroll" },
  { value: "blindspot", label: "Blindspot" },
]

const categoryIcons: { [key: string]: React.ElementType } = {
  politics: Building2,
  games: Gamepad2,
  fashion: Shirt,
  hobbies: Palette,
  technology: Laptop,
  sports: Trophy,
  general: Newspaper,
  all: Grid3X3,
};

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

function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("grid")
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [gridArticleCount, setGridArticleCount] = useState<number | null>(null)
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
// Remove trendingOpen state as it is no longer used
// const [trendingOpen, setTrendingOpen] = useState(false);
  const alertsButtonRef = useRef<HTMLButtonElement>(null);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debugMode = useDebugMode();
  const [sortMode, setSortMode] = useState<"favorites" | "newest" | "oldest" | "source-freshness">("favorites");
  const [topicSortMode, setTopicSortMode] = useState<"sources" | "articles" | "recent">("sources");
  const [gridMode, setGridMode] = useState<"source" | "topic">(() => {
    if (typeof window === "undefined") return "source"
    const saved = localStorage.getItem("viewMode") as "source" | "topic" | null
    return saved === "topic" ? "topic" : "source"
  });

  const [articlesByCategory, setArticlesByCategory] = useState<Record<string, NewsArticle[]>>({
    all: [],
  })
  const router = useRouter()

  // Source filtering and favorites
  const { favorites, isFavorite } = useFavorites()
  const { selectedSources, isFilterActive, isSelected } = useSourceFilter()
  const selectedSourceIds = useMemo(() => Array.from(selectedSources), [selectedSources])

  const {
    articles: browseIndexArticles,
    totalCount: browseIndexTotalCount,
    isLoading: browseIndexLoading,
    error: browseIndexError,
    refetch: refetchBrowseIndex,
  } = useBrowseIndex({
    category: activeCategory === "all" ? undefined : activeCategory,
    sources: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
    enabled: currentView !== "globe",
  })
  const categoriesQuery = useQuery<string[]>({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    retry: 1,
  })
  const categories = useMemo(() => {
    const backendCategories = categoriesQuery.data ?? []
    const uniqueCategories = Array.from(new Set(["all", ...backendCategories]))
    return uniqueCategories.map((cat) => ({
      id: cat,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      icon: categoryIcons[cat] || Newspaper,
    }))
  }, [categoriesQuery.data])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "viewMode") {
        const value = event.newValue as "source" | "topic" | null
        if (value === "source" || value === "topic") {
          setGridMode(value)
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const activeCategoryRef = useRef(activeCategory);

  useEffect(() => {
    activeCategoryRef.current = activeCategory;
  }, [activeCategory]);

  const onUpdate = useCallback((newArticles: NewsArticle[]) => {
    logger.debug(`onUpdate called with ${newArticles.length} articles for category: ${activeCategoryRef.current}`);
    setArticlesByCategory(prev => ({
      ...prev,
      [activeCategoryRef.current]: newArticles
    }));
  }, []);

  const onComplete = useCallback(() => {}, []);

  const onError = useCallback((error: string) => {
    console.error(`Stream error for ${activeCategoryRef.current}:`, error);
  }, []);

  const sortArticles = useCallback(
    (articles: NewsArticle[]): NewsArticle[] => {
      const items = [...articles];
      const sourceFreshness = sortMode === "source-freshness";
      const localRecency: Record<string, number> | null = sourceFreshness
        ? items.reduce((acc, article) => {
            const key = article.sourceId || article.source;
            if (!key) return acc;
            const ts = article._parsedTimestamp ?? 0;
            if (ts > 0 && (!acc[key] || ts > acc[key])) {
              acc[key] = ts;
            }
            return acc;
          }, {} as Record<string, number>)
        : null;

      items.sort((a, b) => {
        if (sortMode === "favorites") {
          const aIsFav = isFavorite(a.sourceId) ? 0 : 1;
          const bIsFav = isFavorite(b.sourceId) ? 0 : 1;
          if (aIsFav !== bIsFav) return aIsFav - bIsFav;
        }

        if (sourceFreshness && localRecency) {
          const aKey = a.sourceId || a.source;
          const bKey = b.sourceId || b.source;
          const aFresh = aKey ? localRecency[aKey] ?? 0 : 0;
          const bFresh = bKey ? localRecency[bKey] ?? 0 : 0;
          if (aFresh !== bFresh) return bFresh - aFresh;
        }

        const aTime = a._parsedTimestamp ?? 0;
        const bTime = b._parsedTimestamp ?? 0;

        if (sortMode === "oldest") {
          return aTime - bTime;
        }

        return bTime - aTime;
      });

      return items;
    },
    [isFavorite, sortMode]
  )

  const globeArticles = useMemo(() => {
    const items = articlesByCategory[activeCategory] || []
    const filtered = isFilterActive()
      ? items.filter((article) => isSelected(article.sourceId))
      : items

    return sortArticles(filtered)
  }, [activeCategory, articlesByCategory, isFilterActive, isSelected, sortArticles])

  const browseArticles = useMemo(() => sortArticles(browseIndexArticles), [browseIndexArticles, sortArticles])

  const activeViewArticles = currentView === "globe" ? globeArticles : browseArticles

  const sourceRecency = useMemo(() => {
    const articles = activeViewArticles
    if (!articles || articles.length === 0) return {}

    const recency: Record<string, number> = {}
    for (const article of articles) {
      const sourceKey = article.sourceId || article.source
      if (!sourceKey) continue
      const ts = article._parsedTimestamp ?? 0
      if (ts > 0 && (!recency[sourceKey] || ts > recency[sourceKey])) {
        recency[sourceKey] = ts
      }
    }
    return recency
  }, [activeViewArticles])

  const streamHook = useNewsStream({
    onUpdate,
    onComplete,
    onError,
  });
  const { abortStream, startStream } = streamHook;
  const apiUrl = streamHook.apiUrl ?? null

  const resetGlobeCategory = useCallback((category: string) => {
    setArticlesByCategory((prev) => {
      if ((prev[category]?.length ?? 0) === 0) {
        return prev;
      }

      return {
        ...prev,
        [category]: [],
      };
    });
  }, []);

  const handleCategoryChange = useCallback(
    (category: string) => {
      setGridArticleCount(null);

      if (currentView === "globe") {
        resetGlobeCategory(category);
      }

      setActiveCategory(category);
    },
    [currentView, resetGlobeCategory],
  );

  const handleViewChange = useCallback(
    (view: ViewMode) => {
      setGridArticleCount(null);

      if (view === "globe") {
        resetGlobeCategory(activeCategory);
      }

      setCurrentView(view);
    },
    [activeCategory, resetGlobeCategory],
  );

  useEffect(() => {
    if (currentView !== "globe") return

    const loadCategory = async () => {
      abortStream(true);

      try {
        await startStream({
          category: activeCategory === 'all' ? undefined : activeCategory
        });
      } catch (error) {
        console.error('Failed to load articles:', error);
      }
    };

    void loadCategory();
  }, [abortStream, activeCategory, currentView, startStream]);

  const loading =
    currentView === "globe"
      ? streamHook.status === "starting" ||
        streamHook.status === "loading" ||
        streamHook.status.startsWith("retrying-") ||
        (streamHook.isStreaming && (articlesByCategory[activeCategory]?.length ?? 0) === 0)
      : browseIndexLoading


  const handleClearNotification = (id: string) => {
    const notificationToClear = notifications.find(n => n.id === id);
    if (notificationToClear?.type === "error") {
      streamHook.removeError(notificationToClear.description);
    }
  };

  const handleClearAllNotifications = () => {
    streamHook.clearErrors();
  };

  const handleNotificationAction = (
    actionType: NotificationActionType,
    notification?: Notification
  ) => {
    if (actionType === "open-debug") {
      router.push("/debug");
      setShowNotifications(false);
      return;
    }

    if (actionType === "retry") {
      if (notification?.type === "error") {
        streamHook.removeError(notification.description);
      }
      streamHook.clearErrors();
      handleRetry();
      setShowNotifications(false);
    }
  };

  const notifications: Notification[] = [];
  const notificationTimestamp = new Date().toISOString();
  const notificationCategoryLabel =
    activeCategory === "all" ? "All" : activeCategory;

  if (streamHook.status === "starting" || streamHook.status === "loading") {
    notifications.push({
      id: "stream-progress",
      title: "Stream in progress",
      description: streamHook.currentMessage || "Loading sources and articles.",
      type: "info",
      timestamp: notificationTimestamp,
      meta: {
        category: notificationCategoryLabel,
        sources: `${streamHook.progress.completed}/${streamHook.progress.total}`,
      },
    });
  }

  if (streamHook.status === "complete") {
    notifications.push({
      id: "stream-complete",
      title: "Stream complete",
      description: streamHook.currentMessage || "Articles are ready to read.",
      type: "success",
      timestamp: notificationTimestamp,
      meta: {
        articles: streamHook.articles.length,
        sources: streamHook.sources.length,
      },
    });
  }

  if (streamHook.status === "cancelled") {
    notifications.push({
      id: "stream-cancelled",
      title: "Stream paused",
      description: "Stream cancelled. Restart to refresh the feed.",
      type: "warning",
      timestamp: notificationTimestamp,
      action: { label: "Retry", type: "retry" },
    });
  }

  streamHook.errors.forEach((error, index) => {
    notifications.push({
      id: `error-${index}`,
      title: error === "Stream was cancelled" ? "Stream status" : "Stream error",
      description: error,
      type: "error",
      timestamp: notificationTimestamp,
      action: { label: "Retry", type: "retry" },
    });
  });

  if (isFilterActive()) {
    notifications.push({
      id: "filter-active",
      title: "Source filter active",
      description: "Only selected sources are visible.",
      type: "info",
      timestamp: notificationTimestamp,
      meta: {
        sources: selectedSources.size,
      },
      action: { label: "Debug", type: "open-debug" },
    });
  }

  if (browseIndexError) {
    notifications.push({
      id: "browse-index-error",
      title: "Browse path unavailable",
      description: browseIndexError.message,
      type: "error",
      timestamp: notificationTimestamp,
      action: { label: "Retry", type: "retry" },
    });
  }

  if (!loading && activeViewArticles.length === 0) {
    notifications.push({
      id: "empty-feed",
      title: "No articles found",
      description: "Try changing filters or refreshing the stream.",
      type: "warning",
      timestamp: notificationTimestamp,
      action: { label: "Retry", type: "retry" },
    });
  }

  const actionableNotificationCount = notifications.filter(
    (item) => item.type === "error" || item.type === "warning"
  ).length;

  const leadArticle = activeViewArticles[0] ?? null
  const articleCount =
    currentView === "globe"
      ? streamHook.articles.length
      : currentView === "grid"
        ? gridArticleCount ?? (browseIndexTotalCount || browseArticles.length)
        : browseIndexTotalCount || browseArticles.length

  const handleRetry = () => {
    if (currentView === "globe") {
      resetGlobeCategory(activeCategory);
      void startStream({
        category: activeCategory === 'all' ? undefined : activeCategory 
      });
      return;
    }

    void refetchBrowseIndex();
  };

  const handleSearchSubmit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    const trimmed = searchQuery.trim()
    if (!trimmed) return
    router.push(`/search?query=${encodeURIComponent(trimmed)}`)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const leadSummary = leadArticle?.summary?.trim() || "Story summary unavailable."
  const activeCategoryMeta = categories.find((category) => category.id === activeCategory)
  const leadCategoryLabel = activeCategoryMeta?.label ?? (activeCategory === "all" ? "All" : activeCategory)
  const leadCredibility = leadArticle?.credibility ? leadArticle.credibility.toUpperCase() : "UNKNOWN"
  const leadBias = leadArticle?.bias ? leadArticle.bias.replace("-", " ").toUpperCase() : "UNKNOWN"
  const viewLabel = currentView.charAt(0).toUpperCase() + currentView.slice(1)
  const isGlobeView = currentView === "globe"

  return (
    <div className="min-h-screen flex bg-[var(--news-bg-primary)] text-foreground">
      <HalftoneOverlay />
      {/* Loading state */}
      {(currentView === "globe"
        ? (loading || (streamHook.isStreaming && articlesByCategory[activeCategory]?.length === 0))
        : (loading && activeViewArticles.length === 0)) && (
        <div className="fixed bottom-4 left-4 sm:bottom-8 sm:left-8 z-[100] pointer-events-none">
          <div className="pointer-events-auto w-64 overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-secondary)]/90 p-4 shadow-2xl backdrop-blur-xl transition-all duration-500 animate-in slide-in-from-bottom-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-primary">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {currentView === "globe" ? "Live ingest" : "Loading"}
                </span>
                {currentView === "globe" && streamHook.progress.total > 0 && (
                  <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                    {streamHook.progress.completed}/{streamHook.progress.total}
                  </span>
                )}
              </div>
              <h3 className="mt-3 font-serif text-sm font-medium text-foreground">
                {currentView === "globe" ? "Refreshing news index..." : "Loading articles..."}
              </h3>
            </div>
          </div>
        </div>
      )}


      <aside className="group hidden lg:flex w-16 hover:w-64 shrink-0 border-r border-white/10 bg-[var(--news-bg-secondary)] sticky top-0 h-screen flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] z-50 overflow-hidden">
        <div className="px-4 py-5 border-b border-white/10 min-w-[16rem]">
          <div className="flex items-center gap-4">
            <img src="/favicon.svg" alt="Scoop" className="w-12 h-12 text-[#b88f4d] shrink-0 transition-all duration-300 group-hover:scale-105 -ml-2 group-hover:ml-0" />
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground">Scoop</div>
              <div className="font-serif text-xl font-semibold tracking-tight text-foreground/90">Dashboard</div>
            </div>
          </div>
        </div>
        <div className="px-3 py-4 border-b border-white/10 min-w-[16rem]">
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 mb-2 px-1">Search</div>
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-4 h-4 text-muted-foreground shrink-0 z-10" />
            <input
              type="text"
              placeholder="Search workspace..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchSubmit}
              className="w-full bg-[var(--news-bg-primary)] border border-white/10 pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-6 space-y-8 min-w-[16rem] no-scrollbar">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-2 mb-3">Views</div>
            <div className="space-y-1">
              {[
                { key: "globe", label: "Globe", Icon: Globe },
                { key: "grid", label: "Grid", Icon: Grid3X3 },
                { key: "scroll", label: "Scroll", Icon: Scroll },
                { key: "blindspot", label: "Blindspot", Icon: ArrowRightLeft },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => handleViewChange(key as ViewMode)}
                  className={`w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] transition-all duration-200 ${
                    currentView === key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                  title={label}
                >
                  <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-2 mb-3">Filters</div>
            <div className="space-y-1">
              <button
                onClick={() => router.push("/saved")}
                className="w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
                title="Saved"
              >
                <Bookmark className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Saved</span>
              </button>
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
                title="Sources"
              >
                <SlidersHorizontal className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Sources</span>
              </button>
            </div>
          </div>

        </div>
        <div className="px-3 py-4 border-t border-white/10 min-w-[16rem]">
          <button
            ref={alertsButtonRef}
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
            title="Alerts"
          >
            <div className="relative shrink-0 flex items-center justify-center">
              <Bell className="w-5 h-5" strokeWidth={1.5} />
              {actionableNotificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {actionableNotificationCount}
                </span>
              )}
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Alerts</span>
          </button>
        </div>
      </aside>

      {showNotifications && (
        <NotificationsPopup
          notifications={notifications}
          onClear={handleClearNotification}
          onClearAll={handleClearAllNotifications}
          onAction={handleNotificationAction}
          onClose={() => setShowNotifications(false)}
          anchorRef={alertsButtonRef}
        />
      )}

      <div className={cn("flex-1 flex flex-col min-w-0", currentView === "scroll" ? "h-screen overflow-hidden" : "")}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--news-bg-primary)]/95 backdrop-blur">
        <div className="flex flex-nowrap items-center justify-between gap-1.5 px-2 py-2 sm:px-6 sm:py-3 overflow-x-auto no-scrollbar">
          <div className="flex min-w-0 items-center gap-1.5 lg:hidden shrink-0">
            <select
              value={currentView}
              onChange={(event) => handleViewChange(event.target.value as ViewMode)}
              className="w-auto border border-white/10 bg-[var(--news-bg-secondary)] px-2 py-1.5 h-8 text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-foreground focus:outline-none focus:border-primary rounded-md"
              aria-label="Select view"
            >
              {VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-widest px-2 py-1.5 h-8 shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1 sm:mr-2" />
              Sources
            </Button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 sm:ml-auto">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm" className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-widest px-2 py-1.5 h-8 shrink-0">
              <Link href="/saved">
                <Bookmark className="w-3.5 h-3.5 mr-1 sm:mr-2" />
                Saved
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-widest px-2 py-1.5 h-8 shrink-0">
              <Link href="/search">
                <Search className="w-3.5 h-3.5 mr-1 sm:mr-2" />
                Research
              </Link>
            </Button>
            {debugMode && (
              <Button asChild variant="outline" size="sm" className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-widest px-2 py-1.5 h-8 shrink-0">
                <Link href="/debug">
                  <Bug className="w-3.5 h-3.5 mr-1 sm:mr-2" />
                  Debug
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className={cn("flex-1 bg-[var(--news-bg-primary)]", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden" : "")}>
        <div className={cn("max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-0", (currentView === "scroll" || currentView === "globe") ? "h-full" : "")}>

              <section className={cn(
            "lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col border-x border-white/10",
            (currentView === "scroll" || isGlobeView) ? "h-full overflow-hidden" : "min-h-[calc(100vh-80px)]"
          )}>
            {!isGlobeView && currentView !== "scroll" && (
              <div className="relative p-6 border-b border-white/10">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
                style={{ filter: "url(#halftone-pattern)" }}
              />
              <div className="flex flex-col gap-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.4em] bg-primary/10 text-primary border-primary/30">
                        Lead
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/60 tracking-wider">
                        {leadArticle ? formatDate(leadArticle.publishedAt) : "Updating feed"}
                      </span>
                    </div>
                    
                    <h2 className="font-serif text-3xl sm:text-5xl leading-[1.1] font-semibold tracking-tight mb-4">
                      {leadArticle?.title || "Loading coverage..."}
                    </h2>
                    
                    <p className="max-w-3xl text-base sm:text-lg text-foreground/70 leading-relaxed font-serif italic line-clamp-2">
                      {leadSummary}
                    </p>
                  </div>

                  <div className="shrink-0 flex flex-col gap-1 w-full sm:w-64 lg:w-72">
                    <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/10 overflow-hidden">
                      <div className="bg-[var(--news-bg-secondary)] p-2.5 space-y-1">
                        <span className="block text-[8px] font-mono uppercase tracking-widest text-muted-foreground/50">Articles</span>
                        <span className="block text-sm font-semibold tabular-nums">{articleCount}</span>
                      </div>
                      <div className="bg-[var(--news-bg-secondary)] p-2.5 space-y-1">
                        <span className="block text-[8px] font-mono uppercase tracking-widest text-muted-foreground/50">Sources</span>
                        <span className="block text-sm font-semibold tabular-nums">
                          {selectedSources.size > 0 ? selectedSources.size : "All"}
                        </span>
                      </div>
                      <div className="bg-[var(--news-bg-secondary)] p-2.5 space-y-1">
                        <span className="block text-[8px] font-mono uppercase tracking-widest text-muted-foreground/50">Bias</span>
                        <span className="block text-xs font-semibold text-primary/80 uppercase tracking-tighter">{leadBias}</span>
                      </div>
                      <div className="bg-[var(--news-bg-secondary)] p-2.5 space-y-1">
                        <span className="block text-[8px] font-mono uppercase tracking-widest text-muted-foreground/50">Signal</span>
                        <span className="block text-xs font-semibold text-foreground/90 uppercase tracking-tighter">{leadCredibility}</span>
                      </div>
                    </div>
                    <div className="px-1 py-1 text-[9px] text-muted-foreground/50 italic leading-tight">
                      {leadArticle?.summary
                        ? "Source metadata available for this story."
                        : "Lead coverage loading..."}
                    </div>
                  </div>
                </div>
              </div>
              </div>
            )}

            <Tabs value={activeCategory} onValueChange={handleCategoryChange} className={cn("flex-1 flex flex-col", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden" : "")}>
              {currentView !== "scroll" && currentView !== "globe" && (
                <div className="px-6 py-5 border-b border-white/5 bg-white/[0.01]">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <h3 className="font-serif text-xl sm:text-2xl uppercase font-black tracking-tight text-foreground/90 whitespace-nowrap">
                        {VIEW_OPTIONS.find(v => v.value === currentView)?.label} View
                      </h3>
                      <div className="h-4 w-px bg-white/10 hidden sm:block" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50 whitespace-nowrap">
                        {articleCount} articles indexed
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded-sm bg-white/[0.03] p-1 border border-white/5">
                        <span className="px-2 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40">Category</span>
                        <select
                          value={activeCategory}
                          onChange={(event) => handleCategoryChange(event.target.value)}
                          className="border-none bg-transparent px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-foreground/80 focus:ring-0 cursor-pointer"
                        >
                          {categories.map((category) => (
                            <option key={category.id} value={category.id} className="bg-[#0a0a0a]">
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 rounded-sm bg-white/[0.03] p-1 border border-white/5">
                        <span className="px-2 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40">Sort</span>
                        <select
                          value={currentView === "grid" && gridMode === "topic" ? topicSortMode : sortMode}
                          onChange={(event) => {
                            const value = event.target.value
                            if (currentView === "grid" && gridMode === "topic") {
                              setTopicSortMode(value as typeof topicSortMode)
                            } else {
                              setSortMode(value as typeof sortMode)
                            }
                          }}
                          className="border-none bg-transparent px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-foreground/80 focus:ring-0 cursor-pointer"
                        >
                          {currentView === "grid" && gridMode === "topic" ? (
                            <>
                              <option value="sources" className="bg-[#0a0a0a]">Sources</option>
                              <option value="articles" className="bg-[#0a0a0a]">Articles</option>
                              <option value="recent" className="bg-[#0a0a0a]">Recent</option>
                            </>
                          ) : (
                            <>
                              <option value="favorites" className="bg-[#0a0a0a]">Favorites</option>
                              <option value="newest" className="bg-[#0a0a0a]">Newest</option>
                            </>
                          )}
                        </select>
                      </div>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSidebarOpen(true)}
                        className="h-8 border-white/5 bg-white/[0.03] text-[9px] font-mono uppercase tracking-widest px-3"
                      >
                        Sources
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {categories.map((category) => (
                <TabsContent key={category.id} value={category.id} className={cn("mt-0 flex-1", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden flex flex-col" : "")}>
                  {activeCategory === category.id && (
                    <>
                      {currentView === "globe" && (
                        <GlobeView key={`${category.id}-globe`} articles={globeArticles} loading={loading} />
                      )}
                      {currentView === "grid" && (
                        <GridView
                          articles={browseArticles}
                          loading={loading}
                          onCountChange={setGridArticleCount}
                          apiUrl={apiUrl}
                          showTrending={true}
                          topicSortMode={topicSortMode}
                          viewMode={gridMode}
                          onViewModeChange={setGridMode}
                          isScrollMode={false}
                          totalCount={browseIndexTotalCount}
                        />
                      )}
                       {currentView === "scroll" && (
                          <FeedView
                            key={`${category.id}-scroll`}
                            articles={browseArticles}
                            loading={loading}
                            totalCount={browseIndexTotalCount}
                            debugMode={debugMode}
                          />
                        )}
                      {currentView === "blindspot" && (
                        <BlindspotView
                          key={`${category.id}-blindspot`}
                          category={activeCategory}
                          sources={selectedSourceIds}
                        />
                      )}
                    </>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </section>
        </div>
      </main>


      </div>
      {/* Source Sidebar */}
      <SourceSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sourceRecency={sourceRecency}
      />

      <ArticleDetailModal
        article={leadArticle}
        isOpen={leadModalOpen}
        onClose={() => setLeadModalOpen(false)}
      />

      {/* Footer removed as per request */}
    </div>
  )
}

export default function Page() {
  return (
    <ErrorBoundary>
      <NewsPage />
    </ErrorBoundary>
  );
}
