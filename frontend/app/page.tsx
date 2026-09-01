"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, TouchEvent } from 'react';
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
import { useFavorites } from "@/hooks/use-favorites"
import { useLiveBrowseIndex } from "@/hooks/useLiveBrowseIndex"
import { useNewsLens } from "@/hooks/use-news-lens"
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

type ArticleSortMode = "favorites" | "newest" | "oldest" | "source-freshness"

function getArticleSourceKey(article: NewsArticle): string {
  return article.sourceId || article.source
}

function getArticleTimestamp(article: NewsArticle): number {
  return article._parsedTimestamp ?? 0
}

function getSourceRecency(articles: readonly NewsArticle[]): Record<string, number> {
  const recency: Record<string, number> = {}
  for (const article of articles) {
    const sourceKey = getArticleSourceKey(article),
      timestamp = getArticleTimestamp(article)
    if (sourceKey && timestamp > 0 && (!recency[sourceKey] || timestamp > recency[sourceKey])) {
      recency[sourceKey] = timestamp
    }
  }
  return recency
}

function compareSourceRecency(
  a: NewsArticle,
  b: NewsArticle,
  sourceRecency: Record<string, number>,
): number {
  const aFresh = sourceRecency[getArticleSourceKey(a)] ?? 0,
    bFresh = sourceRecency[getArticleSourceKey(b)] ?? 0
  return bFresh - aFresh
}

function compareArticleTimestamps(
  a: NewsArticle,
  b: NewsArticle,
  sortMode: ArticleSortMode,
): number {
  const aTime = getArticleTimestamp(a),
    bTime = getArticleTimestamp(b)
  return sortMode === "oldest" ? aTime - bTime : bTime - aTime
}

function compareNewsArticles(
  a: NewsArticle,
  b: NewsArticle,
  sortMode: ArticleSortMode,
  isFavorite: (sourceId: string) => boolean,
  sourceRecency: Record<string, number> | null,
): number {
  if (sortMode === "favorites") {
    const favoriteDifference = Number(isFavorite(b.sourceId)) - Number(isFavorite(a.sourceId))
    if (favoriteDifference !== 0) {return favoriteDifference}
  }
  if (sourceRecency) {
    const freshnessDifference = compareSourceRecency(a, b, sourceRecency)
    if (freshnessDifference !== 0) {return freshnessDifference}
  }
  return compareArticleTimestamps(a, b, sortMode)
}

function sortNewsArticles(
  articles: readonly NewsArticle[],
  sortMode: ArticleSortMode,
  isFavorite: (sourceId: string) => boolean,
): NewsArticle[] {
  const items = [...articles],
    sourceRecency = sortMode === "source-freshness" ? getSourceRecency(items) : null
  items.sort((a, b) => compareNewsArticles(a, b, sortMode, isFavorite, sourceRecency))
  return items
}

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
  if (lens === "all") {return [...selectedSourceIds]}
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
    next.push(createLoadingNotification(notificationTimestamp, notificationCategoryLabel))
  }

  if (filterActive) {
    next.push(createFilterNotification(notificationTimestamp, selectedSourceCount))
  }

  if (browseIndexError) {
    next.push(createBrowseErrorNotification(notificationTimestamp, browseIndexError.message))
  }

  if (!loading && activeViewArticleCount === 0) {
    next.push(createEmptyFeedNotification(notificationTimestamp))
  }

  return next
}

function createLoadingNotification(timestamp: string, category: string): Notification {
  return {
    description: "Loading current live articles.",
    id: "live-index-loading",
    meta: { category },
    timestamp,
    title: "Live index loading",
    type: "info",
  }
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
  }
}

function createBrowseErrorNotification(timestamp: string, description: string): Notification {
  return {
    action: { label: "Retry", type: "retry" },
    description,
    id: "browse-index-error",
    timestamp,
    title: "Browse path unavailable",
    type: "error",
  }
}

