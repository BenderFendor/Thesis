"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent } from 'react';
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  Bell,
  Bookmark,
  Building2,
  Gamepad2,
  Grid3X3,
  Laptop,
  Loader2,
  Newspaper,
  Palette,
  Search,
  Shirt,
  Trophy,
} from "lucide-react"
import { GlobalNavigation } from '@/components/global-navigation';
import type { ViewMode } from '@/components/global-navigation';
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GridView } from "@/components/grid-view"
import { ThemeToggle } from "@/components/theme-toggle"

const loadGlobeView = () => import("@/components/globe-view").then((mod) => mod.GlobeView),
 loadFeedView = () => import("@/components/feed-view").then((mod) => mod.FeedView),
 loadBlindspotView = () => import("@/components/blindspot-view").then((mod) => mod.BlindspotView),
 loadLiveNewsView = () => import("@/components/live-news-view").then((mod) => mod.LiveNewsView),
 loadArticleDetailModal = () =>
  import("@/components/article-detail-modal").then((mod) => mod.ArticleDetailModal),

 GlobeView = dynamic(loadGlobeView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
}),

 FeedView = dynamic(loadFeedView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
}),

 BlindspotView = dynamic(loadBlindspotView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
}),

 LiveNewsView = dynamic(loadLiveNewsView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
}),

 ArticleDetailModal = dynamic(
  loadArticleDetailModal,
  {
    loading: () => null,
    ssr: false,
  }
)

import { useDebugMode } from "@/hooks/use-debug-mode"
import { useFavorites } from "@/hooks/useFavorites"
import { useLiveBrowseIndex } from "@/hooks/useLiveBrowseIndex"
import { useNewsLens } from "@/hooks/useNewsLens"
import { useSourceFilter } from "@/hooks/use-source-filter"
import type { NewsArticle, NewsSource } from "@/lib/api";
import { fetchCacheStatus, fetchCategories, fetchSources } from "@/lib/api"
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotificationsPopup } from '@/components/notification-popup';
import type { Notification, NotificationActionType } from '@/components/notification-popup';
import { SourceSidebar } from "@/components/source-sidebar";
import { CredibilityBadge } from "@/components/credibility-badge";
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
import { filterArticlesByLens, getLensSourceIds, NEWS_LENSES } from "@/lib/news-lens";

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { label: "Globe", value: "globe" },
  { label: "Grid", value: "grid" },
  { label: "Scroll", value: "scroll" },
  { label: "Blindspot", value: "blindspot" },
  { label: "Live", value: "live-news" },
],

 MOBILE_VIEW_OPTIONS = VIEW_OPTIONS,
 EMPTY_SOURCES: NewsSource[] = [],

 categoryIcons: Record<string, React.ElementType> = {
  all: Grid3X3,
  fashion: Shirt,
  games: Gamepad2,
  general: Newspaper,
  hobbies: Palette,
  politics: Building2,
  sports: Trophy,
  technology: Laptop,
},

 HalftoneOverlay = () => (
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

function formatLeadDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function combineSourceIds(
  lens: string,
  selectedSourceIds:readonly  string[],
  lensSourceIds: Set<string>,
): string[] {
  if (lens === "all") {return selectedSourceIds}
  if (selectedSourceIds.length > 0) {
    return selectedSourceIds.filter((sourceId) => lensSourceIds.has(sourceId))
  }
  return [...lensSourceIds]
}

function buildNotifications({
  activeCategory,
  browseIndexLoading,
  filterActive,
  browseIndexError,
  loading,
  activeViewArticleCount,
  selectedSourceCount,
}:Readonly< {
  activeCategory: string
  browseIndexLoading: boolean
  filterActive: boolean
  browseIndexError: Error | null
  loading: boolean
  activeViewArticleCount: number
  selectedSourceCount: number
}>): Notification[] {
  const next: Notification[] = [],
   notificationTimestamp = new Date().toISOString(),
   notificationCategoryLabel = activeCategory === "all" ? "All" : activeCategory

  if (browseIndexLoading) {
    next.push({
      description: "Loading current live articles.",
      id: "live-index-loading",
      meta: {
        category: notificationCategoryLabel,
      },
      timestamp: notificationTimestamp,
      title: "Live index loading",
      type: "info",
    })
  }

  if (filterActive) {
    next.push({
      action: { label: "Debug", type: "open-debug" },
      description: "Only selected sources are visible.",
      id: "filter-active",
      meta: {
        sources: selectedSourceCount,
      },
      timestamp: notificationTimestamp,
      title: "Source filter active",
      type: "info",
    })
  }

  if (browseIndexError) {
    next.push({
      action: { label: "Retry", type: "retry" },
      description: browseIndexError.message,
      id: "browse-index-error",
      timestamp: notificationTimestamp,
      title: "Browse path unavailable",
      type: "error",
    })
  }

  if (!loading && activeViewArticleCount === 0) {
    next.push({
      action: { label: "Retry", type: "retry" },
      description: "Try changing filters or refreshing the live feed.",
      id: "empty-feed",
      timestamp: notificationTimestamp,
      title: "No articles found",
      type: "warning",
    })
  }

  return next
}

function LoadingToast() {
  return (
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
  )
}

function MobileViewTabs({
  currentView,
  onViewChange,
  onViewPreload,
}:Readonly< {
  currentView: ViewMode
  onViewChange: (view: ViewMode) => void
  onViewPreload: (view: ViewMode) => void
}>) {
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
          onFocus={() =>{  onViewPreload(option.value); }}
          onPointerEnter={() =>{  onViewPreload(option.value); }}
          onClick={() =>{  onViewChange(option.value); }}
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
  )
}

