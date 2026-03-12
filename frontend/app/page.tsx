"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  Globe,
  Grid3X3,
  Scroll,
  List,
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
import { ListView } from "@/components/list-view"
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
import { useFavorites } from "@/hooks/useFavorites"
import { usePaginatedNews } from "@/hooks/usePaginatedNews"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCategories, NewsArticle } from "@/lib/api"
import { isDebugMode, logger } from "@/lib/logger"
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationsPopup, Notification, type NotificationActionType } from '@/components/notification-popup';
import { SourceSidebar } from "@/components/source-sidebar";
import { cn } from "@/lib/utils";
import { FEATURE_FLAGS } from "@/lib/constants"

type ViewMode = "globe" | "grid" | "scroll" | "list"

const GRID_SOURCE_PAGE_SIZE = 500
const ARTICLE_PAGE_SIZE = FEATURE_FLAGS.PAGINATION_PAGE_SIZE
const SCROLL_PAGE_SIZE = 500

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "globe", label: "Globe" },
  { value: "grid", label: "Grid" },
  { value: "scroll", label: "Scroll" },
  { value: "list", label: "List" },
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
  const [categories, setCategories] = useState<{ id: string; label: string; icon: React.ElementType }[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [articleCount, setArticleCount] = useState<number>(0)
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
// Remove trendingOpen state as it is no longer used
// const [trendingOpen, setTrendingOpen] = useState(false);
  const alertsButtonRef = useRef<HTMLButtonElement>(null);
  const [leadArticle, setLeadArticle] = useState<NewsArticle | null>(null);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debugMode, setDebugModeState] = useState(false);
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
  const [loading, setLoading] = useState(true)
  const [apiUrl, setApiUrl] = useState<string | null>(null)
  const router = useRouter()

  // Source filtering and favorites
  const { favorites, isFavorite } = useFavorites()
  const { selectedSources, isFilterActive, isSelected } = useSourceFilter()
  const selectedSourceIds = useMemo(() => Array.from(selectedSources), [selectedSources])
  const usePaginatedBrowse = currentView !== "globe"
  const browsePageSize = currentView === "scroll"
    ? SCROLL_PAGE_SIZE
    : currentView === "grid" && gridMode === "source"
      ? GRID_SOURCE_PAGE_SIZE
      : ARTICLE_PAGE_SIZE

  const {
    articles: paginatedArticles,
    totalCount: paginatedTotalCount,
    isLoading: paginatedLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: paginatedError,
    refetch: refetchPaginatedNews,
  } = usePaginatedNews({
    limit: browsePageSize,
    category: activeCategory === "all" ? undefined : activeCategory,
    sources: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
    useCached: true,
    enabled: usePaginatedBrowse,
  })

  // Fetch categories in background, don't block stream
  useEffect(() => {
    const getCategories = async () => {
      try {
        const backendCategories = await fetchCategories();
        // Deduplicate categories to prevent duplicate React keys
        const uniqueCategories = Array.from(new Set(["all", ...backendCategories]));
        const allCategories = uniqueCategories.map(cat => ({
          id: cat,
          label: cat.charAt(0).toUpperCase() + cat.slice(1),
          icon: categoryIcons[cat] || Newspaper,
        }));
        setCategories(allCategories);
        setArticlesByCategory(
          allCategories.reduce((acc, cat) => ({ ...acc, [cat.id]: [] }), {})
        );
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    };
    getCategories();
  }, []);

  useEffect(() => {
    setDebugModeState(isDebugMode());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "thesis_debug_mode") {
        setDebugModeState(isDebugMode());
      }
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
  activeCategoryRef.current = activeCategory;

  const onUpdate = useCallback((newArticles: NewsArticle[]) => {
    logger.debug(`onUpdate called with ${newArticles.length} articles for category: ${activeCategoryRef.current}`);
    setArticlesByCategory(prev => ({
      ...prev,
      [activeCategoryRef.current]: newArticles
    }));
    setLoading(false);
  }, []);

  const onComplete = useCallback((result: { articles: NewsArticle[] }) => {
    setLoading(false);
    setArticleCount(result.articles.length);
  }, []);

  const onError = useCallback((error: string) => {
    console.error(`Stream error for ${activeCategoryRef.current}:`, error);
    setLoading(false);
  }, []);

  const sortArticles = useCallback(
    (articles: NewsArticle[]): NewsArticle[] => {
      const items = [...articles];
      const sourceFreshness = sortMode === "source-freshness";
      const localRecency: Record<string, number> | null = sourceFreshness
        ? items.reduce((acc, article) => {
            const key = article.sourceId || article.source;
            if (!key) return acc;
            const ts = new Date(article.publishedAt).getTime();
            if (!Number.isNaN(ts) && (!acc[key] || ts > acc[key])) {
              acc[key] = ts;
            }
            return acc;
          }, {} as Record<string, number>)
        : null;

      const getTime = (value: string) => {
        const ts = new Date(value).getTime();
        return Number.isNaN(ts) ? 0 : ts;
      };

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

        const aTime = getTime(a.publishedAt);
        const bTime = getTime(b.publishedAt);

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

  const browseArticles = useMemo(() => sortArticles(paginatedArticles), [paginatedArticles, sortArticles])

  const activeViewArticles = currentView === "globe" ? globeArticles : browseArticles

  const sourceRecency = useMemo(() => {
    const articles = activeViewArticles
    if (!articles || articles.length === 0) return {}

    const recency: Record<string, number> = {}
    for (const article of articles) {
      const sourceKey = article.sourceId || article.source
      if (!sourceKey) continue
      const ts = new Date(article.publishedAt).getTime()
      if (!Number.isNaN(ts) && (!recency[sourceKey] || ts > recency[sourceKey])) {
        recency[sourceKey] = ts
      }
    }
    return recency
  }, [activeViewArticles])

  const streamHook = useNewsStream({
    onUpdate,
    onComplete,
    onError,
    autoStart: false
  });

  const streamIsActiveRef = useRef(streamHook.isStreaming);
  const abortStreamRef = useRef(streamHook.abortStream);
  const startStreamRef = useRef(streamHook.startStream);

  useEffect(() => {
    streamIsActiveRef.current = streamHook.isStreaming;
    abortStreamRef.current = streamHook.abortStream;
    startStreamRef.current = streamHook.startStream;
  }, [streamHook.isStreaming, streamHook.abortStream, streamHook.startStream]);

  useEffect(() => {
    if (currentView !== "globe") return

    const loadCategory = async () => {
      if (streamIsActiveRef.current) {
        abortStreamRef.current(true);
      }

      setLoading(true);
      setArticlesByCategory(prev => ({ ...prev, [activeCategory]: [] }));
      
      try {
        await startStreamRef.current({
          category: activeCategory === 'all' ? undefined : activeCategory
        });
      } catch (error) {
        console.error('Failed to load articles:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCategory();
  }, [activeCategory, currentView]);

  useEffect(() => {
    if (streamHook.apiUrl) {
      setApiUrl(streamHook.apiUrl);
    }
  }, [streamHook.apiUrl]);

  useEffect(() => {
    if (currentView === "globe") {
      setLoading(streamHook.isStreaming || articlesByCategory[activeCategory]?.length === 0)
      return
    }

    setLoading(paginatedLoading)
  }, [currentView, streamHook.isStreaming, articlesByCategory, activeCategory, paginatedLoading])

  useEffect(() => {
    if (currentView === "globe") return
    setArticleCount(paginatedTotalCount || browseArticles.length)
  }, [browseArticles.length, currentView, paginatedTotalCount])


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

  const notifications = useMemo(() => {
    const items: Notification[] = [];
    const now = new Date().toISOString();
    const categoryLabel = activeCategory === "all" ? "All" : activeCategory;

    if (streamHook.status === "starting" || streamHook.status === "loading") {
      items.push({
        id: "stream-progress",
        title: "Stream in progress",
        description: streamHook.currentMessage || "Loading sources and articles.",
        type: "info",
        timestamp: now,
        meta: {
          category: categoryLabel,
          sources: `${streamHook.progress.completed}/${streamHook.progress.total}`,
        },
      });
    }

    if (streamHook.status === "complete") {
      items.push({
        id: "stream-complete",
        title: "Stream complete",
        description: streamHook.currentMessage || "Articles are ready to read.",
        type: "success",
        timestamp: now,
        meta: {
          articles: streamHook.articles.length,
          sources: streamHook.sources.length,
        },
      });
    }

    if (streamHook.status === "cancelled") {
      items.push({
        id: "stream-cancelled",
        title: "Stream paused",
        description: "Stream cancelled. Restart to refresh the feed.",
        type: "warning",
        timestamp: now,
        action: { label: "Retry", type: "retry" },
      });
    }

    streamHook.errors.forEach((error, index) => {
      items.push({
        id: `error-${index}`,
        title: error === "Stream was cancelled" ? "Stream status" : "Stream error",
        description: error,
        type: "error",
        timestamp: now,
        action: { label: "Retry", type: "retry" },
      });
    });

    if (isFilterActive()) {
      items.push({
        id: "filter-active",
        title: "Source filter active",
        description: "Only selected sources are visible.",
        type: "info",
        timestamp: now,
        meta: {
          sources: selectedSources.size,
        },
        action: { label: "Debug", type: "open-debug" },
      });
    }

    if (paginatedError) {
      items.push({
        id: "paginated-error",
        title: "Browse path unavailable",
        description: paginatedError.message,
        type: "error",
        timestamp: now,
        action: { label: "Retry", type: "retry" },
      });
    }

    if (!loading && activeViewArticles.length === 0) {
      items.push({
        id: "empty-feed",
        title: "No articles found",
        description: "Try changing filters or refreshing the stream.",
        type: "warning",
        timestamp: now,
        action: { label: "Retry", type: "retry" },
      });
    }

    return items;
  }, [
    streamHook.status,
    streamHook.currentMessage,
    streamHook.progress.completed,
    streamHook.progress.total,
    streamHook.errors,
    streamHook.articles.length,
    streamHook.sources.length,
    activeCategory,
    isFilterActive,
    selectedSources.size,
    loading,
    activeViewArticles.length,
    paginatedError,
  ]);

  const actionableNotificationCount = useMemo(
    () =>
      notifications.filter(
        (item) => item.type === "error" || item.type === "warning"
      ).length,
    [notifications]
  );

  useEffect(() => {
    if (activeViewArticles.length > 0) {
      setLeadArticle(activeViewArticles[0])
    } else {
      setLeadArticle(null)
    }
  }, [activeViewArticles])

  const handleRetry = () => {
    if (currentView === "globe") {
      setArticlesByCategory(prev => ({
        ...prev,
        [activeCategory]: []
      }));
      setLoading(true);
      streamHook.startStream({ 
        category: activeCategory === 'all' ? undefined : activeCategory 
      }).finally(() => {
        setLoading(false);
      });
      return;
    }

    void refetchPaginatedNews();
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
            <Globe className="w-6 h-6 text-primary shrink-0 transition-transform duration-300 group-hover:scale-105" strokeWidth={1.5} />
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground">Scoop</div>
              <div className="font-serif text-xl font-semibold tracking-tight text-foreground/90">Dashboard</div>
            </div>
          </div>
        </div>
        <div className="px-3 py-4 border-b border-white/10 min-w-[16rem]">
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 mb-2 px-1">Search</div>
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 w-4 h-4 text-muted-foreground shrink-0 z-10" />
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
                { key: "list", label: "List", Icon: List },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setCurrentView(key as ViewMode)}
                  className={`w-full flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] transition-all duration-200 ${
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
                className="w-full flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
                title="Saved"
              >
                <Bookmark className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Saved</span>
              </button>
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-full flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
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
            className="w-full flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
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
              onChange={(event) => setCurrentView(event.target.value as ViewMode)}
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.32em] bg-transparent text-primary/70 border-primary/40">
                    Lead Story
                  </span>
                  <span className="px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.32em] bg-transparent text-muted-foreground border-white/10">
                    {leadCategoryLabel}
                  </span>
                </div>
                <span className="font-mono text-[9px] sm:text-[10px] text-muted-foreground">
                  {leadArticle ? formatDate(leadArticle.publishedAt) : "Updating feed"}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <h2 className="font-serif text-[2.5rem] leading-[1.05] sm:text-5xl font-semibold tracking-tight mb-4 line-clamp-3">
                    {leadArticle?.title || "Loading coverage..."}
                  </h2>
                  <p className="text-base sm:text-lg text-foreground/80 leading-relaxed font-serif italic line-clamp-3">
                    {leadSummary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => leadArticle && setLeadModalOpen(true)}
                      className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em]"
                    >
                      Open analysis
                    </Button>
                    <Link href="/search">
                      <Button variant="outline" size="sm" className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em]">
                        Research workspace
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSidebarOpen(true)}
                      className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em]"
                    >
                      Filter sources
                    </Button>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="border border-white/10 bg-[var(--news-bg-secondary)] p-4">
                    <div className="flex flex-row items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground">
                      <span>Coverage Snapshot</span>
                      <span className="text-primary">{viewLabel}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 text-xs">
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground">Articles</div>
                        <div className="text-sm font-semibold">{articleCount}</div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground">Sources</div>
                        <div className="text-sm font-semibold">
                          {selectedSources.size > 0 ? selectedSources.size : "All"}
                        </div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground">Favorites</div>
                        <div className="text-sm font-semibold">{favorites.size}</div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground">Bias</div>
                        <div className="text-sm font-semibold">{leadBias}</div>
                      </div>
                    </div>
                  </div>
                  <div className="border border-white/10 bg-[var(--news-bg-secondary)] p-3 sm:p-4 text-xs text-muted-foreground">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 font-mono uppercase tracking-[0.32em] text-[10px]">
                      <span>Lead Signal</span>
                      <span className="text-primary">{leadCredibility}</span>
                    </div>
                    <p className="mt-2 text-foreground/70 line-clamp-3 text-[11px] sm:text-xs">
                      {leadArticle?.summary
                        ? "Evidence markers and source metadata are available for this story."
                        : "Lead coverage is loading. Evidence and source metadata appear once ready."}
                    </p>
                  </div>
                </div>
              </div>
              </div>
            )}

            <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value)} className={cn("flex-1 flex flex-col", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden" : "")}>
              {currentView !== "scroll" && currentView !== "globe" && (
                <div className="px-4 py-4 sm:px-8 sm:py-6 border-b border-white/10">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-4">
                    <div className="flex items-center gap-4">
                      <h3 className="font-serif text-3xl sm:text-2xl uppercase font-black tracking-tight">The Index</h3>
                      <div className="flex-1 h-px bg-white/10 hidden sm:block" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground whitespace-nowrap">
                        {articleCount} articles
                      </span>
                    </div>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground">
                    <span>Category</span>
                    {!isGlobeView && (
                      <span className="text-muted-foreground/70 hidden sm:inline">Use category filters to compare coverage.</span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <select
                            value={activeCategory}
                            onChange={(event) => setActiveCategory(event.target.value)}
                            className="w-full sm:w-auto sm:min-w-[220px] border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2 text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em] text-foreground focus:outline-none focus:border-primary rounded-md"
                            aria-label="Select category"
                          >
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </TooltipTrigger>
                        <TooltipContent>Filter by category</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
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
                            className="w-full sm:w-auto sm:min-w-[220px] border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2 text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em] text-foreground focus:outline-none focus:border-primary rounded-md"
                            aria-label="Select sort order"
                          >
                            {currentView === "grid" && gridMode === "topic" ? (
                              <>
                                <option value="sources">Most sources</option>
                                <option value="articles">Most articles</option>
                                <option value="recent">Newest topics</option>
                              </>
                            ) : (
                              <>
                                <option value="favorites">Favorites, newest</option>
                                <option value="newest">Newest first</option>
                                <option value="oldest">Oldest first</option>
                                <option value="source-freshness">Sources by freshness</option>
                              </>
                            )}
                          </select>
                        </TooltipTrigger>
                        <TooltipContent>
                          {currentView === "grid" && gridMode === "topic" ? "Sort topics" : "Sort articles"}
                        </TooltipContent>
                      </Tooltip>

                      <div className="flex items-center gap-2 lg:hidden w-full sm:w-auto">
                        <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground whitespace-nowrap shrink-0">View</span>
                        <select
                          value={currentView}
                          onChange={(event) => setCurrentView(event.target.value as ViewMode)}
                          className="flex-1 sm:w-auto border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2 text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em] text-foreground focus:outline-none focus:border-primary rounded-md"
                          aria-label="Select view"
                        >
                          {VIEW_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSidebarOpen(true)}
                            className="border-white/10 bg-transparent text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.32em] w-full sm:w-auto"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 mr-2" />
                            Sources
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Filter sources</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
                          onCountChange={setArticleCount}
                          apiUrl={apiUrl}
                          showTrending={true}
                          topicSortMode={topicSortMode}
                          viewMode={gridMode}
                          onViewModeChange={setGridMode}
                          isScrollMode={false}
                          totalCount={paginatedTotalCount}
                          hasNextPage={hasNextPage}
                          isFetchingNextPage={isFetchingNextPage}
                          fetchNextPage={fetchNextPage}
                        />
                      )}
                       {currentView === "scroll" && (
                         <FeedView
                           key={`${category.id}-scroll`}
                           articles={browseArticles}
                           loading={loading}
                           totalCount={paginatedTotalCount}
                           hasNextPage={hasNextPage}
                           isFetchingNextPage={isFetchingNextPage}
                           fetchNextPage={fetchNextPage}
                           debugMode={debugMode}
                         />
                       )}
                      {currentView === "list" && (
                        <ListView
                          key={`${category.id}-list`}
                          articles={browseArticles}
                          loading={loading}
                          totalCount={paginatedTotalCount}
                          hasNextPage={hasNextPage}
                          isFetchingNextPage={isFetchingNextPage}
                          fetchNextPage={fetchNextPage}
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