function createEmptyFeedNotification(timestamp: string): Notification {
  return {
    action: { label: "Retry", type: "retry" },
    description: "Try changing filters or refreshing the live feed.",
    id: "empty-feed",
    timestamp,
    title: "No articles found",
    type: "warning",
  }
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

interface HeaderBarProps {
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
}

function HeaderIdentity({
  isGlobeView,
  currentView,
  articleCount,
}: Pick<HeaderBarProps, "isGlobeView" | "currentView" | "articleCount">) {
  return (
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
  )
}

function MobileHeaderActions({
  alertsButtonRef,
  actionableNotificationCount,
  onAlertsClick,
}: Pick<HeaderBarProps, "alertsButtonRef" | "actionableNotificationCount" | "onAlertsClick">) {
  return (
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
  )
}

function HeaderResourceLinks({ isGlobeView }: Pick<HeaderBarProps, "isGlobeView">) {
  return (
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
  )
}

function HeaderSourceFilterButton({
  isGlobeView,
  lens,
  activeLensLabel,
  onOpenSidebar,
}: Pick<HeaderBarProps, "isGlobeView" | "lens" | "activeLensLabel" | "onOpenSidebar">) {
  return (
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
  )
}

function HeaderResourceActions({
  isGlobeView,
  lens,
  activeLensLabel,
  onOpenSidebar,
}: Pick<HeaderBarProps, "isGlobeView" | "lens" | "activeLensLabel" | "onOpenSidebar">) {
  return (
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
  )
}

function HeaderControls({
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
}: Pick<HeaderBarProps, "isGlobeView" | "currentView" | "gridMode" | "topicSortMode" | "sortMode" | "categories" | "activeCategory" | "onCategoryChange" | "onSortModeChange" | "lens" | "activeLensLabel" | "onOpenSidebar">) {
  const isTopicMode = currentView === "grid" && gridMode === "topic"
  return (
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
      <HeaderResourceActions
        activeLensLabel={activeLensLabel}
        isGlobeView={isGlobeView}
        lens={lens}
        onOpenSidebar={onOpenSidebar}
      />
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
}: HeaderBarProps) {
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
          <HeaderIdentity
            articleCount={articleCount}
            currentView={currentView}
            isGlobeView={isGlobeView}
          />
          <MobileHeaderActions
            actionableNotificationCount={actionableNotificationCount}
            alertsButtonRef={alertsButtonRef}
            onAlertsClick={onAlertsClick}
          />
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

function LeadStory({
  leadArticle,
  leadDateLabel,
  leadSummary,
}: {
  leadArticle: NewsArticle | null
  leadDateLabel: string
  leadSummary: string
}) {
  return (
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
  )
}

function LeadMetadata({
  leadArticle,
  articleCount,
  sourceCount,
  leadBias,
  leadCredibility,
}: {
  leadArticle: NewsArticle | null
  articleCount: number
  sourceCount: number
  leadBias: string
  leadCredibility: string
}) {
  return (
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
  )
}

function getLeadDetails(leadArticle: NewsArticle | null): {
  dateLabel: string
  summary: string
  credibility: string
  bias: string
} {
  return {
    bias: leadArticle?.bias ? leadArticle.bias.replace("-", " ").toUpperCase() : "UNKNOWN",
    credibility: leadArticle?.credibility ? leadArticle.credibility.toUpperCase() : "UNKNOWN",
    dateLabel: leadArticle ? formatLeadDate(leadArticle.publishedAt) : "Updating feed",
    summary: leadArticle?.summary?.trim() || "Story summary unavailable.",
  }
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
  if (isGlobeView || currentView === "scroll") {return}
  const { dateLabel, summary, credibility, bias } = getLeadDetails(leadArticle)
  return (
    <div className={cn("relative p-3 sm:p-6", isBlindspotView && "hidden lg:block")}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] bg-primary"
        style={{ filter: "url(#halftone-pattern)" }}
      />
      <div className="flex flex-col gap-3 sm:gap-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
          <LeadStory
          leadArticle={leadArticle}
            leadDateLabel={dateLabel}
            leadSummary={summary}
          />
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
  )
}

interface ActiveViewProps {
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
}

function GlobeActiveView({ categoryId, articles, loading }: Pick<ActiveViewProps, "categoryId" | "articles" | "loading">) {
  return <GlobeView key={`${categoryId}-globe`} articles={articles} loading={loading} />
}

function GridActiveView({
  articles,
  loading,
  topicSortMode,
  gridMode,
  onGridModeChange,
  totalCount,
}: Pick<ActiveViewProps, "articles" | "loading" | "topicSortMode" | "gridMode" | "onGridModeChange" | "totalCount">) {
  return (
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
  )
}

function ScrollActiveView({
  categoryId,
  articles,
  loading,
  totalCount,
  debugMode,
}: Pick<ActiveViewProps, "categoryId" | "articles" | "loading" | "totalCount" | "debugMode">) {
  return (
    <FeedView
      key={`${categoryId}-scroll`}
      articles={articles}
      loading={loading}
      totalCount={totalCount}
      debugMode={debugMode}
    />
  )
}

function BlindspotActiveView({
  categoryId,
  activeCategory,
  selectedSourceIds,
}: Pick<ActiveViewProps, "categoryId" | "activeCategory" | "selectedSourceIds">) {
  return (
    <BlindspotView
      key={`${categoryId}-blindspot`}
      category={activeCategory}
      sources={selectedSourceIds}
    />
  )
}

function LiveNewsActiveView({
  categoryId,
  articles,
  loading,
}: Pick<ActiveViewProps, "categoryId" | "articles" | "loading">) {
  return <LiveNewsView key={`${categoryId}-live-news`} articles={articles} loading={loading} />
}

function ActiveView(props: ActiveViewProps) {
  switch (props.currentView) {
    case "globe": {
      return <GlobeActiveView {...props} />
    }
    case "grid": {
      return <GridActiveView {...props} />
    }
    case "scroll": {
      return <ScrollActiveView {...props} />
    }
    case "blindspot": {
      return <BlindspotActiveView {...props} />
    }
    case "live-news": {
      return <LiveNewsActiveView {...props} />
    }
  }
}

interface NewsPageLayoutProps {
  loading: boolean
  activeViewArticles: NewsArticle[]
  currentView: ViewMode
  showNotifications: boolean
  navigation: ComponentProps<typeof GlobalNavigation>
  notifications: ComponentProps<typeof NotificationsPopup>
  header: ComponentProps<typeof HeaderBar>
  lead: ComponentProps<typeof LeadSection>
  activeView: ComponentProps<typeof ActiveView>
  categories: { id: string; icon: React.ElementType; label: string }[]
  activeCategory: string
  onCategoryChange: (category: string) => void
  onTouchStart: (event: TouchEvent<HTMLElement>) => void
  onTouchEnd: (event: TouchEvent<HTMLElement>) => void
  onOpenSidebar: () => void
  sourceSidebar: ComponentProps<typeof SourceSidebar>
  leadModal: { article: NewsArticle; onClose: () => void } | null
}

function NewsCategoryTabs({
  currentView,
  activeCategory,
  categories,
  activeView,
  onCategoryChange,
}: Pick<NewsPageLayoutProps, "currentView" | "activeCategory" | "categories" | "activeView" | "onCategoryChange">) {
  const isCompactView = currentView === "globe" || currentView === "scroll"
  return (
    <Tabs
      value={activeCategory}
      onValueChange={onCategoryChange}
      className={cn("flex-1 flex flex-col", isCompactView ? "overflow-hidden" : "")}
    >
      {categories.map((category) => (
        <TabsContent
          key={category.id}
          value={category.id}
          className={cn("mt-0 flex-1", isCompactView ? "overflow-hidden flex flex-col" : "")}
        >
          {activeCategory === category.id ? (
            <ActiveView {...activeView} categoryId={category.id} activeCategory={activeCategory} />
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}

function NewsMainContent({
  currentView,
  activeCategory,
  categories,
  activeView,
  lead,
  onCategoryChange,
  onTouchStart,
  onTouchEnd,
}: Pick<NewsPageLayoutProps, "currentView" | "activeCategory" | "categories" | "activeView" | "lead" | "onCategoryChange" | "onTouchStart" | "onTouchEnd">) {
  const isGlobeView = currentView === "globe",
    isScrollView = currentView === "scroll",
    isCompactView = isGlobeView || isScrollView
  return (
    <main className={cn("flex-1 min-w-0 bg-[var(--news-bg-primary)]", isCompactView ? "overflow-hidden" : "")}>
      <div
        className={cn("w-full grid grid-cols-1 lg:grid-cols-12 gap-0", isCompactView ? "h-full" : "")}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <section className={cn(
          "lg:col-span-12 bg-[var(--news-bg-primary)] flex flex-col",
          isCompactView ? "h-full overflow-hidden" : "min-h-[calc(100vh-80px)]",
        )}>
          <LeadSection {...lead} isBlindspotView={currentView === "blindspot"} isGlobeView={isGlobeView} />
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
  )
}

function NewsPageLayout({
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
  onOpenSidebar,
  sourceSidebar,
  leadModal,
}: NewsPageLayoutProps) {
  return (
    <div className="min-h-screen overflow-x-hidden flex bg-[var(--news-bg-primary)] text-foreground">
      <HalftoneOverlay />
      {loading && activeViewArticles.length === 0 && <LoadingToast />}
      <GlobalNavigation {...navigation} />
      {showNotifications && <NotificationsPopup {...notifications} />}
      <div className={cn("flex-1 flex flex-col min-w-0", currentView === "scroll" ? "h-screen overflow-hidden" : "")}>
        <HeaderBar {...header} onOpenSidebar={onOpenSidebar} />
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
      {leadModal ? (
        <ArticleDetailModal
          article={leadModal.article}
          isOpen
          onClose={leadModal.onClose}
        />
      ) : null}
    </div>
  )
}

interface NewsPageState {
  currentView: ViewMode
  setCurrentView: React.Dispatch<React.SetStateAction<ViewMode>>
  activeCategory: string
  setActiveCategory: React.Dispatch<React.SetStateAction<string>>
  showNotifications: boolean
  setShowNotifications: React.Dispatch<React.SetStateAction<boolean>>
  sidebarOpen: boolean
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  alertsButtonRef: React.RefObject<HTMLButtonElement | null>
  touchStartRef: React.MutableRefObject<{ x: number; y: number } | null>
  leadModalOpen: boolean
  setLeadModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  sortMode: ArticleSortMode
  setSortMode: React.Dispatch<React.SetStateAction<ArticleSortMode>>
  topicSortMode: "sources" | "articles" | "recent"
  setTopicSortMode: React.Dispatch<React.SetStateAction<"sources" | "articles" | "recent">>
  gridMode: "source" | "topic"
  setGridMode: React.Dispatch<React.SetStateAction<"source" | "topic">>
  debugMode: boolean
  router: ReturnType<typeof useRouter>
  isFavorite: ReturnType<typeof useFavorites>["isFavorite"]
  selectedSources: ReturnType<typeof useSourceFilter>["selectedSources"]
  isFilterActive: ReturnType<typeof useSourceFilter>["isFilterActive"]
  lens: ReturnType<typeof useNewsLens>["lens"]
}

function useGridModeStorageSync(
  setGridMode: NewsPageState["setGridMode"],
): void {
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === GRID_VIEW_MODE_STORAGE_KEY && isGridViewMode(event.newValue)) {
        setGridMode(event.newValue)
      }
    }
    globalThis.addEventListener("storage", handleStorage)
    return () => {globalThis.removeEventListener("storage", handleStorage)}
  }, [setGridMode])
}

function useNewsPageState(): NewsPageState {
  const [currentView, setCurrentView] = useState<ViewMode>("grid"),
    [activeCategory, setActiveCategory] = useState<string>("all"),
    [showNotifications, setShowNotifications] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    alertsButtonRef = useRef<HTMLButtonElement>(null),
    touchStartRef = useRef<{ x: number; y: number } | null>(null),
    [leadModalOpen, setLeadModalOpen] = useState(false),
    debugMode = useDebugMode(),
    [sortMode, setSortMode] = useState<ArticleSortMode>("favorites"),
    [topicSortMode, setTopicSortMode] = useState<"sources" | "articles" | "recent">("sources"),
    [gridMode, setGridMode] = useState<"source" | "topic">(getStoredGridViewMode),
    router = useRouter(),
    { isFavorite } = useFavorites(),
    { selectedSources, isFilterActive } = useSourceFilter(),
    { lens } = useNewsLens()

  useGridModeStorageSync(setGridMode)
  return {
    activeCategory,
    alertsButtonRef,
    currentView,
    debugMode,
    gridMode,
    isFavorite,
    isFilterActive,
    leadModalOpen,
    lens,
    router,
    selectedSources,
    setActiveCategory,
    setCurrentView,
    setGridMode,
    setLeadModalOpen,
    setShowNotifications,
    setSidebarOpen,
    setSortMode,
    setTopicSortMode,
    showNotifications,
    sidebarOpen,
    sortMode,
    topicSortMode,
    touchStartRef,
  }
}

interface NewsPageQueryData {
  selectedSourceIds: string[]
  sources: NewsSource[]
  categories: { id: string; icon: React.ElementType; label: string }[]
  browseIndexArticles: NewsArticle[]
  browseIndexTotalCount: number
  browseIndexLoading: boolean
  browseIndexError: Error | null
  refetchBrowseIndex: () => void
  cacheStatus: Awaited<ReturnType<typeof fetchCacheStatus>> | undefined
}

function useNewsPageQueryData({
  activeCategory,
  lens,
  selectedSources,
}: Pick<NewsPageState, "activeCategory" | "lens" | "selectedSources">): NewsPageQueryData {
  const selectedSourceIds = useMemo(() => [...selectedSources], [selectedSources]),
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
        uniqueCategories = [...new Set(["all", ...backendCategories])]
      return uniqueCategories.map((cat) => ({
        icon: categoryIcons[cat] || Newspaper,
        id: cat,
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
      }))
    }, [categoriesQuery.data])

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
  }
}