function CategorySelect({
  categories,
  activeCategory,
  onCategoryChange,
  isGlobeView,
}:Readonly< {
  categories: { id: string; label: string; icon: React.ElementType }[]
  activeCategory: string
  onCategoryChange: (category: string) => void
  isGlobeView: boolean
}>) {
  return (
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
        onChange={(event) =>{  onCategoryChange(event.target.value); }}
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
  )
}

function SortSelect({
  isGlobeView,
  isTopicMode,
  sortValue,
  onSortModeChange,
}:Readonly< {
  isGlobeView: boolean
  isTopicMode: boolean
  sortValue: string
  onSortModeChange: (value: string) => void
}>) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1",
      isGlobeView && "bg-black/25 backdrop-blur-xl",
    )}>
      <span className={cn(
        "px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 sm:px-2",
        isGlobeView && "sr-only sm:not-sr-only",
      )}>Sort</span>
      <select
        value={sortValue}
        onChange={(event) =>{  onSortModeChange(event.target.value); }}
        className={cn(
          "min-w-0 flex-1 cursor-pointer border-none bg-transparent px-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0 sm:px-2",
          isGlobeView ? "py-0.5" : "py-1",
        )}
      >
        {isTopicMode ? (
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
  )
}

function HeaderBar({
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
  alertsButtonRef,
  actionableNotificationCount,
  onAlertsClick,
  lens,
  activeLensLabel,
  onOpenSidebar,
  onViewChange,
  onViewPreload,
}:Readonly< {
  isGlobeView: boolean
  currentView: ViewMode
  gridMode: "source" | "topic"
  topicSortMode: "sources" | "articles" | "recent"
  sortMode: "favorites" | "newest" | "oldest" | "source-freshness"
  categories: { id: string; label: string; icon: React.ElementType }[]
  activeCategory: string
  onCategoryChange: (category: string) => void
  onSortModeChange: (value: string) => void
  articleCount: number
  alertsButtonRef: React.RefObject<HTMLButtonElement | null>
  actionableNotificationCount: number
  onAlertsClick: () => void
  lens: string
  activeLensLabel: string
  onOpenSidebar: () => void
  onViewChange: (view: ViewMode) => void
  onViewPreload: (view: ViewMode) => void
}>) {
  const isTopicMode = currentView === "grid" && gridMode === "topic"
  return (
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

        <div
          className={cn(
            "flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:justify-end lg:gap-3",
            isGlobeView ? "gap-1.5" : "gap-2",
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
              sortValue={isTopicMode ? topicSortMode : sortMode}
              onSortModeChange={onSortModeChange}
            />
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
              onClick={onOpenSidebar}
              className={cn(
                "h-8 min-w-0 border-white/5 bg-white/[0.03] px-2 font-mono text-[9px] uppercase tracking-widest hover:bg-white/10 lg:px-3",
                isGlobeView && "h-7 bg-black/25 backdrop-blur-xl",
              )}
            >
              {lens === "all" ? "Sources" : activeLensLabel}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

function StatCell({ label, value, valueClassName }:Readonly< { label: string; value: string; valueClassName: string }>) {
  return (
    <div className="bg-[var(--news-bg-secondary)] p-2 space-y-0.5 sm:p-2.5 sm:space-y-1">
      <span className="block text-[7px] font-mono uppercase tracking-widest text-muted-foreground/50 sm:text-[8px]">{label}</span>
      <span className={`block ${valueClassName}`}>{value}</span>
    </div>
  )
}

function LeadSection({
  leadArticle,
  articleCount,
  sourceCount,
  isBlindspotView,
  isGlobeView,
  currentView,
}:Readonly< {
  leadArticle: NewsArticle | null
  articleCount: number
  sourceCount: number
  isBlindspotView: boolean
  isGlobeView: boolean
  currentView: ViewMode
}>) {
  if (isGlobeView || currentView === "scroll") {return undefined}
  const leadDateLabel = leadArticle ? formatLeadDate(leadArticle.publishedAt) : "Updating feed",
   leadSummary = leadArticle?.summary?.trim() || "Story summary unavailable.",
   leadCredibility = leadArticle?.credibility ? leadArticle.credibility.toUpperCase() : "UNKNOWN",
   leadBias = leadArticle?.bias ? leadArticle.bias.replace("-", " ").toUpperCase() : "UNKNOWN"
  return (
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
                {leadDateLabel}
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
              <StatCell label="Live articles" value={String(articleCount)} valueClassName="text-sm font-semibold tabular-nums" />
              <StatCell label="Live sources" value={String(sourceCount)} valueClassName="text-sm font-semibold tabular-nums" />
              <StatCell label="Bias" value={leadBias} valueClassName="text-xs font-semibold text-primary/80 uppercase tracking-tighter" />
              <StatCell label="Signal" value={leadCredibility} valueClassName="text-xs font-semibold text-foreground/90 uppercase tracking-tighter" />
            </div>
            <div className="px-1 py-1 text-[9px] text-muted-foreground/50 italic leading-tight">
              {leadArticle?.summary
                ? "Source metadata available for this story."
                : "Lead coverage loading..."}
            </div>
            {leadArticle && (
              <CredibilityBadge
                domain={leadArticle.sourceId || leadArticle.source}
                size="sm"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ActiveView({
  currentView,
  categoryId,
  activeCategory,
  articles,
  loading,
  totalCount,
  topicSortMode,
  gridMode,
  onGridModeChange,
  debugMode,
  selectedSourceIds,
}:Readonly< {
  currentView: ViewMode
  categoryId: string
  activeCategory: string
  articles: NewsArticle[]
  loading: boolean
  totalCount: number
  topicSortMode: "sources" | "articles" | "recent"
  gridMode: "source" | "topic"
  onGridModeChange: (mode: "source" | "topic") => void
  debugMode: boolean
  selectedSourceIds: string[]
}>) {
  return (
    <>
      {currentView === "globe" && (
        <GlobeView key={`${categoryId}-globe`} articles={articles} loading={loading} />
      )}
      {currentView === "grid" && (
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
      )}
      {currentView === "scroll" && (
        <FeedView
          key={`${categoryId}-scroll`}
          articles={articles}
          loading={loading}
          totalCount={totalCount}
          debugMode={debugMode}
        />
      )}
      {currentView === "blindspot" && (
        <BlindspotView
          key={`${categoryId}-blindspot`}
          category={activeCategory}
          sources={selectedSourceIds}
        />
      )}
      {currentView === "live-news" && (
        <LiveNewsView
          key={`${categoryId}-live-news`}
          articles={articles}
          loading={loading}
        />
      )}
    </>
  )
}

function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("grid"),
   [activeCategory, setActiveCategory] = useState<string>("all"),
   [showNotifications, setShowNotifications] = useState(false),
   [sidebarOpen, setSidebarOpen] = useState(false),
   alertsButtonRef = useRef<HTMLButtonElement>(undefined),
   touchStartRef = useRef<{ x: number; y: number } | null>(null),
   [leadModalOpen, setLeadModalOpen] = useState(false),
   debugMode = useDebugMode(),
   [sortMode, setSortMode] = useState<"favorites" | "newest" | "oldest" | "source-freshness">("favorites"),
   [topicSortMode, setTopicSortMode] = useState<"sources" | "articles" | "recent">("sources"),
   [gridMode, setGridMode] = useState<"source" | "topic">(getStoredGridViewMode),

   router = useRouter(),

  // Source filtering and favorites
   { isFavorite } = useFavorites(),
   { selectedSources, isFilterActive } = useSourceFilter(),
   { lens } = useNewsLens(),
   selectedSourceIds = useMemo(() => [...selectedSources], [selectedSources]),
   sourcesQuery = useQuery({
    queryFn: fetchSources,
    queryKey: ["all-sources"],
    retry: 1,
    staleTime: 60 * 1000,
  }),
   sources = sourcesQuery.data ?? EMPTY_SOURCES,
   lensSourceIds = useMemo(() => getLensSourceIds(sources, lens), [lens, sources]),
   combinedSourceIds = useMemo(
    () => combineSourceIds(lens, selectedSourceIds, lensSourceIds),
    [lens, lensSourceIds, selectedSourceIds],
  ),

   {
    articles: browseIndexArticles,
    totalCount: browseIndexTotalCount,
    isLoading: browseIndexLoading,
    error: browseIndexError,
    refetch: refetchBrowseIndex,
  } = useLiveBrowseIndex({
    category: activeCategory === "all" ? undefined : activeCategory,
    enabled: true,
    sources: combinedSourceIds.length > 0 ? combinedSourceIds : undefined,
  }),
   { data: cacheStatus } = useQuery({
    gcTime: 5 * 60 * 1000,
    queryFn: fetchCacheStatus,
    queryKey: ["news", "cache-status"],
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 1000,
  }),
   categoriesQuery = useQuery<string[]>({
    queryFn: fetchCategories,
    queryKey: ["categories"],
    retry: 1,
  }),
   categories = useMemo(() => {
    const backendCategories = categoriesQuery.data ?? [],
     uniqueCategories = [...new Set(['all', ...backendCategories])]
    return uniqueCategories.map((cat) => ({
      icon: categoryIcons[cat] || Newspaper,
      id: cat,
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
    }))
  }, [categoriesQuery.data])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === GRID_VIEW_MODE_STORAGE_KEY && isGridViewMode(event.newValue)) {
        setGridMode(event.newValue)
      }
    };
    globalThis.addEventListener("storage", handleStorage);
    return () =>{  globalThis.removeEventListener("storage", handleStorage); };
  }, []);

  const sortArticles = useCallback(
    (articles:readonly  NewsArticle[]): NewsArticle[] => {
      const items = [...articles],
       sourceFreshness = sortMode === "source-freshness",
       localRecency: Record<string, number> | null = sourceFreshness
        ? items.reduce< Record<string, number>>((acc, article) => {
            const key = article.sourceId || article.source;
            if (!key) {return acc;}
            const ts = article._parsedTimestamp ?? 0;
            if (ts > 0 && (!acc[key] || ts > acc[key])) {
              acc[key] = ts;
            }
            return acc;
          }, {})
        : null;

      items.sort((a, b) => {
        if (sortMode === "favorites") {
          const aIsFav = isFavorite(a.sourceId) ? 0 : 1,
           bIsFav = isFavorite(b.sourceId) ? 0 : 1;
          if (aIsFav !== bIsFav) {return aIsFav - bIsFav;}
        }

        if (sourceFreshness && localRecency) {
          const aKey = a.sourceId || a.source,
           bKey = b.sourceId || b.source,
           aFresh = aKey ? localRecency[aKey] ?? 0 : 0,
           bFresh = bKey ? localRecency[bKey] ?? 0 : 0;
          if (aFresh !== bFresh) {return bFresh - aFresh;}
        }

        const aTime = a._parsedTimestamp ?? 0,
         bTime = b._parsedTimestamp ?? 0;

        if (sortMode === "oldest") {
          return aTime - bTime;
        }

        return bTime - aTime;
      });

      return items;
    },
    [isFavorite, sortMode]
  ),

   lensFilteredArticles = useMemo(
    () => filterArticlesByLens(browseIndexArticles, sources, lens),
    [browseIndexArticles, lens, sources],
  ),
   browseArticles = useMemo(() => sortArticles(lensFilteredArticles), [lensFilteredArticles, sortArticles]),
   activeViewArticles = getSharedViewArticles(currentView, browseArticles),
   activeLensLabel = NEWS_LENSES.find((item) => item.id === lens)?.label ?? "All Sources",

   sourceRecency = useMemo(() => {
    const articles = activeViewArticles
    if (!articles || articles.length === 0) {return {}}

    const recency: Record<string, number> = {}
    for (const article of articles) {
      const sourceKey = article.sourceId || article.source
      if (!sourceKey) {continue}
      const ts = article._parsedTimestamp ?? 0
      if (ts > 0 && (!recency[sourceKey] || ts > recency[sourceKey])) {
        recency[sourceKey] = ts
      }
    }
    return recency
  }, [activeViewArticles]),

   handleCategoryChange = useCallback(
    (category: string) => {
      setActiveCategory(category);
    },
    [],
  ),

   handleViewChange = useCallback(
    (view: ViewMode) => {
      setCurrentView(view);
    },
    [],
  ),

   preloadView = useCallback((view: ViewMode) => {
    if (view === "globe") {
      void loadGlobeView()
      return
    }
    if (view === "scroll") {
      void loadFeedView()
      return
    }
    if (view === "blindspot") {
      void loadBlindspotView()
      return
    }
    if (view === "live-news") {
      void loadLiveNewsView()
    }
  }, []),

   moveView = useCallback((direction: 1 | -1) => {
    setCurrentView((view) => {
      const currentIndex = VIEW_OPTIONS.findIndex((option) => option.value === view),
       nextIndex = Math.min(
        VIEW_OPTIONS.length - 1,
        Math.max(0, currentIndex + direction),
      )
      return VIEW_OPTIONS[nextIndex]?.value ?? view
    })
  }, []),

   handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    if (!touch) {return}
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }, []),

   handleTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = undefined
    const touch = event.changedTouches[0]
    if (!start || !touch) {return}

    const deltaX = touch.clientX - start.x,
     deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {return}

    moveView(deltaX < 0 ? 1 : -1)
  }, [moveView]),
   loading = getSharedViewLoading(browseIndexLoading),
   filterActive = isFilterActive(),
   notifications = useMemo(
    () => buildNotifications({
      activeCategory,
      activeViewArticleCount: activeViewArticles.length,
      browseIndexError,
      browseIndexLoading,
      filterActive,
      loading,
      selectedSourceCount: selectedSources.size,
    }),
    [
      activeCategory,
      activeViewArticles.length,
      browseIndexError,
      browseIndexLoading,
      filterActive,
      loading,
      selectedSources.size,
    ]
  ),
   {
    visibleNotifications,
    dismissOne: handleClearNotification,
    dismissAll: handleClearAllNotifications,
  } = useDismissedNotifications(notifications),
   actionableNotificationCount = visibleNotifications.filter(
    (item) => item.type === "error" || item.type === "warning"
  ).length,

   leadArticle = activeViewArticles[0] ?? null,
   articleCount = getSharedArticleCount(
    cacheStatus,
    browseIndexTotalCount,
    browseArticles,
    loading,
  ),
   sourceCount = getSharedSourceCount(cacheStatus, browseArticles, loading),

   handleRetry = () => {
     refetchBrowseIndex();
  },

   handleNotificationAction = (
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
  },

   handleSortModeChange = (value: string) => {
    if (currentView === "grid" && gridMode === "topic") {
      setTopicSortMode(value as typeof topicSortMode)
    } else {
      setSortMode(value as typeof sortMode)
    }
  },

   isGlobeView = currentView === "globe",
   isBlindspotView = currentView === "blindspot"

  return (
    <div className="min-h-screen overflow-x-hidden flex bg-[var(--news-bg-primary)] text-foreground">
      <HalftoneOverlay />
      {/* Loading state */}
      {loading && activeViewArticles.length === 0 && <LoadingToast />}


      <GlobalNavigation
        currentView={currentView}
        onViewChange={handleViewChange}
        onViewPreload={preloadView}
        onAlertsClick={() =>{  setShowNotifications(!showNotifications); }}
        alertCount={actionableNotificationCount}
      />

      {showNotifications && (
        <NotificationsPopup
          notifications={visibleNotifications}
          onClear={handleClearNotification}
          onClearAll={handleClearAllNotifications}
          onAction={handleNotificationAction}
          onClose={() =>{  setShowNotifications(false); }}
          anchorRef={alertsButtonRef}
        />
      )}

      <div className={cn("flex-1 flex flex-col min-w-0", currentView === "scroll" ? "h-screen overflow-hidden" : "")}>
        <HeaderBar
          isGlobeView={isGlobeView}
          currentView={currentView}
          gridMode={gridMode}
          topicSortMode={topicSortMode}
          sortMode={sortMode}
          categories={categories}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          onSortModeChange={handleSortModeChange}
          articleCount={articleCount}
          alertsButtonRef={alertsButtonRef}
          actionableNotificationCount={actionableNotificationCount}
          onAlertsClick={() =>{  setShowNotifications(!showNotifications); }}
          onViewChange={handleViewChange}
          onViewPreload={preloadView}
          lens={lens}
          activeLensLabel={activeLensLabel}
          onOpenSidebar={() =>{  setSidebarOpen(true); }}
        />

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
                        <LeadSection
              leadArticle={leadArticle}
              articleCount={articleCount}
              sourceCount={sourceCount}
              isBlindspotView={isBlindspotView}
              isGlobeView={isGlobeView}
              currentView={currentView}
            />

            <Tabs value={activeCategory} onValueChange={handleCategoryChange} className={cn("flex-1 flex flex-col", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden" : "")}>

              {categories.map((category) => (
                <TabsContent key={category.id} value={category.id} className={cn("mt-0 flex-1", (currentView === "scroll" || currentView === "globe") ? "overflow-hidden flex flex-col" : "")}>
                  {activeCategory === category.id && (
                    <ActiveView
                      currentView={currentView}
                      categoryId={category.id}
                      activeCategory={activeCategory}
                      articles={browseArticles}
                      loading={loading}
                      totalCount={browseIndexTotalCount}
                      topicSortMode={topicSortMode}
                      gridMode={gridMode}
                      onGridModeChange={setGridMode}
                      debugMode={debugMode}
                      selectedSourceIds={selectedSourceIds}
                    />
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
            onClose={() =>{  setSidebarOpen(false); }}
            sourceRecency={sourceRecency}
          />

      {leadModalOpen && leadArticle && (
        <ArticleDetailModal
          article={leadArticle}
          isOpen={leadModalOpen}
          onClose={() =>{  setLeadModalOpen(false); }}
        />
      )}
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
