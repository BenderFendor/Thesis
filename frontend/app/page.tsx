"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type TouchEvent } from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  Grid3X3,
  Search,
  Bookmark,
  Building2,
  Gamepad2,
  Shirt,
  Palette,
  Laptop,
  Trophy,
  Newspaper,
  Loader2,
  Bell,
} from "lucide-react"
import { GlobalNavigation, type ViewMode } from "@/components/global-navigation"
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

import { useDebugMode } from "@/hooks/useDebugMode"
import { useFavorites } from "@/hooks/useFavorites"
import { useLiveBrowseIndex } from "@/hooks/useLiveBrowseIndex"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCacheStatus, fetchCategories, NewsArticle } from "@/lib/api"
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationsPopup, Notification, type NotificationActionType } from '@/components/notification-popup';
import { SourceSidebar } from "@/components/source-sidebar";
import { cn } from "@/lib/utils";
import {
  GRID_VIEW_MODE_STORAGE_KEY,
  getStoredGridViewMode,
  isGridViewMode,
} from "@/lib/view-mode-storage"
import {
  getSharedArticleCount,
  getSharedSourceCount,
  getSharedViewArticles,
  getSharedViewLoading,
} from "@/lib/news-view-state";
import {
  useDismissedNotifications,
} from "@/lib/notification-state";

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "globe", label: "Globe" },
  { value: "grid", label: "Grid" },
  { value: "scroll", label: "Scroll" },
  { value: "blindspot", label: "Blindspot" },
]