interface NewsPageSortedData {
  browseArticles: NewsArticle[]
  activeViewArticles: NewsArticle[]
  activeLensLabel: string
  sourceRecency: Record<string, number>
}

function useNewsPageSortedData({
  currentView,
  sortMode,
  isFavorite,
  lens,
  browseIndexArticles,
  sources,
}: Pick<NewsPageState, "currentView" | "sortMode" | "isFavorite" | "lens"> & Pick<NewsPageQueryData, "browseIndexArticles" | "sources">): NewsPageSortedData {
  const sortArticles = useCallback(
      (items: readonly NewsArticle[]) => sortNewsArticles(items, sortMode, isFavorite),
      [isFavorite, sortMode],
    ),
    lensFilteredArticles = useMemo(
      () => filterArticlesByLens(browseIndexArticles, sources, lens),
      [browseIndexArticles, lens, sources],
    ),
    browseArticles = useMemo(() => sortArticles(lensFilteredArticles), [lensFilteredArticles, sortArticles]),
    activeViewArticles = getSharedViewArticles(currentView, browseArticles),
    activeLensLabel = NEWS_LENSES.find((item) => item.id === lens)?.label ?? "All Sources",
    sourceRecency = useMemo(() => getSourceRecency(activeViewArticles), [activeViewArticles])

  return { activeLensLabel, activeViewArticles, browseArticles, sourceRecency }
}

