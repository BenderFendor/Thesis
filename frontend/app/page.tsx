"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Globe,
  Grid3X3,
  Scroll,
  Search,
  Menu,
  ChevronRight,
  AlertCircle,
  ExternalLink,
  Settings,
  Bell,
  User,
  Building2,
  Gamepad2,
  Shirt,
  Palette,
  Laptop,
  Trophy,
  Newspaper,
  Brain,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GlobeView } from "@/components/globe-view"
import { GridView } from "@/components/grid-view"
import { FeedView } from "@/components/feed-view"
import { ArticleDetailModal } from "@/components/article-detail-modal"

import { useNewsStream } from "@/hooks/useNewsStream"
import { useFavorites } from "@/hooks/useFavorites"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCategories, NewsArticle } from "@/lib/api"
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationsPopup, Notification } from '@/components/notification-popup';
import { SourceSidebar } from "@/components/source-sidebar";

type ViewMode = "globe" | "grid" | "scroll"

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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bioView, setBioView] = useState<"brief" | "depth">("brief");
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

  useEffect(() => {
    const errorNotifications: Notification[] = streamHook.errors.map((error, index) => ({
      id: `error-${index}`,
      title: error === 'Stream was cancelled' ? 'Stream Status' : 'Stream Error',
      description: error,
      type: 'error',
    }));
    setNotifications(errorNotifications);
  }, [streamHook.errors]);

  const handleClearNotification = (id: string) => {
    const notificationToClear = notifications.find(n => n.id === id);
    if (notificationToClear) {
      streamHook.removeError(notificationToClear.description);
    }
  };

  const handleClearAllNotifications = () => {
    streamHook.clearErrors();
  };

  const handleRetryNotification = (error: string) => {
    streamHook.clearErrors();
    handleRetry();
    setShowNotifications(false);
  };

  const filteredArticles = useMemo(() => {
    return filterAndSortArticles(articlesByCategory[activeCategory] || [])
  }, [articlesByCategory, activeCategory, filterAndSortArticles])

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
      {/* Enhanced Loading state */}
      {(loading || (streamHook.isStreaming && articlesByCategory[activeCategory]?.length === 0)) && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
          <div className="relative before:absolute before:inset-0 before:bg-gradient-to-r before:from-primary/20 before:to-transparent before:animate-[shimmer_2s_infinite] before:rounded-full after:absolute after:inset-0 after:bg-gradient-to-r after:from-primary/10 after:via-primary/20 after:to-primary/10 after:animate-[shimmer_2s_infinite] after:rounded-full after:blur-xl before:blur-xl">
            <div className="relative z-10 p-8 rounded-2xl border shadow-2xl backdrop-blur-sm" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div className="w-16 h-16 border-4 rounded-full" style={{ borderColor: 'var(--muted)' }}></div>
                  <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-primary rounded-full animate-spin"></div>
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-primary">
                    <Newspaper className="w-6 h-6" />
                  </div>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-white">Fetching the latest news</h3>
                <p className="mt-2 text-sm max-w-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
                  {streamHook.currentMessage || 'Scanning global sources...'}
                </p>
                {streamHook.retryCount > 0 && (
                  <div className="mt-4 px-4 py-2 rounded-full border" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--ring)', color: 'var(--ring)' }}>
                    <p className="text-sm">
                      Retry attempt {streamHook.retryCount}/{streamHook.maxRetries}
                    </p>
                  </div>
                )}
                <div className="mt-6 w-48 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--muted)' }}>
                  <div className="h-full bg-gradient-to-r from-primary to-amber-300 animate-pulse"></div>
                </div>
              </div>
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
            </div>
            <div className="relative hidden lg:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <input
                type="text"
                placeholder="Search research..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchSubmit}
                className="bg-[var(--news-bg-secondary)] border border-border/60 rounded-lg pl-9 pr-4 py-2 text-xs w-60 focus:outline-none focus:border-primary transition-colors text-foreground placeholder:text-muted-foreground/70"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9 p-0 border border-border/60"
              title="Filter sources"
            >
              <Menu className="w-4 h-4" />
            </Button>
            <Link href="/search">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 border border-border/60" title="Research">
                <Brain className="w-4 h-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="relative h-9 w-9 p-0 border border-border/60" onClick={() => setShowNotifications(!showNotifications)}>
              <Bell className="w-4 h-4" />
              {notifications.length > 0 && (
                <Badge className="absolute -top-1 -right-1 w-4 h-4 p-0 flex items-center justify-center text-[10px] bg-destructive">
                  {notifications.length}
                </Badge>
              )}
            </Button>
            {showNotifications && <NotificationsPopup notifications={notifications} onClear={handleClearNotification} onClearAll={handleClearAllNotifications} onRetry={handleRetryNotification} />}
            <Link href="/settings">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 border border-border/60" title="Settings">
                <Settings className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/profile">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 border border-border/60" title="Profile">
                <User className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-px bg-border/40">
          <section className={`${isGlobeView ? "lg:col-span-9" : "lg:col-span-8"} bg-[var(--news-bg-primary)] flex flex-col min-h-[calc(100vh-80px)]`}>
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
                <div className="flex items-center gap-4 mb-6">
                  <h3 className="font-serif text-2xl uppercase font-black tracking-tight">The Index</h3>
                  <div className="flex-1 h-px bg-border/60" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    {articleCount} articles
                  </span>
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
                {isGlobeView && (
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                      Desk Actions
                    </span>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Button asChild variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                        <Link href="/search">Research</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                        <Link href="/sources/debug">Source Debug</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                        <Link href="/settings">Settings</Link>
                      </Button>
                    </div>
                  </div>
                )}
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
                </TabsContent>
              ))}
            </Tabs>
          </section>

          <aside className={`${isGlobeView ? "lg:col-span-3" : "lg:col-span-4"} bg-[var(--news-bg-primary)] border-l border-border/60`}>
            <div className="sticky top-24 p-6 space-y-6">
              <div className="group rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] overflow-hidden transition-all duration-500 ease-out">
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <h3 className="font-serif italic text-lg text-primary">Desk Summary</h3>
                    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mt-1">
                      Context and verification
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setBioView("brief")}
                      className={`text-[9px] font-mono uppercase px-2 py-0.5 border ${
                        bioView === "brief"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border/60 text-muted-foreground"
                      }`}
                    >
                      Brief
                    </button>
                    <button
                      onClick={() => setBioView("depth")}
                      className={`text-[9px] font-mono uppercase px-2 py-0.5 border ${
                        bioView === "depth"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border/60 text-muted-foreground"
                      }`}
                    >
                      Depth
                    </button>
                  </div>
                </div>
                <div className="px-5 pb-5 transition-all duration-500 ease-out max-h-0 opacity-0 translate-y-2 group-hover:max-h-[460px] group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:max-h-[460px] group-focus-within:opacity-100 group-focus-within:translate-y-0">
                  <p className="text-sm text-foreground/75 leading-relaxed line-clamp-4">
                    {bioView === "brief"
                      ? "Scoop is a multi-perspective news desk focused on global context, evidence, and transparency. We synthesize sources and surface the signals that matter."
                      : "Scoop combines curated RSS feeds with AI-assisted research to map bias, credibility, and claims across sources. The goal is a newsroom-grade interface that treats context as the headline and makes verification visible."}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded border border-border/50 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                      <div className="text-[10px] uppercase text-muted-foreground">Articles</div>
                      <div className="text-sm font-semibold">{articleCount}</div>
                    </div>
                    <div className="rounded border border-border/50 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                      <div className="text-[10px] uppercase text-muted-foreground">Sources</div>
                      <div className="text-sm font-semibold">
                        {selectedSources.size > 0 ? selectedSources.size : "All"}
                      </div>
                    </div>
                    <div className="rounded border border-border/50 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                      <div className="text-[10px] uppercase text-muted-foreground">Confidence</div>
                      <div className="text-sm font-semibold text-primary">{leadCredibility}</div>
                    </div>
                    <div className="rounded border border-border/50 bg-[var(--news-bg-primary)]/40 px-3 py-2">
                      <div className="text-[10px] uppercase text-muted-foreground">Bias</div>
                      <div className="text-sm font-semibold">{leadBias}</div>
                    </div>
                  </div>
                </div>
              </div>

              {isGlobeView && (
                <div className="group rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] overflow-hidden transition-all duration-500 ease-out">
                  <div className="p-5 flex items-center justify-between">
                    <div>
                      <h3 className="font-serif italic text-lg text-primary">Lead Story</h3>
                      <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mt-1">
                        Spotlight
                      </p>
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                      {leadArticle ? formatDate(leadArticle.publishedAt) : "Updating feed"}
                    </span>
                  </div>
                  <div className="px-5 pb-5 transition-all duration-500 ease-out max-h-0 opacity-0 translate-y-2 group-hover:max-h-[420px] group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:max-h-[420px] group-focus-within:opacity-100 group-focus-within:translate-y-0">
                    <p className="text-sm text-foreground/85 leading-snug line-clamp-3">
                      {leadArticle?.title || "Loading coverage..."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-3">
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
                      <Button asChild variant="outline" size="sm" className="border-border/60 bg-transparent text-xs">
                        <Link href="/search">Research workspace</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className={`group rounded-lg border overflow-hidden transition-all duration-500 ease-out ${leadArticle?.credibility === "low" ? "border-rose-500/40 bg-rose-500/10" : "border-border/60 bg-[var(--news-bg-secondary)]"}`}>
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-primary">
                    <AlertCircle size={16} className={leadArticle?.credibility === "low" ? "text-rose-400" : "text-primary"} />
                    <h4 className="font-mono text-[10px] uppercase tracking-[0.3em]">Verification</h4>
                  </div>
                  <span className="text-[10px] uppercase text-muted-foreground">Status</span>
                </div>
                <div className="px-5 pb-5 transition-all duration-500 ease-out max-h-0 opacity-0 translate-y-2 group-hover:max-h-[360px] group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:max-h-[360px] group-focus-within:opacity-100 group-focus-within:translate-y-0">
                  <p className="text-xs text-foreground/70 leading-relaxed">
                    {leadArticle?.credibility === "low"
                      ? "Variances detected across low-credibility sources. Confirm before sharing."
                      : "Story cross-referenced with cached sources and live feeds. Review evidence for full context."}
                  </p>
                  {leadArticle?.url && (
                    <a
                      href={leadArticle.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 w-full inline-flex items-center justify-center gap-2 py-2 border border-border/60 rounded font-mono text-[10px] uppercase hover:bg-foreground hover:text-primary-foreground transition-colors text-foreground"
                    >
                      Check evidence
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {!isGlobeView && (
                <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] p-4">
                  <h5 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Desk Actions</h5>
                  <div className="mt-3 grid gap-2 text-xs">
                    <Link href="/search" className="flex items-center justify-between rounded border border-border/50 px-3 py-2 hover:border-primary hover:text-primary">
                      <span>Research</span>
                      <ChevronRight size={12} />
                    </Link>
                    <Link href="/sources/debug" className="flex items-center justify-between rounded border border-border/50 px-3 py-2 hover:border-primary hover:text-primary">
                      <span>Source Debug</span>
                      <ChevronRight size={12} />
                    </Link>
                    <Link href="/settings" className="flex items-center justify-between rounded border border-border/50 px-3 py-2 hover:border-primary hover:text-primary">
                      <span>Settings</span>
                      <ChevronRight size={12} />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </aside>
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
