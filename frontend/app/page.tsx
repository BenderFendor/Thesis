"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Globe,
  Grid3X3,
  Scroll,
  List,
  Search,
  Menu,
  Bell,
  Bug,
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
import { GlobeView } from "@/components/globe-view"
import { GridView } from "@/components/grid-view"
import { FeedView } from "@/components/feed-view"
import { ListView } from "@/components/list-view"
import { ArticleDetailModal } from "@/components/article-detail-modal"

import { useNewsStream } from "@/hooks/useNewsStream"
import { useFavorites } from "@/hooks/useFavorites"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCategories, NewsArticle } from "@/lib/api"
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

const HeaderHint = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="relative group">
    {children}
    <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded border border-border/60 bg-[var(--news-bg-secondary)] px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
      {label}
    </div>
  </div>
);

function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("grid")
  const [categories, setCategories] = useState<{ id: string; label: string; icon: React.ElementType }[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [articleCount, setArticleCount] = useState<number>(0)
  const [showNotifications, setShowNotifications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [leadArticle, setLeadArticle] = useState<NewsArticle | null>(null);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // New: State for articles per category to avoid reloading on view switches
  const [articlesByCategory, setArticlesByCategory] = useState<Record<string, NewsArticle[]>>({})
  const [loading, setLoading] = useState(false)
  const [apiUrl, setApiUrl] = useState<string | null>(null)
  const router = useRouter()

  // Source filtering and favorites
  const { favorites, isFavorite } = useFavorites()
  const { selectedSources, isFilterActive, isSelected } = useSourceFilter()

  useEffect(() => {
    const getCategories = async () => {
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
    };
    getCategories();
  }, []);

  const activeCategoryRef = useRef(activeCategory);
  activeCategoryRef.current = activeCategory;

  const onUpdate = useCallback((newArticles: NewsArticle[]) => {
    console.log(`onUpdate called with ${newArticles.length} articles for category: ${activeCategoryRef.current}`);
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

      // Sort: favorites first, then by date (newest first)
      filtered.sort((a, b) => {
        const aIsFav = isFavorite(a.sourceId) ? 0 : 1;
        const bIsFav = isFavorite(b.sourceId) ? 0 : 1;

        if (aIsFav !== bIsFav) return aIsFav - bIsFav;

        // Secondary sort: by published date (newest first)
        return (
          new Date(b.publishedAt).getTime() -
          new Date(a.publishedAt).getTime()
        );
      });

      return filtered;
    },
    [isFilterActive, isSelected, isFavorite]
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
    <div className="min-h-screen flex flex-col bg-[var(--news-bg-primary)] text-foreground">
      <HalftoneOverlay />
      {/* Loading state */}
      {(loading || (streamHook.isStreaming && articlesByCategory[activeCategory]?.length === 0)) && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--news-bg-primary)]/95 backdrop-blur">
          <div className="relative w-[min(420px,90vw)] overflow-hidden rounded-2xl border border-border/60 bg-[var(--news-bg-secondary)] p-8 shadow-2xl">
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
                <div className="mt-4 rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/50 px-3 py-2 text-xs text-muted-foreground">
                  Retry attempt {streamHook.retryCount}/{streamHook.maxRetries}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      <header className="sticky top-0 z-50 border-b border-border/60 bg-[var(--news-bg-primary)]/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative">
                <Globe className="w-6 h-6 text-primary transition-transform duration-500 group-hover:rotate-12" strokeWidth={1.5} />
                <div className="absolute inset-0 border border-primary/30 rounded-full scale-150 animate-ping opacity-20 pointer-events-none" />
              </div>
              <div>
                <h1 className="font-serif text-2xl font-semibold tracking-tight">Scoop</h1>
                <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-muted-foreground mt-1">
                  Multi-perspective news
                </p>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-6 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              <button
                className={`flex items-center gap-2 pb-1 border-b ${
                  currentView === "globe" ? "text-primary border-primary" : "border-transparent hover:text-foreground"
                }`}
                onClick={() => setCurrentView("globe")}
              >
                <Globe className="w-3 h-3" />
                Globe
              </button>
              <button
                className={`flex items-center gap-2 pb-1 border-b ${
                  currentView === "grid" ? "text-primary border-primary" : "border-transparent hover:text-foreground"
                }`}
                onClick={() => setCurrentView("grid")}
              >
                <Grid3X3 className="w-3 h-3" />
                Grid
              </button>
              <button
                className={`flex items-center gap-2 pb-1 border-b ${
                  currentView === "scroll" ? "text-primary border-primary" : "border-transparent hover:text-foreground"
                }`}
                onClick={() => setCurrentView("scroll")}
              >
                <Scroll className="w-3 h-3" />
                Scroll
              </button>
              <button
                className={`flex items-center gap-2 pb-1 border-b ${
                  currentView === "list" ? "text-primary border-primary" : "border-transparent hover:text-foreground"
                }`}
                onClick={() => setCurrentView("list")}
              >
                <List className="w-3 h-3" />
                List
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 md:hidden">
              <Button
                variant={currentView === "globe" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("globe")}
                className="h-8 w-8 p-0"
              >
                <Globe className="w-4 h-4" />
              </Button>
              <Button
                variant={currentView === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("grid")}
                className="h-8 w-8 p-0"
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={currentView === "scroll" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("scroll")}
                className="h-8 w-8 p-0"
              >
                <Scroll className="w-4 h-4" />
              </Button>
              <Button
                variant={currentView === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("list")}
                className="h-8 w-8 p-0"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
            <div className="relative hidden lg:block group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <input
                type="text"
                placeholder="Search the research desk..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchSubmit}
                className="bg-[var(--news-bg-secondary)] border border-border/60 rounded-lg pl-9 pr-4 py-2 text-xs w-60 focus:outline-none focus:border-primary transition-colors text-foreground placeholder:text-muted-foreground/70"
              />
              <div className="pointer-events-none absolute left-0 top-full mt-2 rounded border border-border/60 bg-[var(--news-bg-secondary)] px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                Press Enter to open research workspace
              </div>
            </div>
            <div className="flex items-center gap-1 lg:hidden">
              <Link href="/search">
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 border border-border/60" title="Research">
                  <Search className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/sources/debug">
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 border border-border/60" title="Source Debug">
                  <Bug className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                <Link href="/search">
                  <Search className="w-3.5 h-3.5 mr-2" />
                  Research
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                <Link href="/sources/debug">
                  <Bug className="w-3.5 h-3.5 mr-2" />
                  Source Debug
                </Link>
              </Button>
            </div>
            <HeaderHint label="Filter sources">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(true)}
                className="h-9 w-9 p-0 border border-border/60"
                title="Filter sources"
              >
                <Menu className="w-4 h-4" />
              </Button>
            </HeaderHint>
            <HeaderHint label="Alerts">
              <Button variant="ghost" size="sm" className="relative h-9 w-9 p-0 border border-border/60" onClick={() => setShowNotifications(!showNotifications)}>
                <Bell className="w-4 h-4" />
                {actionableNotificationCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 w-4 h-4 p-0 flex items-center justify-center text-[10px] bg-destructive">
                    {actionableNotificationCount}
                  </Badge>
                )}
              </Button>
            </HeaderHint>
            {showNotifications && (
              <NotificationsPopup
                notifications={notifications}
                onClear={handleClearNotification}
                onClearAll={handleClearAllNotifications}
                onAction={handleNotificationAction}
              />
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-px bg-border/40">
          <section className="lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col min-h-[calc(100vh-80px)]">
            {!isGlobeView && (
              <div className="relative p-8 border-b border-border/60">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
                style={{ filter: "url(#halftone-pattern)" }}
              />
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-sm border font-mono text-[9px] uppercase tracking-[0.2em] bg-primary/10 text-primary border-primary/20">
                    Lead Story
                  </span>
                  <span className="px-2 py-0.5 rounded-sm border font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground border-border/60">
                    {leadCategoryLabel}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {leadArticle ? formatDate(leadArticle.publishedAt) : "Updating feed"}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <h2 className="font-serif text-3xl md:text-5xl font-semibold tracking-tight leading-[0.98] mb-4 line-clamp-3">
                    {leadArticle?.title || "Loading coverage..."}
                  </h2>
                  <p className="text-base md:text-lg text-foreground/80 leading-snug font-serif italic line-clamp-3">
                    {leadSummary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => leadArticle && setLeadModalOpen(true)}
                      className="border-border/60 bg-transparent text-xs"
                    >
                      Open analysis
                    </Button>
                    <Link href="/search">
                      <Button variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                        Research workspace
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSidebarOpen(true)}
                      className="border-border/60 bg-transparent text-xs"
                    >
                      Filter sources
                    </Button>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] p-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                      <span>Desk Snapshot</span>
                      <span className="text-primary">{viewLabel}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded border border-border/40 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Articles</div>
                        <div className="text-sm font-semibold">{articleCount}</div>
                      </div>
                      <div className="rounded border border-border/40 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Sources</div>
                        <div className="text-sm font-semibold">
                          {selectedSources.size > 0 ? selectedSources.size : "All"}
                        </div>
                      </div>
                      <div className="rounded border border-border/40 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Favorites</div>
                        <div className="text-sm font-semibold">{favorites.size}</div>
                      </div>
                      <div className="rounded border border-border/40 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Bias</div>
                        <div className="text-sm font-semibold">{leadBias}</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] p-4 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between font-mono uppercase tracking-[0.3em] text-[10px]">
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
              <div className="px-8 py-6 border-b border-border/60">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <h3 className="font-serif text-2xl uppercase font-black tracking-tight">The Index</h3>
                    <div className="flex-1 h-px bg-border/60" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                      {articleCount} articles
                    </span>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                  <span>Category filters</span>
                  {!isGlobeView && (
                    <span className="text-muted-foreground/70">Hover the Desk tab on the right for context and verification</span>
                  )}
                </div>
                <TabsList className="flex flex-wrap gap-2 bg-transparent p-0 h-auto">
                  {categories.map((category) => (
                    <TabsTrigger
                      key={category.id}
                      value={category.id}
                      className="font-mono text-[10px] uppercase tracking-[0.3em] border border-border/60 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-primary/10 px-3 py-2 rounded-sm"
                    >
                      {category.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
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


      {/* Source Sidebar */}
      <SourceSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

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