const MOBILE_VIEW_OPTIONS = VIEW_OPTIONS

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
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const alertsButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const debugMode = useDebugMode();
  const [sortMode, setSortMode] = useState<"favorites" | "newest" | "oldest" | "source-freshness">("favorites");
  const [topicSortMode, setTopicSortMode] = useState<"sources" | "articles" | "recent">("sources");
  const [gridMode, setGridMode] = useState<"source" | "topic">(getStoredGridViewMode);

  const router = useRouter()

  // Source filtering and favorites
  const { isFavorite } = useFavorites()
  const { selectedSources, isFilterActive } = useSourceFilter()
  const selectedSourceIds = useMemo(() => Array.from(selectedSources), [selectedSources])

  const {
    articles: browseIndexArticles,
    totalCount: browseIndexTotalCount,
    isLoading: browseIndexLoading,
    error: browseIndexError,
    refetch: refetchBrowseIndex,
  } = useLiveBrowseIndex({
    category: activeCategory === "all" ? undefined : activeCategory,
    sources: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
    enabled: true,
  })
  const { data: cacheStatus } = useQuery({
    queryKey: ["news", "cache-status"],
    queryFn: fetchCacheStatus,
    staleTime: 5 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: false,
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
      if (event.key === GRID_VIEW_MODE_STORAGE_KEY && isGridViewMode(event.newValue)) {
        setGridMode(event.newValue)
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
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

  const browseArticles = useMemo(() => sortArticles(browseIndexArticles), [browseIndexArticles, sortArticles])
  const activeViewArticles = getSharedViewArticles(currentView, browseArticles)

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

  const handleCategoryChange = useCallback(
    (category: string) => {
      setActiveCategory(category);
    },
    [],
  );

  const handleViewChange = useCallback(
    (view: ViewMode) => {
      setCurrentView(view);
    },
    [],
  );

  const moveView = useCallback((direction: 1 | -1) => {
    setCurrentView((view) => {
      const currentIndex = VIEW_OPTIONS.findIndex((option) => option.value === view)
      const nextIndex = Math.min(
        VIEW_OPTIONS.length - 1,
        Math.max(0, currentIndex + direction),
      )
      return VIEW_OPTIONS[nextIndex]?.value ?? view
    })
  }, [])

  const handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, [])

  const handleTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return

    moveView(deltaX < 0 ? 1 : -1)
  }, [moveView])
  const loading = getSharedViewLoading(browseIndexLoading)
  const filterActive = isFilterActive()
  const notifications = useMemo(() => {
    const next: Notification[] = []
    const notificationTimestamp = new Date().toISOString()
    const notificationCategoryLabel =
      activeCategory === "all" ? "All" : activeCategory

    if (browseIndexLoading) {
      next.push({
        id: "live-index-loading",
        title: "Live index loading",
        description: "Loading current live articles.",
        type: "info",
        timestamp: notificationTimestamp,
        meta: {
          category: notificationCategoryLabel,
        },
      })
    }

    if (filterActive) {
      next.push({
        id: "filter-active",
        title: "Source filter active",
        description: "Only selected sources are visible.",
        type: "info",
        timestamp: notificationTimestamp,
        meta: {
          sources: selectedSources.size,
        },
        action: { label: "Debug", type: "open-debug" },
      })
    }

    if (browseIndexError) {
      next.push({
        id: "browse-index-error",
        title: "Browse path unavailable",
        description: browseIndexError.message,
        type: "error",
        timestamp: notificationTimestamp,
        action: { label: "Retry", type: "retry" },
      })
    }

    if (!loading && activeViewArticles.length === 0) {
      next.push({
        id: "empty-feed",
        title: "No articles found",
        description: "Try changing filters or refreshing the live feed.",
        type: "warning",
        timestamp: notificationTimestamp,
        action: { label: "Retry", type: "retry" },
      })
    }

    return next
  }, [
    activeCategory,
    activeViewArticles.length,
    browseIndexError,
    browseIndexLoading,
    filterActive,
    loading,
    selectedSources.size,
  ])
  const {
    visibleNotifications,
    dismissOne: handleClearNotification,
    dismissAll: handleClearAllNotifications,
  } = useDismissedNotifications(notifications)
  const actionableNotificationCount = visibleNotifications.filter(
    (item) => item.type === "error" || item.type === "warning"
  ).length;

  const leadArticle = activeViewArticles[0] ?? null
  const articleCount = getSharedArticleCount(
    cacheStatus,
    browseIndexTotalCount,
    browseArticles,
    loading,
  )
  const sourceCount = getSharedSourceCount(cacheStatus, browseArticles, loading)

  const handleRetry = () => {
    void refetchBrowseIndex();
  };

  const handleNotificationAction = (
    actionType: NotificationActionType,
    notification?: Notification
  ) => {
    void notification
    if (actionType === "open-debug") {
      router.push("/debug");
      setShowNotifications(false);
      return;
    }

    if (actionType === "retry") {
      handleRetry();
      setShowNotifications(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const leadSummary = leadArticle?.summary?.trim() || "Story summary unavailable."
  const leadCredibility = leadArticle?.credibility ? leadArticle.credibility.toUpperCase() : "UNKNOWN"
  const leadBias = leadArticle?.bias ? leadArticle.bias.replace("-", " ").toUpperCase() : "UNKNOWN"
  const isGlobeView = currentView === "globe"
  const isBlindspotView = currentView === "blindspot"

  return (
    <div className="min-h-screen overflow-x-hidden flex bg-[var(--news-bg-primary)] text-foreground">
      <HalftoneOverlay />
      {/* Loading state */}
      {loading && activeViewArticles.length === 0 && (
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
      )}


      <GlobalNavigation
        currentView={currentView}
        onViewChange={handleViewChange}
        onAlertsClick={() => setShowNotifications(!showNotifications)}
        alertCount={actionableNotificationCount}
      />

      {showNotifications && (
        <NotificationsPopup
          notifications={visibleNotifications}
          onClear={handleClearNotification}
          onClearAll={handleClearAllNotifications}
          onAction={handleNotificationAction}
          onClose={() => setShowNotifications(false)}
          anchorRef={alertsButtonRef}
        />
      )}

      <div className={cn("flex-1 flex flex-col min-w-0", currentView === "scroll" ? "h-screen overflow-hidden" : "")}>
        <header
          className={cn(
            "z-40 px-3 py-3 backdrop-blur sm:px-4 lg:sticky lg:top-0 lg:border-b-0 lg:bg-[var(--news-bg-primary)]/95 lg:px-6 lg:py-4 supports-[backdrop-filter]:lg:bg-[var(--news-bg-primary)]/80",
            isGlobeView
              ? "absolute inset-x-0 top-0 border-b-0 bg-transparent"
              : "sticky top-0 border-b border-white/5 bg-[var(--news-bg-primary)]/95 supports-[backdrop-filter]:bg-[var(--news-bg-primary)]/80",
          )}
        >
          <div className={cn(
            "flex min-w-0 flex-col lg:flex-row lg:items-center lg:justify-between",
            isGlobeView ? "gap-2" : "gap-3",
          )}>
            <div
              className={cn(
                "flex items-center justify-between lg:justify-start lg:gap-6",
                "absolute right-3 top-2 z-10 lg:static",
              )}
            >
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
                <span className={cn(
                  "hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50 sm:inline",
                  isGlobeView && "lg:inline",
                )}>
                  {articleCount} articles indexed
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2 lg:hidden">
                <Button
                  ref={alertsButtonRef}
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowNotifications(!showNotifications)}
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
                  onClick={() => handleViewChange(option.value)}
                  className={cn(
                    "shrink-0 border-b px-0.5 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                    currentView === option.value
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground/70",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </nav>

            <div
              className={cn(
                "flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end lg:gap-3",
                isGlobeView ? "gap-1.5" : "gap-2",
              )}
            >
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center">
                <div className={cn(
                  "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
                  isGlobeView && "bg-black/25 backdrop-blur-xl",
                )}>
                  <span className={cn(
                    "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
                    isGlobeView && "sr-only sm:not-sr-only",
                  )}>Category</span>
                  <select
                    value={activeCategory}
                    onChange={(event) => handleCategoryChange(event.target.value)}
                    className={cn(
                      "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
                      isGlobeView ? "py-0.5" : "py-1",
                    )}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id} className="bg-[#0a0a0a]">
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={cn(
                  "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
                  isGlobeView && "bg-black/25 backdrop-blur-xl",
                )}>
                  <span className={cn(
                    "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
                    isGlobeView && "sr-only sm:not-sr-only",
                  )}>Sort</span>
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
                    className={cn(
                      "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
                      isGlobeView ? "py-0.5" : "py-1",
                    )}
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
              </div>

              <div className={cn("grid grid-cols-3 gap-2 sm:flex sm:items-center", isGlobeView && "gap-1.5")}>
                <div className="hidden h-4 w-px bg-white/10 lg:block" />
                <div className="contents lg:flex lg:items-center lg:gap-1.5">
                  <div className="hidden lg:block">
                    <ThemeToggle />
                  </div>
                  <Button asChild variant="outline" size="sm" className={cn(
                    "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
                    isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
                  )}>
                    <Link href="/saved">
                      <Bookmark className="mr-1.5 h-3.5 w-3.5" />
                      Saved
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className={cn(
                    "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
                    isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
                  )}>
                    <Link href="/search">
                      <Search className="mr-1.5 h-3.5 w-3.5" />
                      Research
                    </Link>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSidebarOpen(true)}
                  className={cn(
                    "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
                    isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
                  )}
                >
                  Sources
                </Button>
              </div>
            </div>
          </div>
        </header>

      <main className={cn("flex-1 min-w-0 bg-[var(--news-bg-primary)]", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden" : "")}>
        <div
          className={cn("w-full grid grid-cols-1 lg:grid-cols-12 gap-0", (currentView === "scroll" || currentView === "globe") ? "h-full" : "")}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >

              <section className={cn(
            "lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col",
            (currentView === "scroll" || isGlobeView) ? "h-full overflow-hidden" : "min-h-[calc(100vh-80px)]"
          )}>
            {!isGlobeView && currentView !== "scroll" && (
              <div className={cn("relative p-3 sm:p-6", isBlindspotView && "hidden lg:block")}>
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
                style={{ filter: "url(#halftone-pattern)" }}
              />
              <div className="flex flex-col gap-3 sm:gap-6">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="mb-2 flex items-center gap-2 sm:mb-3 sm:gap-3">
                      <span className="border bg-primary/10 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.28em] text-primary border-primary/30 sm:text-[9px] sm:tracking-[0.4em]">
                        Lead
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground/60 tracking-wider sm:text-[10px]">
                        {leadArticle ? formatDate(leadArticle.publishedAt) : "Updating feed"}
                      </span>
                    </div>
                    
                    <h2 className="mb-2 line-clamp-3 font-serif text-2xl font-semibold leading-tight tracking-tight sm:mb-4 sm:text-5xl">
                      {leadArticle?.title || "Loading coverage..."}
                    </h2>
                    
                    <p className="max-w-3xl text-sm leading-snug text-foreground/65 font-serif italic line-clamp-2 sm:text-lg sm:leading-relaxed">
                      {leadSummary}
                    </p>
                  </div>

                  <div className="shrink-0 flex flex-col gap-1 w-full sm:w-64 lg:w-72">
                    <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/10 overflow-hidden">
                      <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
                        <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">Live articles</span>
                        <span className="block text-sm font-semibold tabular-nums">{articleCount}</span>
                      </div>
                      <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
                        <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">Live sources</span>
                        <span className="block text-sm font-semibold tabular-nums">{sourceCount}</span>
                      </div>
                      <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
                        <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">Bias</span>
                        <span className="block text-xs font-semibold text-primary/80 uppercase tracking-tighter">{leadBias}</span>
                      </div>
                      <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
                        <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">Signal</span>
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

              {categories.map((category) => (
                <TabsContent key={category.id} value={category.id} className={cn("mt-0 flex-1", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden flex flex-col" : "")}>
                  {activeCategory === category.id && (
                    <>
                      {currentView === "globe" && (
                        <GlobeView key={`${category.id}-globe`} articles={browseArticles} loading={loading} />
                      )}
                      {currentView === "grid" && (
                        <GridView
                          articles={browseArticles}
                          loading={loading}
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
