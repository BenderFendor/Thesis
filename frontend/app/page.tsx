"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
  Building2,
  Gamepad2,
  Shirt,
  Palette,
  Laptop,
  Trophy,
  Newspaper,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GridView } from "@/components/grid-view"
import { FeedView } from "@/components/feed-view"
import { ListView } from "@/components/list-view"
import { ArticleDetailModal } from "@/components/article-detail-modal"

const GlobeView = dynamic(() => import("@/components/globe-view"), {
  ssr: false,
  loading: () => <Skeleton className="h-[400px] w-full" />,
})

import { useNewsStream } from "@/hooks/useNewsStream"
import { useFavorites } from "@/hooks/useFavorites"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCategories, NewsArticle } from "@/lib/api"
import { isDebugMode, logger } from "@/lib/logger"
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationsPopup, Notification, type NotificationActionType } from '@/components/notification-popup';
import { SourceSidebar } from "@/components/source-sidebar";

type ViewMode = "globe" | "grid" | "scroll" | "list"

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

  // New: State for articles per category to avoid reloading on view switches
  // Initialize with default structure to enable parallel fetching
  const [articlesByCategory, setArticlesByCategory] = useState<Record<string, NewsArticle[]>>({
    all: [],
    politics: [],
    technology: [],
    sports: [],
    general: [],
    business: [],
    entertainment: [],
    health: [],
    science: [],
  })
  const [loading, setLoading] = useState(true)
  const [apiUrl, setApiUrl] = useState<string | null>(null)
  const router = useRouter()

  // Source filtering and favorites
  const { favorites, isFavorite } = useFavorites()
  const { selectedSources, isFilterActive, isSelected } = useSourceFilter()

  // Fetch categories in background, don't block stream
  useEffect(() => {
    const getCategories = async () => {
      try {
        const backendCategories = await fetchCategories();
        const allCategories = ["all", ...backendCategories].map(cat => ({
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

  const sourceRecency = useMemo(() => {
    const recency: Record<string, number> = {};
    const articles = articlesByCategory[activeCategory] || [];
    for (const article of articles) {
      const sourceKey = article.sourceId || article.source;
      if (!sourceKey) continue;
      const ts = new Date(article.publishedAt).getTime();
      if (!Number.isNaN(ts) && (!recency[sourceKey] || ts > recency[sourceKey])) {
        recency[sourceKey] = ts;
      }
    }
    return recency;
  }, [articlesByCategory, activeCategory]);

  /**
   * Filter and sort articles by favorites and source selection
   */
  const filterAndSortArticles = useCallback(
    (articles: NewsArticle[]): NewsArticle[] => {
      // Apply source filter if active
      let filtered = articles;
      if (isFilterActive()) {
        filtered = articles.filter((article) =>
          isSelected(article.sourceId)
        );
      }

      const items = [...filtered];
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
    [isFilterActive, isSelected, isFavorite, sortMode]
  );

  const streamHook = useNewsStream({
    onUpdate,
    onComplete,
    onError,
    autoStart: false
  });



  useEffect(() => {
    // Only run when activeCategory changes
    const loadCategory = async () => {
      if (streamHook.isStreaming) {
        streamHook.abortStream(true);
      }

      setLoading(true);
      setArticlesByCategory(prev => ({ ...prev, [activeCategory]: [] }));
      
      try {
        await streamHook.startStream({
          category: activeCategory === 'all' ? undefined : activeCategory
        });
      } catch (error) {
        console.error('Failed to load articles:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCategory();
  }, [activeCategory]); // Only depend on activeCategory

  useEffect(() => {
    if (streamHook.apiUrl) {
      setApiUrl(streamHook.apiUrl);
    }
  }, [streamHook.apiUrl]);


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

  const filteredArticles = useMemo(() => {
    return filterAndSortArticles(articlesByCategory[activeCategory] || [])
  }, [articlesByCategory, activeCategory, filterAndSortArticles])

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
          sources: selectedSources.length,
        },
        action: { label: "Debug", type: "open-debug" },
      });
    }

    if (!loading && filteredArticles.length === 0) {
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
    selectedSources.length,
    loading,
    filteredArticles.length,
  ]);

  const actionableNotificationCount = useMemo(
    () =>
      notifications.filter(
        (item) => item.type === "error" || item.type === "warning"
      ).length,
    [notifications]
  );

  useEffect(() => {
    if (filteredArticles.length > 0) {
      setLeadArticle(filteredArticles[0])
    } else {
      setLeadArticle(null)
    }
  }, [filteredArticles])

  const handleRetry = () => {
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
      {(loading || (streamHook.isStreaming && articlesByCategory[activeCategory]?.length === 0)) && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--news-bg-primary)]/95 backdrop-blur">
          <div className="relative w-[min(420px,90vw)] overflow-hidden rounded-none border border-white/10 bg-[var(--news-bg-secondary)] p-8 shadow-2xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.3em] text-primary">
                  Live ingest
                </span>
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  {streamHook.progress.completed}/{streamHook.progress.total}
                </span>
              </div>
              <h3 className="mt-6 font-serif text-2xl text-foreground">Refreshing the news index</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {streamHook.currentMessage || "Scanning global sources and clustering coverage."}
              </p>
              <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-muted/40">
                <div className="h-full w-1/2 animate-[shimmer_2s_infinite] bg-gradient-to-r from-primary/20 via-primary/60 to-primary/20" />
              </div>
              {streamHook.retryCount > 0 && (
                <div className="mt-4 rounded-none border border-white/10 bg-[var(--news-bg-primary)]/50 px-3 py-2 text-xs text-muted-foreground">
                  Retry attempt {streamHook.retryCount}/{streamHook.maxRetries}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      <aside className="hidden lg:flex w-60 shrink-0 border-r border-white/10 bg-[var(--news-bg-secondary)] sticky top-0 h-screen flex-col">
        <div className="px-4 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-primary" strokeWidth={1.4} />
            <div>
              <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-muted-foreground">Scoop</div>
              <div className="font-serif text-lg font-semibold tracking-tight">Dashboard</div>
            </div>
          </div>
        </div>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Search</div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search research workspace..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchSubmit}
              className="w-full bg-[var(--news-bg-primary)] border border-white/10 px-9 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Views</div>
            <div className="mt-3 space-y-2">
              {[
                { key: "globe", label: "Globe", Icon: Globe },
                { key: "grid", label: "Grid", Icon: Grid3X3 },
                { key: "scroll", label: "Scroll", Icon: Scroll },
                { key: "list", label: "List", Icon: List },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setCurrentView(key as ViewMode)}
                  className={`w-full flex items-center gap-3 px-3 py-2 border border-white/10 text-[10px] font-mono uppercase tracking-[0.32em] transition-colors ${
                    currentView === key
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "text-muted-foreground hover:text-foreground hover:border-white/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Filters</div>
            <div className="mt-3 space-y-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-2 border border-white/10 text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground hover:text-foreground hover:border-white/30 transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Sources
              </button>
            </div>
          </div>

        </div>
        <div className="px-4 py-4 border-t border-white/10">
          <button
            ref={alertsButtonRef}
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-full flex items-center gap-3 px-3 py-2 border border-white/10 text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground hover:text-foreground hover:border-white/30 transition-colors"
          >
            <div className="relative">
              <Bell className="w-4 h-4" />
              {actionableNotificationCount > 0 && (
                <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground">
                  {actionableNotificationCount}
                </span>
              )}
            </div>
            Alerts
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

      <div className="flex-1 flex flex-col min-w-0">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--news-bg-primary)]/95 backdrop-blur">
        <div className="flex items-center justify-end px-6 py-3 gap-2">
          <Button asChild variant="outline" size="sm" className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]">
            <Link href="/search">
              <Search className="w-3.5 h-3.5 mr-2" />
              Research
            </Link>
          </Button>
          {debugMode && (
            <Button asChild variant="outline" size="sm" className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]">
              <Link href="/sources/debug">
                <Bug className="w-3.5 h-3.5 mr-2" />
                Source Debug
              </Link>
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 bg-[var(--news-bg-primary)]">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-0">

          <section className="lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col min-h-[calc(100vh-80px)] border-x border-white/10">
            {!isGlobeView && (
              <div className="relative p-6 border-b border-white/10">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
                style={{ filter: "url(#halftone-pattern)" }}
              />
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.32em] bg-primary/10 text-primary border-primary/40">
                    Lead Story
                  </span>
                  <span className="px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.32em] text-muted-foreground border-white/10">
                    {leadCategoryLabel}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {leadArticle ? formatDate(leadArticle.publishedAt) : "Updating feed"}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <h2 className="font-serif text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-4 line-clamp-3">
                    {leadArticle?.title || "Loading coverage..."}
                  </h2>
                  <p className="text-base md:text-lg text-foreground/80 leading-relaxed font-serif italic line-clamp-3">
                    {leadSummary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => leadArticle && setLeadModalOpen(true)}
                      className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]"
                    >
                      Open analysis
                    </Button>
                    <Link href="/search">
                      <Button variant="outline" size="sm" className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]">
                        Research workspace
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSidebarOpen(true)}
                      className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]"
                    >
                      Filter sources
                    </Button>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="border border-white/10 bg-[var(--news-bg-secondary)] p-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground">
                      <span>Coverage Snapshot</span>
                      <span className="text-primary">{viewLabel}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Articles</div>
                        <div className="text-sm font-semibold">{articleCount}</div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sources</div>
                        <div className="text-sm font-semibold">
                          {selectedSources.size > 0 ? selectedSources.size : "All"}
                        </div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Favorites</div>
                        <div className="text-sm font-semibold">{favorites.size}</div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Bias</div>
                        <div className="text-sm font-semibold">{leadBias}</div>
                      </div>
                    </div>
                  </div>
                  <div className="border border-white/10 bg-[var(--news-bg-secondary)] p-4 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between font-mono uppercase tracking-[0.32em] text-[10px]">
                      <span>Lead Signal</span>
                      <span className="text-primary">{leadCredibility}</span>
                    </div>
                    <p className="mt-2 text-foreground/70 line-clamp-3">
                      {leadArticle?.summary
                        ? "Evidence markers and source metadata are available for this story."
                        : "Lead coverage is loading. Evidence and source metadata appear once ready."}
                    </p>
                  </div>
                </div>
              </div>
              </div>
            )}

            <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value)} className="flex-1 flex flex-col overflow-hidden">
              <div className="px-8 py-6 border-b border-white/10">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <h3 className="font-serif text-2xl uppercase font-black tracking-tight">The Index</h3>
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                      {articleCount} articles
                    </span>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground">
                  <span>Category</span>
                  {!isGlobeView && (
                    <span className="text-muted-foreground/70">Use category filters to compare coverage.</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={activeCategory}
                    onChange={(event) => setActiveCategory(event.target.value)}
                    className="min-w-[220px] border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.32em] text-foreground focus:outline-none focus:border-primary"
                    aria-label="Select category"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
                    className="min-w-[220px] border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.32em] text-foreground focus:outline-none focus:border-primary"
                    aria-label="Select sort order"
                  >
                    <option value="favorites">Favorites, newest</option>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="source-freshness">Sources by freshness</option>
                  </select>

                  <div className="flex items-center gap-2 lg:hidden">
                    <span className="text-[10px] font-mono uppercase tracking-[0.32em] text-muted-foreground">View</span>
                    <select
                      value={currentView}
                      onChange={(event) => setCurrentView(event.target.value as ViewMode)}
                      className="border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.32em] text-foreground focus:outline-none focus:border-primary"
                      aria-label="Select view"
                    >
                      <option value="globe">Globe</option>
                      <option value="grid">Grid</option>
                      <option value="scroll">Scroll</option>
                      <option value="list">List</option>
                    </select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSidebarOpen(true)}
                    className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 mr-2" />
                    Sources
                  </Button>
                </div>
              </div>
              {categories.map((category) => (
                <TabsContent key={category.id} value={category.id} className="mt-0 flex-1 overflow-hidden flex flex-col">
                  {currentView === "globe" && (
                    <GlobeView key={`${category.id}-globe`} articles={filterAndSortArticles(articlesByCategory[category.id] || [])} loading={loading} />
                  )}
                  {currentView === "grid" && (
                    <GridView
                      articles={filterAndSortArticles(articlesByCategory[activeCategory] || [])}
                      loading={loading}
                      onCountChange={setArticleCount}
                      apiUrl={apiUrl}
                      showTrending={true}
                    />
                  )}
                  {currentView === "scroll" && (
                    <FeedView key={`${category.id}-scroll`} articles={filterAndSortArticles(articlesByCategory[category.id] || [])} loading={loading} />
                  )}
                  {currentView === "list" && (
                    <ListView key={`${category.id}-list`} articles={filterAndSortArticles(articlesByCategory[category.id] || [])} loading={loading} />
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