function usePageNotifications({
  activeCategory,
  activeViewArticles,
  browseIndexError,
  browseIndexLoading,
  filterActive,
  loading,
  selectedSourceCount,
}: {
  activeCategory: string
  activeViewArticles: NewsArticle[]
  browseIndexError: Error | null
  browseIndexLoading: boolean
  filterActive: boolean
  loading: boolean
  selectedSourceCount: number
}): Notification[] {
  return useMemo(
    () => buildNotifications({
      activeCategory,
      activeViewArticleCount: activeViewArticles.length,
      browseIndexError,
      browseIndexLoading,
      filterActive,
      loading,
      selectedSourceCount,
    }),
    [activeCategory, activeViewArticles.length, browseIndexError, browseIndexLoading, filterActive, loading, selectedSourceCount],
  )
}

interface NewsPageViewData extends NewsPageSortedData {
  loading: boolean
  filterActive: boolean
  visibleNotifications: Notification[]
  dismissOne: (notificationId: string) => void
  dismissAll: () => void
  actionableNotificationCount: number
  leadArticle: NewsArticle | null
  articleCount: number
  sourceCount: number
}

function useNewsPageViewData(
  state: Pick<NewsPageState, "activeCategory" | "currentView" | "isFilterActive" | "selectedSources" | "sortMode" | "isFavorite" | "lens">,
  queries: Pick<NewsPageQueryData, "browseIndexArticles" | "browseIndexTotalCount" | "browseIndexLoading" | "browseIndexError" | "sources" | "cacheStatus">,
): NewsPageViewData {
  const sorted = useNewsPageSortedData({
      browseIndexArticles: queries.browseIndexArticles,
      currentView: state.currentView,
      isFavorite: state.isFavorite,
      lens: state.lens,
      sortMode: state.sortMode,
      sources: queries.sources,
    }),
    loading = getSharedViewLoading(queries.browseIndexLoading),
    filterActive = state.isFilterActive(),
    notifications = usePageNotifications({
      activeCategory: state.activeCategory,
      activeViewArticles: sorted.activeViewArticles,
      browseIndexError: queries.browseIndexError,
      browseIndexLoading: queries.browseIndexLoading,
      filterActive,
      loading,
      selectedSourceCount: state.selectedSources.size,
    }),
    dismissed = useDismissedNotifications(notifications),
    actionableNotificationCount = dismissed.visibleNotifications.filter(
      (item) => item.type === "error" || item.type === "warning",
    ).length,
    leadArticle = sorted.activeViewArticles[0] ?? null,
    articleCount = getSharedArticleCount(
      queries.cacheStatus,
      queries.browseIndexTotalCount,
      sorted.browseArticles,
      loading,
    ),
    sourceCount = getSharedSourceCount(queries.cacheStatus, sorted.browseArticles, loading)

  return {
    ...sorted,
    actionableNotificationCount,
    articleCount,
    dismissAll: dismissed.dismissAll,
    dismissOne: dismissed.dismissOne,
    filterActive,
    leadArticle,
    loading,
    sourceCount,
    visibleNotifications: dismissed.visibleNotifications,
  }
}

