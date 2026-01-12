"use client"

import { useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
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
import { GlobeView } from "@/components/globe-view"
import { GridView } from "@/components/grid-view"
import { FeedView } from "@/components/feed-view"
import { ListView } from "@/components/list-view"
import { ArticleDetailModal } from "@/components/article-detail-modal"

import { useNewsStream } from "@/hooks/useNewsStream"
import { useFavorites } from "@/hooks/useFavorites"
import { useSourceFilter } from "@/hooks/useSourceFilter"
import { fetchCategories, NewsArticle } from "@/lib/api"
import { isDebugMode, logger } from "@/lib/logger"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { NotificationsPopup, Notification, type NotificationActionType } from "@/components/notification-popup"
import { SourceSidebar } from "@/components/source-sidebar"

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
}

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
)

function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("grid")
  const [categories, setCategories] = useState<{ id: string; label: string; icon: React.ElementType }[]>([])
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [articleCount, setArticleCount] = useState<number>(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // const [trendingOpen, setTrendingOpen] = useState(false)
  const alertsButtonRef = useRef<HTMLButtonElement>(null)
  const [leadArticle, setLeadArticle] = useState<NewsArticle | null>(null)
  const [leadModalOpen, setLeadModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [debugMode, setDebugModeState] = useState(false)
  const [sortMode, setSortMode] = useState<"favorites" | "newest" | "oldest" | "source-freshness">("favorites")

  const [articlesByCategory, setArticlesByCategory] = useState<Record<string, NewsArticle[]>>({})
  const [loading, setLoading] = useState(false)
  const [apiUrl, setApiUrl] = useState<string | null>(null)
  const router = useRouter()

  const { favorites, isFavorite } = useFavorites()
  const { selectedSources, isFilterActive, isSelected } = useSourceFilter()

  useEffect(() => {
    const getCategories = async () => {
      const backendCategories = await fetchCategories()
      const allCategories = ["all", ...backendCategories].map((cat) => ({
        id: cat,
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
        icon: categoryIcons[cat] || Newspaper,
      }))
      setCategories(allCategories)
      setArticlesByCategory(allCategories.reduce((acc, cat) => ({ ...acc, [cat.id]: [] }), {}))
    }
    getCategories()
  }, [])

  useEffect(() => {
    setDebugModeState(isDebugMode())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "thesis_debug_mode") {
        setDebugModeState(isDebugMode())
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const streamHook = useNewsStream({
    onUpdate: useCallback(
      (newArticles: NewsArticle[]) => {
        setArticlesByCategory((prev) => ({
          ...prev,
          [activeCategory]: newArticles,
        }))
        setLoading(false)
      },
      [activeCategory],
    ),
    onError: useCallback((error: string) => {
      logger.error("Stream error:", error)
      setLoading(false)
    }, []),
  })

  const filteredArticles = useMemo(() => {
    const articles = articlesByCategory[activeCategory] || []
    if (!articles.length) return []
    if (!isFilterActive) return articles
    return articles.filter((article) => isSelected(article.sourceId))
  }, [activeCategory, articlesByCategory, isFilterActive, isSelected])

  const filterAndSortArticles = useCallback(
    (list: NewsArticle[]) => {
      let filtered = list
      if (isFilterActive) {
        filtered = filtered.filter((article) => isSelected(article.sourceId))
      }

      if (sortMode === "favorites") {
        return filtered.sort((a, b) => {
          const aFav = favorites.has(a.sourceId) ? 1 : 0
          const bFav = favorites.has(b.sourceId) ? 1 : 0
          return bFav - aFav
        })
      }

      const byDate = (a: NewsArticle, b: NewsArticle) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()

      if (sortMode === "newest") {
        return filtered.sort(byDate)
      }

      if (sortMode === "oldest") {
        return filtered.sort((a, b) => -byDate(a, b))
      }

      return filtered
    },
    [favorites, isFilterActive, isSelected, sortMode],
  )

  const notifications = useMemo(() => {
    const items: Notification[] = []
    const now = new Date().toISOString()

    if (streamHook.errors.length) {
      items.push(
        ...streamHook.errors.slice(-3).map((error): Notification => ({
          id: `stream-error-${error.timestamp}`,
          title: "Stream error",
          description: error.message,
          type: "error",
          timestamp: error.timestamp,
          action: { label: "Retry", type: "retry" },
        })),
      )
    }

    if (!loading && !streamHook.isStreaming && filteredArticles.length === 0) {
      items.push({
        id: "empty-feed",
        title: "No articles found",
        description: "Try changing filters or refreshing the stream.",
        type: "warning",
        timestamp: now,
        action: { label: "Retry", type: "retry" },
      })
    }

    return items
  }, [filteredArticles.length, loading, streamHook.errors, streamHook.isStreaming])

  const actionableNotificationCount = useMemo(
    () => notifications.filter((item) => item.type === "error" || item.type === "warning").length,
    [notifications],
  )

  useEffect(() => {
    if (filteredArticles.length > 0) {
      setLeadArticle(filteredArticles[0])
    } else {
      setLeadArticle(null)
    }
  }, [filteredArticles])

  const handleRetry = () => {
    setArticlesByCategory((prev) => ({
      ...prev,
      [activeCategory]: [],
    }))
    setLoading(true)
    streamHook
      .startStream({
        category: activeCategory === "all" ? undefined : activeCategory,
      })
      .finally(() => {
        setLoading(false)
      })
  }

  const handleSearchSubmit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    const trimmed = searchQuery.trim()
    if (!trimmed) return
    router.push(`/search?query=${encodeURIComponent(trimmed)}`)
  }

  const leadSummary = leadArticle?.summary?.trim() || "Story summary unavailable."
  const activeCategoryMeta = categories.find((category) => category.id === activeCategory)
  const leadCategoryLabel = activeCategoryMeta?.label ?? (activeCategory === "all" ? "All" : activeCategory)
  const viewLabel = currentView.charAt(0).toUpperCase() + currentView.slice(1)
  const isGlobeView = currentView === "globe"

  return (
    <div className="min-h-screen flex bg-[var(--news-bg-primary)] text-foreground">
      <HalftoneOverlay />

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

          <div className="mt-4 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchSubmit}
              placeholder="Search the stream"
              className="w-full border border-white/10 bg-[var(--news-bg-primary)]/60 pl-10 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant={sortMode === "favorites" ? "default" : "outline"}
              size="sm"
              onClick={() => setSortMode("favorites")}
              className="text-[10px] font-mono uppercase tracking-[0.3em]"
            >
              Favorites
            </Button>
            <Button
              variant={sortMode === "newest" ? "default" : "outline"}
              size="sm"
              onClick={() => setSortMode("newest")}
              className="text-[10px] font-mono uppercase tracking-[0.3em]"
            >
              Newest
            </Button>
            <Button
              variant={sortMode === "oldest" ? "default" : "outline"}
              size="sm"
              onClick={() => setSortMode("oldest")}
              className="text-[10px] font-mono uppercase tracking-[0.3em]"
            >
              Oldest
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 space-y-2">
            {categories.map((category) => {
              const Icon = category.icon
              const active = category.id === activeCategory

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 border border-white/10 text-left text-xs uppercase tracking-[0.28em] font-mono ${
                    active
                      ? "bg-[var(--news-bg-primary)] text-foreground"
                      : "bg-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" />
                    {category.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{articlesByCategory[category.id]?.length ?? 0}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t border-white/10 p-4 space-y-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="w-full text-[10px] font-mono uppercase tracking-[0.28em]"
          >
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setDebugModeState((prev) => !prev)}
            className="w-full text-[10px] font-mono uppercase tracking-[0.28em]"
          >
            {debugMode ? "Disable" : "Enable"} debug
          </Button>

          <Link
            href="/search"
            className="inline-flex w-full items-center justify-center gap-2 border border-white/10 bg-transparent px-3 py-2 text-[10px] font-mono uppercase tracking-[0.28em] text-muted-foreground hover:text-foreground"
          >
            Research
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <NotificationsPopup
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
          notifications={notifications}
          anchorRef={alertsButtonRef}
          onAction={(action: NotificationActionType) => {
            if (action === "retry") handleRetry()
          }}
        />

        <div className="h-screen flex flex-col">
          <div className="shrink-0 border-b border-white/10 bg-[var(--news-bg-secondary)]">
            <div className="px-6 py-5 flex items-start justify-between gap-6">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.34em] text-muted-foreground">{leadCategoryLabel}</div>
                <div className="mt-2 font-serif text-3xl md:text-4xl leading-tight">
                  {leadArticle ? leadArticle.title : "Loading"}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Newspaper className="w-4 h-4" />
                    {articleCount} articles
                  </span>
                  <span>{viewLabel}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNotifications((prev) => !prev)}
                  ref={alertsButtonRef}
                  className="border-white/10 bg-transparent text-[10px] font-mono uppercase tracking-[0.32em]"
                >
                  <Bell className="w-3.5 h-3.5 mr-2" />
                  Alerts
                  {actionableNotificationCount > 0 && (
                    <span className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                      {actionableNotificationCount}
                    </span>
                  )}
                </Button>

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
          </div>

          <div className="flex-1 overflow-hidden">
            <Tabs value={activeCategory} onValueChange={setActiveCategory} className="h-full flex flex-col">
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
          </div>
        </div>

        <SourceSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} sourceRecency={streamHook.sourceRecency} />

        <ArticleDetailModal article={leadArticle} isOpen={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
      </main>
    </div>
  )
}

export default function Page() {
  return (
    <ErrorBoundary>
      <NewsPage />
    </ErrorBoundary>
  )
}
