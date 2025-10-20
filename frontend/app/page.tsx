"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Globe,
  Grid3X3,
  Scroll,
  Settings,
  Bell,
  User,
  Building2,
  Gamepad2,
  Shirt,
  Palette,
  Laptop,
  Trophy,
  Activity,
  Newspaper,
  Sparkles,
  Brain,
  Filter,
} from "lucide-react"
import Link from "next/link"
import { GlobeView } from "@/components/globe-view"
import { GridView } from "@/components/grid-view"
import { FeedView } from "@/components/feed-view"
import { AutoHideHeader } from "@/components/auto-hide-header"

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

function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("grid")
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [categories, setCategories] = useState<{ id: string; label: string; icon: React.ElementType }[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [articleCount, setArticleCount] = useState<number>(0)
  const [headerHidden, setHeaderHidden] = useState<boolean>(false)
  const [isScrollingDown, setIsScrollingDown] = useState<boolean>(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const headerHeightRef = useRef<number>(0)
  const navHeightRef = useRef<number>(0)
  const lastScrollY = useRef<number>(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const ticking = useRef<boolean>(false)
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // New: State for articles per category to avoid reloading on view switches
  const [articlesByCategory, setArticlesByCategory] = useState<Record<string, NewsArticle[]>>({})
  const [loading, setLoading] = useState(false)
  const [apiUrl, setApiUrl] = useState<string | null>(null)

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
    console.error(`❌ Stream error for ${activeCategoryRef.current}:`, error);
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

  useEffect(() => {
    const header = headerRef.current
    const nav = navRef.current
    
    if (header) {
      headerHeightRef.current = header.getBoundingClientRect().height
    }
    if (nav) {
      navHeightRef.current = nav.getBoundingClientRect().height
    }

    const updateScrollState = () => {
      const currentScrollY = window.scrollY
      const scrollDelta = currentScrollY - lastScrollY.current
      const scrollThreshold = 10
      const hideThreshold = Math.max(headerHeightRef.current + navHeightRef.current + 50, 150)
      const documentHeight = document.body.offsetHeight
      const windowHeight = window.innerHeight

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      // Determine scroll direction with more sensitivity
      if (Math.abs(scrollDelta) > scrollThreshold) {
        const scrollingDown = scrollDelta > 0
        setIsScrollingDown(scrollingDown)
      }

      // Header/Nav visibility logic
      // Show at very top (first 100px)
      if (currentScrollY <= 100) {
        setHeaderHidden(false)
      }
      // Hide when scrolling in the middle content area
      else if (currentScrollY > hideThreshold) {
        setHeaderHidden(true)
      }
      // Show when near bottom
      else if (currentScrollY >= documentHeight - windowHeight - 200) {
        setHeaderHidden(false)
      }

      // Auto-show header temporarily when scroll stops (for navigation)
      scrollTimeoutRef.current = setTimeout(() => {
        // Only auto-show if user stopped scrolling in middle area and not actively scrolling down
        if (currentScrollY > hideThreshold && !isScrollingDown) {
          // Don't auto-show - keep it clean while reading articles
        }
      }, 2000)

      lastScrollY.current = currentScrollY
      ticking.current = false
    }

    const onScroll = () => {
      if (!ticking.current) {
        requestAnimationFrame(updateScrollState)
        ticking.current = true
      }
    }

    const onResize = () => {
      if (header) headerHeightRef.current = header.getBoundingClientRect().height
      if (nav) navHeightRef.current = nav.getBoundingClientRect().height
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [isScrollingDown])

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

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
      {/* Enhanced Loading state */}
      {(loading || (streamHook.isStreaming && articlesByCategory[activeCategory]?.length === 0)) && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--news-bg-primary)' }}>
          <div className="relative
            before:absolute before:inset-0 before:bg-gradient-to-r before:from-emerald-500/20 before:to-transparent before:animate-[shimmer_2s_infinite] before:rounded-full
            after:absolute after:inset-0 after:bg-gradient-to-r after:from-emerald-500/10 after:via-emerald-500/20 after:to-emerald-500/10 after:animate-[shimmer_2s_infinite] after:rounded-full
            after:blur-xl
            before:blur-xl
            ">
            <div className="relative z-10 p-8 rounded-2xl border shadow-2xl backdrop-blur-sm" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div className="w-16 h-16 border-4 rounded-full" style={{ borderColor: 'var(--muted)' }}></div>
                  <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-emerald-400 rounded-full animate-spin"></div>
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-emerald-400">
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
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Auto-hiding header with scroll detection */}
      <AutoHideHeader />

  {/* Category navigation removed per request */}

      {/* Main Content - Full Height for Virtual Scrolling */}
      <main className="flex flex-col flex-1 h-[calc(100vh)] overflow-hidden">
        {/* Compact header with article count and view toggle */}
        <div className="px-3 sm:px-4 lg:px-6 py-2 border-b border-border/50">
          <div className="flex items-center justify-between gap-4 mb-0">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-2xl font-bold font-serif text-foreground">News Grid</h2>
            </div>

            <div className="flex items-center gap-3">
            {/* Article count */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex text-sm px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--card)', color: 'var(--muted-foreground)' }}>
                {articleCount} article{articleCount === 1 ? '' : 's'}
              </span>
            </div>

            {/* Sources Sidebar Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="gap-2"
              title="Filter by sources"
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Sources</span>
            </Button>

            {/* View Toggle */}
            <div className="flex items-center gap-2 rounded-lg p-1" style={{ backgroundColor: 'var(--muted)' }}>
              <Button
                variant={currentView === "globe" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("globe")}
                className="gap-2"
              >
                <Globe className="w-4 h-4" />
                Globe
              </Button>
              <Button
                variant={currentView === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("grid")}
                className="gap-2"
              >
                <Grid3X3 className="w-4 h-4" />
                Grid
              </Button>
              <Button
                variant={currentView === "scroll" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCurrentView("scroll")}
                className="gap-2"
              >
                <Scroll className="w-4 h-4" />
                Feed
              </Button>
            </div>

            {/* User Actions */}
            <div className="flex items-center gap-2">
              <Link href="/search">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Brain className="w-4 h-4" />
                  Research
                </Button>
              </Link>
              <Link href="/sources">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Activity className="w-4 h-4" />
                  Sources
                </Button>
              </Link>
              <Button variant="ghost" size="sm" className="relative" onClick={() => setShowNotifications(!showNotifications)}>
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <Badge className="absolute -top-1 -right-1 w-4 h-4 p-0 flex items-center justify-center text-xs bg-destructive">{notifications.length}</Badge>
                )}
              </Button>
              {showNotifications && <NotificationsPopup notifications={notifications} onClear={handleClearNotification} onClearAll={handleClearAllNotifications} onRetry={handleRetryNotification} />}
              <Link href="/settings">
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/profile">
                <Button variant="ghost" size="sm">
                  <User className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
        </div>

        <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value)} className="flex-1 flex flex-col overflow-hidden">
          {categories.map((category) => {
            const IconComponent = category.icon
            return (
              <TabsContent key={category.id} value={category.id} className="mt-0 flex-1 overflow-hidden">
                {/* Content Views - Pass articles as props */}
                <>
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
                  {currentView === "scroll" && <FeedView key={`${category.id}-scroll`} articles={filterAndSortArticles(articlesByCategory[category.id] || [])} loading={loading} />}
                </>
              </TabsContent>
            )
          })}
        </Tabs>
      </main>

      {/* Source Sidebar */}
      <SourceSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

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