function preloadNewsView(view: ViewMode): void {
  switch (view) {
    case "globe": {
      void loadGlobeView()
      break
    }
    case "scroll": {
      void loadFeedView()
      break
    }
    case "blindspot": {
      void loadBlindspotView()
      break
    }
    case "live-news": {
      void loadLiveNewsView()
      break
    }
    case "grid": {
      break
    }
  }
}

function getAdjacentView(view: ViewMode, direction: 1 | -1): ViewMode {
  const currentIndex = VIEW_OPTIONS.findIndex((option) => option.value === view),
    nextIndex = Math.min(VIEW_OPTIONS.length - 1, Math.max(0, currentIndex + direction))
  return VIEW_OPTIONS[nextIndex]?.value ?? view
}

interface NewsPageNavigation {
  handleCategoryChange: (category: string) => void
  handleViewChange: (view: ViewMode) => void
  preloadView: (view: ViewMode) => void
  handleTouchStart: (event: TouchEvent<HTMLElement>) => void
  handleTouchEnd: (event: TouchEvent<HTMLElement>) => void
}

function useNewsPageNavigation(
  state: Pick<NewsPageState, "setActiveCategory" | "setCurrentView" | "touchStartRef">,
): NewsPageNavigation {
  const handleCategoryChange = useCallback((category: string) => {
      state.setActiveCategory(category)
    }, [state.setActiveCategory]),
    handleViewChange = useCallback((view: ViewMode) => {
      state.setCurrentView(view)
    }, [state.setCurrentView]),
    preloadView = useCallback(preloadNewsView, []),
    moveView = useCallback((direction: 1 | -1) => {
      state.setCurrentView((view) => getAdjacentView(view, direction))
    }, [state.setCurrentView]),
    handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0]
      if (touch) {state.touchStartRef.current = { x: touch.clientX, y: touch.clientY }}
    }, [state.touchStartRef]),
    handleTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
      const start = state.touchStartRef.current
      state.touchStartRef.current = null
      const touch = event.changedTouches[0]
      if (!start || !touch) {return}
      const deltaX = touch.clientX - start.x,
        deltaY = touch.clientY - start.y
      if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) {return}
      moveView(deltaX < 0 ? 1 : -1)
    }, [moveView, state.touchStartRef])

  return { handleCategoryChange, handleTouchEnd, handleTouchStart, handleViewChange, preloadView }
}

interface NewsPageActions {
  handleRetry: () => void
  handleNotificationAction: (actionType: NotificationActionType) => void
  handleSortModeChange: (value: string) => void
  toggleNotifications: () => void
  closeNotifications: () => void
  openSidebar: () => void
  closeSidebar: () => void
  closeLeadModal: () => void
}

function useNewsPageActions(
  state: Pick<NewsPageState, "currentView" | "gridMode" | "router" | "setShowNotifications" | "setTopicSortMode" | "setSortMode" | "setSidebarOpen" | "setLeadModalOpen">,
  refetchBrowseIndex: () => void,
): NewsPageActions {
  const handleRetry = useCallback(() => {refetchBrowseIndex()}, [refetchBrowseIndex]),
    handleNotificationAction = useCallback((actionType: NotificationActionType) => {
      if (actionType === "open-debug") {
        state.router.push("/debug")
        state.setShowNotifications(false)
        return
      }
      if (actionType === "retry") {
        handleRetry()
        state.setShowNotifications(false)
      }
    }, [handleRetry, state.router, state.setShowNotifications]),
    handleSortModeChange = useCallback((value: string) => {
      if (state.currentView === "grid" && state.gridMode === "topic") {
        state.setTopicSortMode(value as "sources" | "articles" | "recent")
      } else {
        state.setSortMode(value as ArticleSortMode)
      }
    }, [state.currentView, state.gridMode, state.setSortMode, state.setTopicSortMode]),
    toggleNotifications = useCallback(() => {
      state.setShowNotifications((visible) => !visible)
    }, [state.setShowNotifications]),
    closeNotifications = useCallback(() => {state.setShowNotifications(false)}, [state.setShowNotifications]),
    openSidebar = useCallback(() => {state.setSidebarOpen(true)}, [state.setSidebarOpen]),
    closeSidebar = useCallback(() => {state.setSidebarOpen(false)}, [state.setSidebarOpen]),
    closeLeadModal = useCallback(() => {state.setLeadModalOpen(false)}, [state.setLeadModalOpen])

  return {
    closeLeadModal,
    closeNotifications,
    closeSidebar,
    handleNotificationAction,
    handleRetry,
    handleSortModeChange,
    openSidebar,
    toggleNotifications,
  }
}

interface NewsPageControllerParts {
  state: NewsPageState
  queries: NewsPageQueryData
  view: NewsPageViewData
  navigation: NewsPageNavigation
  actions: NewsPageActions
}

function createPageNavigationProps({
  state,
  view,
  navigation,
  actions,
}: NewsPageControllerParts): ComponentProps<typeof GlobalNavigation> {
  return {
    alertCount: view.actionableNotificationCount,
    currentView: state.currentView,
    onAlertsClick: actions.toggleNotifications,
    onViewChange: navigation.handleViewChange,
    onViewPreload: navigation.preloadView,
  }
}

function createPageNotificationProps({
  state,
  view,
  actions,
}: NewsPageControllerParts): ComponentProps<typeof NotificationsPopup> {
  return {
    anchorRef: state.alertsButtonRef,
    notifications: view.visibleNotifications,
    onAction: actions.handleNotificationAction,
    onClear: view.dismissOne,
    onClearAll: view.dismissAll,
    onClose: actions.closeNotifications,
  }
}

function createPageHeaderProps({
  state,
  queries,
  view,
  navigation,
  actions,
}: NewsPageControllerParts): ComponentProps<typeof HeaderBar> {
  return {
    actionableNotificationCount: view.actionableNotificationCount,
    activeCategory: state.activeCategory,
    activeLensLabel: view.activeLensLabel,
    alertsButtonRef: state.alertsButtonRef,
    articleCount: view.articleCount,
    categories: queries.categories,
    currentView: state.currentView,
    gridMode: state.gridMode,
    isGlobeView: state.currentView === "globe",
    lens: state.lens,
    onAlertsClick: actions.toggleNotifications,
    onCategoryChange: navigation.handleCategoryChange,
    onOpenSidebar: actions.openSidebar,
    onSortModeChange: actions.handleSortModeChange,
    onViewChange: navigation.handleViewChange,
    onViewPreload: navigation.preloadView,
    sortMode: state.sortMode,
    topicSortMode: state.topicSortMode,
  }
}

function createPageLeadProps({
  state,
  view,
}: NewsPageControllerParts): ComponentProps<typeof LeadSection> {
  return {
    articleCount: view.articleCount,
    currentView: state.currentView,
    isBlindspotView: state.currentView === "blindspot",
    isGlobeView: state.currentView === "globe",
    leadArticle: view.leadArticle,
    sourceCount: view.sourceCount,
  }
}

function createPageActiveViewProps({
  state,
  queries,
  view,
}: NewsPageControllerParts): ComponentProps<typeof ActiveView> {
  return {
    activeCategory: state.activeCategory,
    articles: view.browseArticles,
    categoryId: state.activeCategory,
    currentView: state.currentView,
    debugMode: state.debugMode,
    gridMode: state.gridMode,
    loading: view.loading,
    onGridModeChange: state.setGridMode,
    selectedSourceIds: queries.selectedSourceIds,
    topicSortMode: state.topicSortMode,
    totalCount: queries.browseIndexTotalCount,
  }
}

function createPageSidebarProps({
  state,
  view,
  actions,
}: NewsPageControllerParts): ComponentProps<typeof SourceSidebar> {
  return {
    isOpen: state.sidebarOpen,
    onClose: actions.closeSidebar,
    sourceRecency: view.sourceRecency,
  }
}

function buildNewsPageLayoutProps(parts: NewsPageControllerParts): NewsPageLayoutProps {
  const { state, queries, view, navigation, actions } = parts
  return {
    activeCategory: state.activeCategory,
    activeView: createPageActiveViewProps(parts),
    activeViewArticles: view.activeViewArticles,
    categories: queries.categories,
    currentView: state.currentView,
    header: createPageHeaderProps(parts),
    lead: createPageLeadProps(parts),
    leadModal: state.leadModalOpen && view.leadArticle ? {
      article: view.leadArticle,
      onClose: actions.closeLeadModal,
    } : null,
    loading: view.loading,
    navigation: createPageNavigationProps(parts),
    notifications: createPageNotificationProps(parts),
    onCategoryChange: navigation.handleCategoryChange,
    onOpenSidebar: actions.openSidebar,
    onTouchEnd: navigation.handleTouchEnd,
    onTouchStart: navigation.handleTouchStart,
    showNotifications: state.showNotifications,
    sourceSidebar: createPageSidebarProps(parts),
  }
}

function useNewsPageController(): NewsPageLayoutProps {
  const state = useNewsPageState(),
    queries = useNewsPageQueryData(state),
    view = useNewsPageViewData(state, queries),
    navigation = useNewsPageNavigation(state),
    actions = useNewsPageActions(state, queries.refetchBrowseIndex)
  return buildNewsPageLayoutProps({ actions, navigation, queries, state, view })
}

function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("grid"),
    [activeCategory, setActiveCategory] = useState<string>("all"),
    [showNotifications, setShowNotifications] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    alertsButtonRef = useRef<HTMLButtonElement>(null),
    touchStartRef = useRef<{ x: number; y: number } | null>(null),
    [leadModalOpen, setLeadModalOpen] = useState(false),
    debugMode = useDebugMode(),
    [sortMode, setSortMode] = useState<ArticleSortMode>("favorites"),
    [topicSortMode, setTopicSortMode] = useState<"sources" | "articles" | "recent">("sources"),
    [gridMode, setGridMode] = useState<"source" | "topic">(getStoredGridViewMode),
    router = useRouter(),
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
       uniqueCategories = [...new Set(["all", ...backendCategories])]
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
    }
    globalThis.addEventListener("storage", handleStorage)
    return () => {globalThis.removeEventListener("storage", handleStorage)}
  }, [])

  const sortArticles = useCallback(
    (items: readonly NewsArticle[]) => sortNewsArticles(items, sortMode, isFavorite),
    [isFavorite, sortMode],
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
      const sourceKey = article.sourceId || article.source,
       timestamp = article._parsedTimestamp ?? 0
      if (sourceKey && timestamp > 0 && (!recency[sourceKey] || timestamp > recency[sourceKey])) {
        recency[sourceKey] = timestamp
      }
    }
    return recency
  }, [activeViewArticles]),

   handleCategoryChange = useCallback((category: string) => {
    setActiveCategory(category)
  }, []),
   handleViewChange = useCallback((view: ViewMode) => {
    setCurrentView(view)
  }, []),
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
    if (view === "live-news") {void loadLiveNewsView()}
  }, []),
   moveView = useCallback((direction: 1 | -1) => {
    setCurrentView((view) => {
      const currentIndex = VIEW_OPTIONS.findIndex((option) => option.value === view),
       nextIndex = Math.min(VIEW_OPTIONS.length - 1, Math.max(0, currentIndex + direction))
      return VIEW_OPTIONS[nextIndex]?.value ?? view
    })
  }, []),
   handleTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    if (touch) {touchStartRef.current = { x: touch.clientX, y: touch.clientY }}
  }, []),
   handleTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = null
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
    [activeCategory, activeViewArticles.length, browseIndexError, browseIndexLoading, filterActive, loading, selectedSources.size],
  ),
   {
    visibleNotifications,
    dismissOne: handleClearNotification,
    dismissAll: handleClearAllNotifications,
  } = useDismissedNotifications(notifications),
   actionableNotificationCount = visibleNotifications.filter(
    (item) => item.type === "error" || item.type === "warning",
  ).length,
   leadArticle = activeViewArticles[0] ?? null,
   articleCount = getSharedArticleCount(cacheStatus, browseIndexTotalCount, browseArticles, loading),
   sourceCount = getSharedSourceCount(cacheStatus, browseArticles, loading),
   handleRetry = () => {refetchBrowseIndex()},
   handleNotificationAction = (actionType: NotificationActionType) => {
    if (actionType === "open-debug") {
      router.push("/debug")
      setShowNotifications(false)
      return
    }
    if (actionType === "retry") {
      handleRetry()
      setShowNotifications(false)
    }
  },
   handleSortModeChange = (value: string) => {
    if (currentView === "grid" && gridMode === "topic") {
      setTopicSortMode(value as typeof topicSortMode)
    } else {
      setSortMode(value as ArticleSortMode)
    }
  },
   isGlobeView = currentView === "globe",
   isBlindspotView = currentView === "blindspot"

  return (
    <NewsPageLayout
      loading={loading}
      activeViewArticles={activeViewArticles}
      currentView={currentView}
      showNotifications={showNotifications}
      navigation={{
        alertCount: actionableNotificationCount,
        currentView,
        onAlertsClick: () => {setShowNotifications(!showNotifications)},
        onViewChange: handleViewChange,
        onViewPreload: preloadView,
      }}
      notifications={{
        anchorRef: alertsButtonRef,
        notifications: visibleNotifications,
        onAction: handleNotificationAction,
        onClear: handleClearNotification,
        onClearAll: handleClearAllNotifications,
        onClose: () => {setShowNotifications(false)},
      }}
      header={{
        actionableNotificationCount,
        activeCategory,
        activeLensLabel,
        alertsButtonRef,
        articleCount,
        categories,
        currentView,
        gridMode,
        isGlobeView,
        lens,
        onAlertsClick: () => {setShowNotifications(!showNotifications)},
        onCategoryChange: handleCategoryChange,
        onOpenSidebar: () => {setSidebarOpen(true)},
        onSortModeChange: handleSortModeChange,
        onViewChange: handleViewChange,
        onViewPreload: preloadView,
        sortMode,
        topicSortMode,
      }}
      lead={{
        articleCount,
        currentView,
        isBlindspotView,
        isGlobeView,
        leadArticle,
        sourceCount,
      }}
      activeView={{
        activeCategory,
        articles: browseArticles,
        categoryId: activeCategory,
        currentView,
        debugMode,
        gridMode,
        loading,
        onGridModeChange: setGridMode,
        selectedSourceIds,
        topicSortMode,
        totalCount: browseIndexTotalCount,
      }}
      categories={categories}
      activeCategory={activeCategory}
      onCategoryChange={handleCategoryChange}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onOpenSidebar={() => {setSidebarOpen(true)}}
      sourceSidebar={{
        isOpen: sidebarOpen,
        onClose: () => {setSidebarOpen(false)},
        sourceRecency,
      }}
      leadModal={leadModalOpen && leadArticle ? {
        article: leadArticle,
        onClose: () => {setLeadModalOpen(false)},
      } : null}
    />
  )
}
export default function Page() {
  return (
    <ErrorBoundary>
      <NewsPage />
    </ErrorBoundary>
  );
}
