"use client"

import { useMemo, useRef, useState, type PointerEvent, type RefObject } from "react"
import { InteractiveGlobe } from "./interactive-globe"
import { ArticleDetailModal } from "./article-detail-modal"
import { cn } from "@/lib/utils"
import {
  fetchCountryGeoData,
  type CountryArticleCounts,
  type NewsArticle,
} from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AlertCircle,
  ChevronDown,
  Globe2,
  Lamp,
  MapPin,
  Newspaper,
  Radio,
  PanelRight,
  ShieldCheck,
  Signal,
  X,
  Bookmark,
  MoreHorizontal
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SafeImage } from "@/components/safe-image"
import {
  buildCountryListFromArticles,
  buildCountryMetricsFromArticles,
  buildLocalLensFromArticles,
} from "@/lib/globe-live-data"
import { useBookmarks } from "@/hooks/useBookmarks"

interface GlobeViewProps {
  articles: NewsArticle[]
  loading: boolean
}

function hasRealImage(src?: string | null) {
  if (!src) return false
  const trimmed = src.trim()
  if (!trimmed || trimmed === "none") return false
  const lower = trimmed.toLowerCase()
  return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg")
}

function formatPublishedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function sourceLabel(article: NewsArticle) {
  return article.source_country && article.source_country !== "International"
    ? `${article.source} · ${article.source_country}`
    : article.source
}

function articleRenderKey(article: NewsArticle, index: number): string {
  const identity = article.id > 0 ? String(article.id) : article.url
  return `${identity}-${article.url}-${index}`
}

function intensityLabel(metrics?: CountryArticleCounts) {
  if (!metrics?.counts) return "Coverage heat"
  return metrics.window_hours ? `Coverage heat · ${metrics.window_hours}h` : "Coverage heat"
}

function signalTotal(
  metrics: CountryArticleCounts | undefined,
  signalId: string,
  countryCode: string | null,
) {
  if (!metrics?.geo_signals || !countryCode) return 0
  const signal = metrics.geo_signals.find((item) => item.id === signalId)
  if (!signal) return 0
  return signal.country_counts[countryCode] || 0
}

export function GlobeView({ articles, loading }: GlobeViewProps) {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"internal" | "external">("internal")
  const [sidebarTab, setSidebarTab] = useState("briefing")
  const [isFocusExpanded, setIsFocusExpanded] = useState(false)
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false)
  const [lensLimit, setLensLimit] = useState(40)
  const [earthLightingMode, setEarthLightingMode] = useState<"all-lit" | "day-night">("all-lit")
  const [expandedSort, setExpandedSort] = useState<"recent" | "oldest" | "source">("recent")
  const lensBriefRef = useRef<HTMLDivElement | null>(null)
  const topStoriesRef = useRef<HTMLDivElement | null>(null)
  const trendingTopicsRef = useRef<HTMLDivElement | null>(null)
  const sourceBreakdownRef = useRef<HTMLDivElement | null>(null)
  const coverageMapRef = useRef<HTMLDivElement | null>(null)
  const sheetDragRef = useRef<{ startY: number; lastY: number; pointerId: number; moved: boolean } | null>(null)
  const sheetDragSuppressClickRef = useRef(false)
  const { isBookmarked, toggleBookmark } = useBookmarks()

  const { data: geoData } = useQuery({
    queryKey: ["country-geo-data"],
    queryFn: fetchCountryGeoData,
    staleTime: Infinity,
  })

  const countryMetrics = useMemo<CountryArticleCounts>(
    () => buildCountryMetricsFromArticles(articles),
    [articles],
  )
  const countryList = useMemo(
    () => buildCountryListFromArticles(articles),
    [articles],
  )
  const localLensData = useMemo(() => {
    if (!selectedCountry) {
      return null
    }

    const countryName =
      geoData?.countries?.[selectedCountry]?.name || selectedCountryName || selectedCountry

    return buildLocalLensFromArticles({
      articles,
      code: selectedCountry,
      countryName,
      view: viewMode,
      limit: lensLimit,
    })
  }, [articles, geoData, lensLimit, selectedCountry, selectedCountryName, viewMode])

  const handleCountrySelect = (country: string | null, name?: string | null) => {
    setSelectedCountry(country)
    const resolvedName = country && geoData?.countries?.[country]?.name
    setSelectedCountryName(country ? resolvedName || name || country : null)
    setViewMode("internal")
    setSidebarTab("briefing")
    setIsFocusExpanded(false)
    setIsMobileSheetExpanded(false)
    setLensLimit(40)
  }

  const handleArticleSelect = (article: NewsArticle) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  const globalSourceSummary = useMemo(() => {
    const counts = new Map<string, number>()
    articles.forEach((article) => {
      const key = article.source || "Unknown"
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [articles])
  const globalSourceCount = useMemo(() => {
    return new Set(
      articles
        .map((article) => article.sourceId || article.source)
        .filter((value): value is string => Boolean(value)),
    ).size
  }, [articles])

  const selectedLensArticles = selectedCountry ? localLensData?.articles || [] : []
  const lensArticles = selectedCountry ? selectedLensArticles : articles

  const sourceSummary = useMemo(() => {
    const counts = new Map<string, number>()
    lensArticles.forEach((article) => {
      const key = article.source || "Unknown"
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [lensArticles])

  const sourceWorkspace = useMemo(() => {
    return sourceSummary.slice(0, 12).map((source) => {
      const sourceArticles = lensArticles.filter((article) => (article.source || "Unknown") === source.name)
      return {
        ...source,
        latestArticle: sourceArticles[0] || null,
        latestPublishedAt: sourceArticles[0]?.publishedAt || null,
        credibilityShare: sourceArticles.length === 0
          ? 0
          : Math.round(
              (sourceArticles.filter((article) => article.credibility === "high").length / sourceArticles.length) * 100,
            ),
        countries: Array.from(
          new Set(
            sourceArticles
              .map((article) => article.source_country || article.country)
              .filter((value): value is string => Boolean(value)),
          ),
        ).slice(0, 3),
      }
    })
  }, [lensArticles, sourceSummary])

  const sourceCoverageLeaders = useMemo(() => {
    if (sourceWorkspace.length === 0) return []
    const leadCount = sourceWorkspace[0]?.count || 1
    return sourceWorkspace.map((source) => ({
      ...source,
      share: Math.max(8, Math.round((source.count / leadCount) * 100)),
    }))
  }, [sourceWorkspace])

  const verificationStats = useMemo(() => {
    const total = lensArticles.length
    if (total === 0) return { highPct: 0 }
    const high = lensArticles.filter((article) => article.credibility === "high").length
    return { highPct: Math.round((high / total) * 100) }
  }, [lensArticles])

  const selectedCountryCoverage = selectedCountry
    ? countryMetrics?.counts?.[selectedCountry] || 0
    : 0
  const selectedCountrySourceVolume = selectedCountry
    ? countryMetrics?.source_counts?.[selectedCountry] || 0
    : 0
  const selectedCountryMentionVolume = signalTotal(
    countryMetrics,
    "country_mentions",
    selectedCountry,
  )
  const selectedCountryOriginVolume = signalTotal(
    countryMetrics,
    "source_origin",
    selectedCountry,
  )
  const focusLabel = selectedCountryName || "Global Focus"
  const leadArticle = lensArticles[0] || null
  const topSources = (selectedCountry ? sourceSummary : globalSourceSummary).slice(0, 5)
  const briefingDescription = selectedCountry
    ? localLensData?.view_description || "Choose a lens to compare internal and external coverage."
    : "Select a country to compare what local outlets say with how the rest of the world covers it."
  const matchingStrategy = localLensData?.matching_strategy
  const isBriefingLoading = selectedCountry ? false : loading
  const sourceCount = selectedCountry
    ? localLensData?.source_count || sourceSummary.length
    : globalSourceCount
  const articleCount = selectedCountry ? localLensData?.total || 0 : articles.length
  const selectedCountryMeta = useMemo(() => {
    if (!selectedCountry) return null
    return countryList?.countries.find((item) => item.code === selectedCountry) || null
  }, [countryList, selectedCountry])

  const latestLensTimestamp = useMemo(() => {
    const validTimestamps = lensArticles
      .map((article) => new Date(article.publishedAt).getTime())
      .filter((value) => Number.isFinite(value))
    if (validTimestamps.length === 0) return null
    return Math.max(...validTimestamps)
  }, [lensArticles])

  const expandedArticles = useMemo(() => {
    const sorted = [...lensArticles]
    if (expandedSort === "source") {
      sorted.sort((a, b) => {
        const sourceCompare = (a.source || "").localeCompare(b.source || "")
        if (sourceCompare !== 0) return sourceCompare
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      })
      return sorted
    }

    sorted.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
    if (expandedSort === "recent") {
      sorted.reverse()
    }
    return sorted
  }, [expandedSort, lensArticles])

  const topicSignals = useMemo(() => {
    const counts = new Map<string, number>()
    lensArticles.forEach((article) => {
      const tokens = [
        ...(article.tags || []),
        article.category,
        article.geo_signal?.label,
      ].filter((value): value is string => Boolean(value && value.trim()))

      tokens.forEach((token) => {
        const normalized = token.trim()
        counts.set(normalized, (counts.get(normalized) || 0) + 1)
      })
    })

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [lensArticles])

  const coverageBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    lensArticles.forEach((article) => {
      const countries = article.mentioned_countries?.length
        ? article.mentioned_countries
        : article.source_country
          ? [article.source_country]
          : []
      countries.forEach((country) => {
        counts.set(country, (counts.get(country) || 0) + 1)
      })
    })
    return Array.from(counts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [lensArticles])

  const intensityScore = useMemo(() => {
    const maxCoverage = Math.max(...Object.values(countryMetrics?.counts || {}), 0)
    if (!selectedCountry || maxCoverage === 0) return 0
    return Math.max(1, Math.min(5, Math.ceil((selectedCountryCoverage / maxCoverage) * 5)))
  }, [countryMetrics?.counts, selectedCountry, selectedCountryCoverage])

  const sortLabel = expandedSort === "recent"
    ? "Most Recent"
    : expandedSort === "oldest"
      ? "Oldest First"
      : "Source A-Z"

  const cycleExpandedSort = () => {
    setExpandedSort((current) => {
      if (current === "recent") return "oldest"
      if (current === "oldest") return "source"
      return "recent"
    })
  }

  const scrollToSection = (ref: RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleSheetHandleClick = () => {
    if (sheetDragSuppressClickRef.current) {
      sheetDragSuppressClickRef.current = false
      return
    }
    setIsMobileSheetExpanded((value) => !value)
  }

  const handleSheetDragStart = (event: PointerEvent<HTMLButtonElement>) => {
    sheetDragRef.current = {
      startY: event.clientY,
      lastY: event.clientY,
      pointerId: event.pointerId,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleSheetDragMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = sheetDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.lastY = event.clientY
    if (Math.abs(drag.lastY - drag.startY) > 8) {
      drag.moved = true
    }
  }

  const finishSheetDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = sheetDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    sheetDragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)

    const deltaY = drag.lastY - drag.startY
    if (!drag.moved || Math.abs(deltaY) < 36) return

    setIsMobileSheetExpanded(deltaY < 0)
    sheetDragSuppressClickRef.current = true
    window.setTimeout(() => {
      sheetDragSuppressClickRef.current = false
    }, 0)
  }

  const cancelSheetDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (sheetDragRef.current?.pointerId === event.pointerId) {
      sheetDragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <div className="absolute inset-0 z-0">
        <InteractiveGlobe
          articles={articles}
          countryMetrics={countryMetrics}
          onCountrySelect={handleCountrySelect}
          selectedCountry={selectedCountry}
          lightingMode={earthLightingMode}
        />
        {/* Globe Overlay for contrast */}
        <div className="absolute inset-0 bg-black/20 pointer-events-none" />
      </div>

      {/* Floating Header */}
      <div className={cn(
        "pointer-events-none absolute left-3 right-3 top-3 z-10 hidden transition-all duration-500 lg:left-8 lg:right-auto lg:top-8 lg:block",
        isFocusExpanded ? "opacity-0" : selectedCountry ? "opacity-0 lg:opacity-100" : "opacity-100"
      )}>
        <div className={cn("pointer-events-auto max-w-full space-y-2 rounded-2xl border border-white/10 bg-black/40 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-500 lg:max-w-[31rem] lg:space-y-3 lg:p-6", selectedCountry ? "scale-95 lg:scale-100" : "scale-100")}>
          <div className="flex items-center gap-2 lg:gap-3">
            <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-primary">
              Global Desk
            </span>
            <span className="font-mono text-[9px] lg:text-[10px] uppercase tracking-widest text-muted-foreground">
              {selectedCountry ? `${articleCount} lens articles` : `${articles.length} live articles`}
            </span>
          </div>
          <h2 className="font-serif text-3xl font-semibold tracking-tight text-foreground drop-shadow-md lg:text-5xl">
            {focusLabel}
          </h2>
          <p className="max-w-[20rem] text-xs leading-relaxed text-foreground/75 lg:max-w-md lg:text-sm">
            {briefingDescription}
          </p>
          {selectedCountry && (
            <button
              onClick={() => handleCountrySelect(null)}
              className="group flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground transition-colors hover:text-primary mt-2"
            >
              <X size={12} className="transition-transform group-hover:rotate-90" />
              Reset Focus
            </button>
          )}
        </div>
      </div>

      {/* Floating Bottom Left Intensity */}
      <div className={cn("absolute bottom-8 left-8 z-10 hidden lg:block transition-opacity duration-500", isFocusExpanded ? "opacity-0" : "opacity-100")}>
        <div className="flex items-center gap-6 rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/80">
              {intensityLabel(countryMetrics)}
            </span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              Intensity
            </span>
            <div className="flex gap-1">
              <div className="h-1.5 w-3 rounded-sm bg-primary/20" />
              <div className="h-1.5 w-3 rounded-sm bg-primary/40" />
              <div className="h-1.5 w-3 rounded-sm bg-primary/60" />
              <div className="h-1.5 w-3 rounded-sm bg-primary/80" />
              <div className="h-1.5 w-3 rounded-sm bg-primary" />
            </div>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <Lamp className="h-3.5 w-3.5 text-foreground/55" />
            <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-1">
              <button
                onClick={() => setEarthLightingMode("all-lit")}
                className={cn(
                  "rounded-full px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] transition-colors",
                  earthLightingMode === "all-lit"
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                All Lit
              </button>
              <button
                onClick={() => setEarthLightingMode("day-night")}
                className={cn(
                  "rounded-full px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] transition-colors",
                  earthLightingMode === "day-night"
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Day/Night
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Small Panel (Collapsed) */}
      <div className={cn(
        "absolute z-40 flex flex-col shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height,max-height]",
        "bg-black/55 backdrop-blur-2xl border border-white/10",
        selectedCountry
            ? cn(
                "bottom-0 left-0 right-0 translate-y-0 overflow-y-auto rounded-t-3xl lg:bottom-4 lg:right-4 lg:top-4 lg:left-auto lg:h-auto lg:w-[420px] lg:rounded-2xl lg:overflow-hidden",
                isMobileSheetExpanded ? "h-[58vh]" : "max-h-[26vh]",
              )
            : cn(
                "bottom-0 left-0 right-0 translate-y-0 overflow-y-auto rounded-t-3xl lg:bottom-4 lg:right-4 lg:top-auto lg:left-auto lg:h-auto lg:w-[420px] lg:translate-y-0 lg:rounded-2xl lg:overflow-hidden",
                isMobileSheetExpanded ? "h-[58vh]" : "max-h-[28vh]",
              ),
        isFocusExpanded ? "opacity-0 pointer-events-none hidden" : "opacity-100 pointer-events-auto"
      )}>
        <div className="space-y-2.5 border-b border-white/10 p-3 shrink-0 lg:space-y-3 lg:p-4">
          <button
            type="button"
            onClick={handleSheetHandleClick}
            onPointerDown={handleSheetDragStart}
            onPointerMove={handleSheetDragMove}
            onPointerUp={finishSheetDrag}
            onPointerCancel={cancelSheetDrag}
            className="group mx-auto -my-1 flex h-8 w-24 touch-none items-center justify-center lg:hidden"
            aria-label={isMobileSheetExpanded ? "Collapse globe briefing" : "Expand globe briefing"}
          >
            <span className="h-1 w-12 rounded-full bg-white/35 transition-all duration-200 group-hover:w-16 group-hover:bg-white/60 group-active:w-20 group-active:bg-primary/80" />
          </button>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Focus</p>
              <h3 className="font-serif text-2xl text-foreground mt-1 mb-1 lg:text-3xl xl:text-4xl">{focusLabel}</h3>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground/80">{articleCount}</span> articles
                  <span className="text-white/20">•</span>
                  <span className="font-medium text-foreground/80">{sourceCount}</span> sources
                  {selectedCountry && (
                    <>
                      <span className="text-white/20">•</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help flex items-center gap-1">
                              <span className="font-medium text-foreground/80">{selectedCountryCoverage}</span>
                              coverage heat
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Combined global attention signal for this country in the active window.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </>
                  )}
                </div>
                {selectedCountry && selectedCountryMeta?.latest_article && isMobileSheetExpanded && (
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
                    Latest: {formatPublishedDate(selectedCountryMeta.latest_article)}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsMobileSheetExpanded((value) => !value)}
              className="h-8 w-8 rounded-full border-white/10 bg-transparent p-0 hover:bg-white/5 lg:hidden"
              aria-label={isMobileSheetExpanded ? "Collapse globe briefing" : "Expand globe briefing"}
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", isMobileSheetExpanded && "rotate-180")} />
            </Button>
            {selectedCountry && (
              <div className="flex flex-col items-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFocusExpanded(true)}
                  className="hidden rounded-full border-white/10 bg-transparent px-3 text-[10px] hover:bg-white/5 lg:flex h-8"
                >
                  <ChevronDown className="mr-1.5 h-3 w-3 rotate-180" />
                  Expand Focus
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCountrySelect(null)}
                  className="rounded-full border-white/10 bg-transparent hover:bg-white/5 h-8 w-8 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {!selectedCountry && (
            <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-xs leading-relaxed text-muted-foreground mt-2 lg:p-4 lg:mt-4">
              The map shows recent coverage volume. Click a country to view local and foreign reporting.
            </div>
          )}

          <div
            className={cn(
              "rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/30 p-4 text-xs leading-relaxed text-muted-foreground",
              selectedCountry && "hidden",
              !isMobileSheetExpanded && "hidden lg:block",
            )}
          >
            Use the globe as the country navigator. Hover to inspect coverage heat, then click a
            country to open its local and world lens.
          </div>

          {topSources.length > 0 && (
            <div className={cn("flex flex-wrap gap-2 mt-2 lg:mt-4", !isMobileSheetExpanded && "hidden lg:flex")}>
              {topSources.map((source) => (
                <Badge key={source.name} variant="outline" className="rounded-full border-white/10 bg-white/5 px-3 py-1 text-[9px] uppercase tracking-wide">
                  {source.name} · {source.count}
                </Badge>
              ))}
            </div>
          )}

          <Tabs value={sidebarTab} onValueChange={setSidebarTab} className={cn("w-full mt-4", !isMobileSheetExpanded && "hidden lg:block")}>
            <TabsList className="grid w-full grid-cols-3 rounded-full border border-white/10 bg-black/20 p-1 h-auto">
              <TabsTrigger
                value="briefing"
                className="rounded-full text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
              >
                Briefing
              </TabsTrigger>
              <TabsTrigger
                value="intelligence"
                className="rounded-full text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
              >
                Intel
              </TabsTrigger>
              <TabsTrigger
                value="sources"
                className="rounded-full text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
              >
                Sources
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className={cn("grid grid-cols-2 gap-2 lg:hidden", !isMobileSheetExpanded && "hidden")}>
            <button
              type="button"
              onClick={() => setEarthLightingMode("all-lit")}
              className={cn(
                "rounded-full border border-white/10 px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em]",
                earthLightingMode === "all-lit" ? "bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              All Lit
            </button>
            <button
              type="button"
              onClick={() => setEarthLightingMode("day-night")}
              className={cn(
                "rounded-full border border-white/10 px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em]",
                earthLightingMode === "day-night" ? "bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              Day/Night
            </button>
          </div>
        </div>

        <div className={cn("relative flex min-h-0 flex-1 flex-col lg:overflow-hidden", !isMobileSheetExpanded && "hidden lg:flex")}>
          {sidebarTab === "briefing" && (
            <div className="flex h-full flex-col min-h-0">
              <div className="border-b border-white/10 bg-[var(--news-bg-primary)]/30 px-4 py-3">
                <Tabs
                  value={viewMode}
                  onValueChange={(value) => setViewMode(value === "external" ? "external" : "internal")}
                  className="w-full"
                >
                  <TabsList className="h-10 w-full rounded-full border border-white/10 bg-black/20 p-1">
                    <TabsTrigger
                      value="internal"
                      className="h-full flex-1 rounded-full text-[10px] sm:text-xs uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                    >
                      Local Lens
                    </TabsTrigger>
                    <TabsTrigger
                      value="external"
                      className="h-full flex-1 rounded-full text-[10px] sm:text-xs uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                    >
                      World Lens
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="flex-1 min-h-0 space-y-4 p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
                {!selectedCountry && (
                  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Globe2 size={14} className="text-primary" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        How to use it
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Pick a country to see two lenses: what its own outlets publish, and how
                      foreign outlets frame the same place.
                    </p>
                  </div>
                )}

                {selectedCountry && isBriefingLoading && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Radio className="mb-3 h-8 w-8 animate-pulse opacity-20" />
                    <p className="text-xs uppercase tracking-widest">Loading country lens</p>
                  </div>
                )}

                {selectedCountry && !isBriefingLoading && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <MapPin size={14} className="text-primary" />
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Lens brief
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{briefingDescription}</p>
                      {localLensData?.geo_signal && (
                        <div className="mt-3">
                          <Badge
                            variant="outline"
                            className="rounded-full border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground"
                          >
                            {localLensData.geo_signal.label}
                          </Badge>
                        </div>
                      )}
                      {matchingStrategy && (
                        <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
                          Match: {matchingStrategy.replaceAll("_", " ")}
                        </p>
                      )}
                      {selectedCountryMeta?.latest_article && (
                        <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
                          Latest indexed: {formatPublishedDate(selectedCountryMeta.latest_article)}
                        </p>
                      )}
                    </div>

                    {lensArticles.length > 0 ? (
                      lensArticles.map((article, index) => (
                        <div
                          key={articleRenderKey(article, index)}
                          onClick={() => handleArticleSelect(article)}
                          className="group cursor-pointer rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4 transition-all hover:border-white/40 hover:bg-[var(--news-bg-primary)] hover:scale-[1.02]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="h-4 rounded-full border-white/10 py-0 text-[8px] uppercase tracking-wider text-muted-foreground group-hover:border-white/40 group-hover:text-foreground"
                                >
                                  {sourceLabel(article)}
                                </Badge>
                                <span className="text-[9px] text-muted-foreground">
                                  {formatPublishedDate(article.publishedAt)}
                                </span>
                              </div>
                              <h4 className="font-serif text-sm font-medium leading-snug transition-colors group-hover:text-foreground">
                                {article.title}
                              </h4>
                              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {article.summary}
                              </p>
                              {(article.geo_signal || (article.mentioned_countries && article.mentioned_countries.length > 0)) && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {article.geo_signal && (
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground"
                                    >
                                      {article.geo_signal.label}
                                    </Badge>
                                  )}
                                  {(article.mentioned_countries || []).slice(0, 4).map((countryCode) => (
                                    <Badge
                                      key={`${article.id}-${countryCode}`}
                                      variant="outline"
                                      className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground"
                                    >
                                      {countryCode}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            {hasRealImage(article.image) && (
                              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-primary)]/40">
                                <SafeImage
                                  src={article.image}
                                  alt=""
                                  width={64}
                                  height={64}
                                  className="h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-100"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Radio className="mb-3 h-8 w-8 opacity-20" />
                        <p className="text-xs uppercase tracking-widest">No articles found</p>
                      </div>
                    )}

                    {selectedCountry && localLensData?.has_more && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLensLimit((prev) => prev + 20)}
                        className="w-full rounded-xl border-white/10 hover:bg-white/5"
                      >
                        Show More Articles
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {sidebarTab === "intelligence" && (
            <div className="flex-1 space-y-6 p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40">
                <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
                  <Newspaper size={14} className="text-primary" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Spotlight Story
                  </span>
                </div>
                {leadArticle ? (
                  <div className="cursor-pointer p-4 group" onClick={() => handleArticleSelect(leadArticle)}>
                    {hasRealImage(leadArticle.image) && (
                      <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg border border-white/10">
                        <SafeImage
                          src={leadArticle.image}
                          className="h-full w-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-500"
                          alt="Lead"
                          fill
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-2 left-2 right-2">
                          <h4 className="font-serif text-sm font-medium leading-tight text-foreground drop-shadow-md">
                            {leadArticle.title}
                          </h4>
                        </div>
                      </div>
                    )}
                    <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {leadArticle.summary}
                    </p>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">No lead story available</div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40">
                <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
                  <ShieldCheck size={14} className="text-foreground/70" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Verification Signal
                  </span>
                </div>
                <div className="space-y-4 p-4">
                  <div className="flex items-end justify-between">
                    <div className="text-3xl font-bold text-foreground">{verificationStats.highPct}%</div>
                    <div className="mb-1 text-right text-[10px] text-muted-foreground">
                      High Credibility
                      <br />
                      Sources
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-white/40"
                      style={{ width: `${verificationStats.highPct}%` }}
                    />
                  </div>
                  <div className="text-xs leading-relaxed text-muted-foreground">
                    Based on {lensArticles.length} articles from {sourceSummary.length} active
                    sources in this lens.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                  <div className="text-xl font-bold">{articleCount}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                    Total Briefs
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                  <div className="text-xl font-bold">{sourceCount}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                    Active Feeds
                  </div>
                </div>
              </div>

              {selectedCountry && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 backdrop-blur-md p-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-primary" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Reading angle
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Local Lens shows coverage from inside {focusLabel}. World Lens keeps the country
                    fixed but swaps the narrators to outside sources.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-md p-3">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Local lens
                      </div>
                      <div className="mt-2 text-sm text-foreground">
                        {selectedCountryOriginVolume || selectedCountrySourceVolume} source-origin
                        signals
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-md p-3">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        World lens
                      </div>
                      <div className="mt-2 text-sm text-foreground">
                        {selectedCountryMentionVolume || selectedCountryCoverage} article mentions in
                        window
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {sidebarTab === "sources" && (
            <div className="flex-1 min-h-0 p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
              <div className="rounded-2xl border border-white/10 bg-[var(--news-bg-primary)]/30 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                      Source Workspace
                    </div>
                    <div className="mt-1 text-sm text-foreground">
                      {selectedCountry ? `Active outlets in ${focusLabel}` : "Top live outlets in the current globe feed"}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-primary"
                  >
                    {sourceCount} sources
                  </Badge>
                </div>

                {!selectedCountry && (
                  <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-muted-foreground">
                    Pick a country to turn this into a local source workspace. Until then, this tab shows the strongest live sources across the global feed.
                  </div>
                )}

                <div className="space-y-2">
                  {sourceWorkspace.slice(0, selectedCountry ? 10 : 8).map((source, index) => (
                    <button
                      key={`${source.name}-${index}`}
                      type="button"
                      onClick={() => source.latestArticle && handleArticleSelect(source.latestArticle)}
                      className="w-full rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-left transition-colors hover:border-white/40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-foreground">
                            <Signal size={14} />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{source.name}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {selectedCountry ? "Lens source" : "Live source"}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 rounded-full border-white/10 bg-white/5 text-muted-foreground"
                        >
                          {source.count}
                        </Badge>
                      </div>
                    </button>
                  ))}
                  {sourceWorkspace.length === 0 && (
                    <div className="py-12 text-center text-xs uppercase tracking-widest text-muted-foreground">
                      No sources available
                    </div>
                  )}
                </div>

                {sourceSummary.length > (selectedCountry ? 10 : 8) && (
                  <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                    Showing top {selectedCountry ? 10 : 8} of {sourceSummary.length} sources
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Expanded Dashboard (3-Column Layout) */}
      <div className={cn(
        "absolute inset-0 z-50 hidden text-foreground transition-all duration-500 lg:block",
        isFocusExpanded ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none hidden"
      )}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(186,137,63,0.14),transparent_28%),rgba(3,3,3,0.36)] backdrop-blur-md" />
        <div className="relative z-10 flex h-full">
        {/* Left Sidebar */}
        <div className="w-[280px] border-r border-white/10 flex flex-col overflow-y-auto custom-scrollbar bg-black/35 backdrop-blur-xl">
          {/* FOCUS */}
          <div className="p-6 border-b border-white/10">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Focus</h3>
            <h2 className="font-serif text-3xl mb-2 text-foreground">{focusLabel}</h2>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>{articleCount} articles</span>
              <span>·</span>
              <span>{sourceCount} sources</span>
              <span>·</span>
              <span>{selectedCountryCoverage} coverage heat</span>
            </div>
            {selectedCountryMeta?.latest_article && (
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60 mt-3">
                Latest: {formatPublishedDate(selectedCountryMeta.latest_article)}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-4">
              {topSources.map(s => (
                 <Badge variant="outline" key={s.name} className="rounded-full text-[9px] uppercase tracking-wider border-primary/25 bg-primary/10 text-primary px-2 py-0.5">
                   {s.name} · {s.count}
                 </Badge>
              ))}
              {sourceCount > 5 && (
                 <Badge variant="outline" className="rounded-full text-[9px] uppercase tracking-wider border-white/10 bg-white/5 text-muted-foreground px-2 py-0.5">
                   + {sourceCount - 5} More
                 </Badge>
              )}
            </div>
          </div>

          {/* VIEWS */}
          <div className="p-6 border-b border-white/10">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Views</h3>
            <div className="flex flex-col gap-0 rounded-2xl border border-white/10 overflow-hidden bg-black/30">
              <button
                onClick={() => setViewMode("internal")}
                className={cn(
                  "w-full text-left px-3 py-3 text-[9px] uppercase tracking-[0.14em] flex items-center gap-2.5 border-b border-white/10 transition-colors whitespace-nowrap",
                  viewMode === "internal" ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <Radio size={14} className={viewMode === "internal" ? "text-primary" : ""} /> Local Lens
              </button>
              <button
                onClick={() => setViewMode("external")}
                className={cn(
                  "w-full text-left px-3 py-3 text-[9px] uppercase tracking-[0.14em] flex items-center gap-2.5 transition-colors whitespace-nowrap",
                  viewMode === "external" ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <Globe2 size={14} className={viewMode === "external" ? "text-primary" : ""} /> World Lens
              </button>
            </div>
          </div>

          {/* QUICK NAV */}
          <div className="p-6 border-b border-white/10">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Quick Nav</h3>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => { setSidebarTab("briefing"); scrollToSection(lensBriefRef) }}
                className={cn(
                  "w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 rounded-xl transition-colors",
                  sidebarTab === "briefing" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-primary" /> Lens Brief
              </button>
              <button onClick={() => { setSidebarTab("briefing"); scrollToSection(topStoriesRef) }} className={cn("w-full text-left px-3 py-2.5 text-sm rounded-xl transition-colors", sidebarTab === "briefing" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>Top Stories</button>
              <button onClick={() => { setSidebarTab("intelligence"); scrollToSection(trendingTopicsRef) }} className={cn("w-full text-left px-3 py-2.5 text-sm rounded-xl transition-colors", sidebarTab === "intelligence" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>Trending Topics</button>
              <button onClick={() => { setSidebarTab("sources"); scrollToSection(sourceBreakdownRef) }} className={cn("w-full text-left px-3 py-2.5 text-sm rounded-xl transition-colors", sidebarTab === "sources" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>Source Breakdown</button>
              <button onClick={() => { setSidebarTab("sources"); scrollToSection(coverageMapRef) }} className={cn("w-full text-left px-3 py-2.5 text-sm rounded-xl transition-colors", sidebarTab === "sources" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>Coverage Map</button>
            </div>
          </div>

          {/* ABOUT GLOBE VIEW */}
          <div className="p-6 mt-auto">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2"><Globe2 size={12}/> About Globe View</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Compare how local outlets report on their own country versus how the world covers it.
            </p>
            <button onClick={() => { setSidebarTab("sources"); scrollToSection(coverageMapRef) }} className="text-primary border-b border-primary/60 text-xs mt-3 inline-flex items-center pb-0.5 hover:opacity-80">Learn more →</button>
          </div>
        </div>

        {/* Center Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-transparent">
          {/* Top Nav / Tabs */}
          <div className="flex items-center justify-between px-8 py-0 border-b border-white/10 bg-black/20 backdrop-blur-xl">
            <div className="flex gap-8 h-14">
              <button onClick={() => { setSidebarTab("briefing"); scrollToSection(lensBriefRef) }} className={cn("text-[10px] uppercase tracking-[0.2em] font-medium h-full border-b-2 transition-colors", sidebarTab === "briefing" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>Briefing</button>
              <button onClick={() => { setSidebarTab("intelligence"); scrollToSection(trendingTopicsRef) }} className={cn("text-[10px] uppercase tracking-[0.2em] font-medium h-full border-b-2 transition-colors", sidebarTab === "intelligence" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>Intel</button>
              <button onClick={() => { setSidebarTab("sources"); scrollToSection(sourceBreakdownRef) }} className={cn("text-[10px] uppercase tracking-[0.2em] font-medium h-full border-b-2 transition-colors", sidebarTab === "sources" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>Sources</button>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setIsFocusExpanded(false)} className="rounded-full border-white/10 bg-black/20 text-foreground hover:bg-white/5 text-xs px-4 h-9">
                <Globe2 className="mr-2 h-3.5 w-3.5" /> Show Global
              </Button>
              <Button variant="outline" size="icon" onClick={() => setIsFocusExpanded(false)} className="rounded-full border-white/10 bg-black/20 text-foreground hover:bg-white/5 h-9 w-9">
                <PanelRight size={14} />
              </Button>
            </div>
          </div>

          {/* Content Scroll */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
            {sidebarTab === "sources" && (
              <div className="space-y-8">
                <div className="rounded-[28px] border border-white/10 bg-black/30 p-8 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
                  <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                        Source Workspace
                      </div>
                      <h2 className="font-serif text-3xl text-foreground">
                        Source network behind {focusLabel}
                      </h2>
                      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                        This tab tracks which outlets are driving the current lens, where those
                        outlets are based, and which source clusters are actually carrying the story.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                          Active Sources
                        </div>
                        <div className="mt-2 font-serif text-2xl text-foreground">{sourceCount}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                          Routed Articles
                        </div>
                        <div className="mt-2 font-serif text-2xl text-foreground">{articleCount}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                          Top Source Share
                        </div>
                        <div className="mt-2 font-serif text-2xl text-foreground">
                          {sourceWorkspace[0] ? `${Math.round((sourceWorkspace[0].count / Math.max(articleCount, 1)) * 100)}%` : "0%"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                    <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
                      <div className="mb-5 flex items-center justify-between">
                        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                          Source Dossiers
                        </div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                          Live Data
                        </div>
                      </div>
                      <div className="space-y-3">
                        {sourceWorkspace.map((source, index) => (
                          <button
                            key={`${source.name}-${index}`}
                            type="button"
                            onClick={() => source.latestArticle && handleArticleSelect(source.latestArticle)}
                            className="w-full rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex flex-wrap items-center gap-3">
                                  <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-primary">
                                    {source.name}
                                  </Badge>
                                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                                    {source.count} articles
                                  </span>
                                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                                    {source.credibilityShare}% high credibility
                                  </span>
                                </div>
                                {source.latestArticle ? (
                                  <>
                                    <div className="font-serif text-lg text-foreground line-clamp-1">
                                      {source.latestArticle.title}
                                    </div>
                                    <div className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                                      {source.latestArticle.summary}
                                    </div>
                                    <div className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                                      Latest dispatch {formatPublishedDate(source.latestPublishedAt || source.latestArticle.publishedAt)}
                                    </div>
                                  </>
                                ) : (
                                  <div className="text-sm text-muted-foreground">No recent article available.</div>
                                )}
                              </div>
                              <div className="w-[180px] shrink-0">
                                <div className="mb-2 text-right text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                                  Coverage Footprint
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                  {source.countries.length > 0 ? source.countries.map((country) => (
                                    <Badge key={`${source.name}-${country}`} variant="outline" className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground">
                                      {country}
                                    </Badge>
                                  )) : (
                                    <span className="text-xs text-muted-foreground">No country tags</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                        {sourceWorkspace.length === 0 && (
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-10 text-center text-sm text-muted-foreground">
                            No sources available for this lens.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
                        <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                          Source Leaderboard
                        </div>
                        <div className="space-y-4">
                          {sourceCoverageLeaders.map((source) => (
                            <div key={`leader-${source.name}`}>
                              <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="truncate pr-4 text-foreground">{source.name}</span>
                                <span className="shrink-0 text-muted-foreground">{source.count}</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-[linear-gradient(90deg,rgba(186,137,63,0.95),rgba(231,118,43,0.95))]"
                                  style={{ width: `${source.share}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div
                        ref={sourceBreakdownRef}
                        className="rounded-[24px] border border-white/10 bg-black/20 p-6"
                      >
                        <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                          Source Breakdown
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                              Local Outlet Volume
                            </div>
                            <div className="mt-2 font-serif text-2xl text-foreground">
                              {selectedCountrySourceVolume || selectedCountryOriginVolume}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                              Coverage Heat
                            </div>
                            <div className="mt-2 font-serif text-2xl text-foreground">
                              {selectedCountryCoverage}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        ref={coverageMapRef}
                        className="rounded-[24px] border border-white/10 bg-black/20 p-6"
                      >
                        <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                          Coverage Map
                        </div>
                        <div className="space-y-3">
                          {coverageBreakdown.length > 0 ? coverageBreakdown.map((entry) => (
                            <div key={`source-map-${entry.country}`}>
                              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                                <span>{entry.country}</span>
                                <span>{entry.count}</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.max(12, (entry.count / coverageBreakdown[0].count) * 100)}%` }}
                                />
                              </div>
                            </div>
                          )) : (
                            <p className="text-sm text-muted-foreground">
                              Coverage breakdown appears after the lens resolves article geography.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {sidebarTab !== "sources" && (
              <>
                {/* Lens Brief Card */}
                <div ref={lensBriefRef} className="relative rounded-[28px] border border-primary/15 bg-[linear-gradient(135deg,rgba(186,137,63,0.12),rgba(10,10,10,0.78)_45%,rgba(10,10,10,0.92))] p-8 mb-8 overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
                  <div className="relative z-10 w-2/3">
                    <div className="flex items-center gap-2 text-primary mb-4">
                      <MapPin size={14} />
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Lens Brief</span>
                    </div>
                    <h2 className="text-2xl font-serif mb-6 text-foreground">{briefingDescription}</h2>
                    {localLensData?.geo_signal && (
                      <div className="mb-4">
                        <Badge variant="outline" className="rounded-full border-primary/25 bg-primary/10 text-[9px] uppercase tracking-widest text-primary px-3 py-1">
                          {localLensData.geo_signal.label}
                        </Badge>
                      </div>
                    )}
                    <div className="space-y-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                      <div>Match: {matchingStrategy ? matchingStrategy.replaceAll("_", " ") : "N/A"}</div>
                      <div>Latest Indexed: {latestLensTimestamp ? formatPublishedDate(new Date(latestLensTimestamp).toISOString()) : "N/A"}</div>
                    </div>
                  </div>
                  <div className="absolute right-8 top-1/2 -translate-y-1/2 opacity-60 flex items-center justify-center">
                    <div className="w-48 h-32 rounded-full bg-[radial-gradient(circle,rgba(186,137,63,0.45)_1px,transparent_1.4px)] [background-size:8px_8px] blur-[0.2px]"></div>
                  </div>
                </div>
              </>
            )}

            {sidebarTab !== "sources" && (
              <>
            {/* Article List Header */}
            <div ref={topStoriesRef} className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
               <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                 {articleCount} Articles
               </div>
               <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                 <span>Updated {latestLensTimestamp ? formatPublishedDate(new Date(latestLensTimestamp).toISOString()) : "N/A"} <Radio size={12} className="inline ml-1"/></span>
                 <button onClick={cycleExpandedSort} className="flex items-center gap-1 hover:text-foreground transition-colors">{sortLabel} <ChevronDown size={12}/></button>
               </div>
            </div>

            {/* Articles */}
            <div className="space-y-0 rounded-[28px] border border-white/10 overflow-hidden bg-black/30 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
               {expandedArticles.map((article, index) => (
                 <div key={articleRenderKey(article, index)} onClick={() => handleArticleSelect(article)} className="group flex gap-6 p-6 border-b border-white/10 last:border-0 hover:bg-white/[0.03] transition-all cursor-pointer">
                   <div className="flex-1 min-w-0 py-1">
                     <div className="flex items-center gap-3 mb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                       <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-primary px-2 py-0.5">{sourceLabel(article)}</Badge>
                       <span>{formatPublishedDate(article.publishedAt)}</span>
                     </div>
                     <h3 className="text-lg font-serif mb-2 group-hover:text-primary text-foreground transition-colors">{article.title}</h3>
                     <p className="text-sm text-muted-foreground line-clamp-2 mb-4 leading-relaxed">{article.summary}</p>
                     <div className="flex gap-2">
                       <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-widest text-muted-foreground px-2 py-0.5">{article.source_country === 'United States' ? 'US' : article.source_country || 'GLB'}</Badge>
                     </div>
                   </div>
                   {/* Right Actions & Image */}
                   <div className="flex flex-col items-end justify-between shrink-0">
                     <div className="flex gap-2 text-muted-foreground mb-2">
                       <button
                         type="button"
                         onClick={(event) => {
                           event.stopPropagation()
                           void toggleBookmark(article.id)
                         }}
                         className={cn("transition-colors", isBookmarked(article.id) ? "text-primary" : "hover:text-foreground")}
                         title={isBookmarked(article.id) ? "Remove bookmark" : "Bookmark article"}
                       >
                         <Bookmark size={16} className={isBookmarked(article.id) ? "fill-current" : ""} />
                       </button>
                       <button
                         type="button"
                         onClick={(event) => {
                           event.stopPropagation()
                           window.open(article.url, "_blank", "noopener,noreferrer")
                         }}
                         className="hover:text-foreground"
                         title="Open original article"
                       >
                         <MoreHorizontal size={16}/>
                       </button>
                     </div>
                     {hasRealImage(article.image) && (
                       <div className="w-[200px] h-[120px] rounded-2xl border border-white/10 sepia group-hover:sepia-0 transition-all overflow-hidden bg-[var(--news-bg-primary)]/40">
                         <SafeImage src={article.image} alt="" width={200} height={120} className="w-full h-full object-cover" />
                       </div>
                     )}
                   </div>
                 </div>
               ))}
               {expandedArticles.length === 0 && (
                 <div className="p-12 text-center text-muted-foreground text-sm font-mono uppercase tracking-widest">No articles available</div>
               )}
            </div>

            <div ref={trendingTopicsRef} className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl mt-8">
              <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                Trending Topics
              </div>
              <div className="flex flex-wrap gap-2">
                {topicSignals.length > 0 ? topicSignals.map((topic) => (
                  <Badge key={topic.label} variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-wider text-primary">
                    {topic.label} · {topic.count}
                  </Badge>
                )) : (
                  <p className="text-sm text-muted-foreground">No topic signals yet for this lens.</p>
                )}
              </div>
            </div>

            <div ref={sourceBreakdownRef} className="grid grid-cols-2 gap-6 mt-8">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
                <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  Source Breakdown
                </div>
                <div className="space-y-3">
                  {sourceSummary.slice(0, 6).map((source) => (
                    <div key={source.name} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{source.name}</span>
                      <span className="text-muted-foreground">{source.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
                <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  Lens Snapshot
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Coverage Heat</div>
                    <div className="mt-2 text-2xl font-serif text-foreground">{selectedCountryCoverage}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Intensity</div>
                    <div className="mt-2 text-2xl font-serif text-foreground">{intensityScore}/5</div>
                  </div>
                </div>
              </div>
            </div>

            <div ref={coverageMapRef} className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl mt-8">
              <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                Coverage Map
              </div>
              <div className="space-y-3">
                {coverageBreakdown.length > 0 ? coverageBreakdown.map((entry) => (
                  <div key={entry.country}>
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{entry.country}</span>
                      <span>{entry.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(12, (entry.count / coverageBreakdown[0].count) * 100)}%` }} />
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground">Coverage breakdown appears after the lens resolves article geography.</p>
                )}
              </div>
            </div>
              </>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-[320px] border-l border-white/10 p-5 flex flex-col overflow-y-auto custom-scrollbar bg-black/35 backdrop-blur-xl">
          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Focus</h3>
          <h2 className="font-serif text-2xl mb-2 text-foreground">{focusLabel}</h2>
          <div className="text-[10px] text-muted-foreground mb-5">
            {articleCount} articles · {sourceCount} sources · {selectedCountryCoverage} coverage heat
          </div>

          <div className="p-5 rounded-2xl border border-white/10 bg-black/30 text-sm text-muted-foreground leading-relaxed mb-5">
            This lens shows how news sources based in {focusLabel} report on their own country.
          </div>

          <div className="p-5 rounded-2xl border border-white/10 bg-black/30 mb-5">
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">Use the globe as the country navigator. Hover to inspect coverage heat, then click a country to open its local and world lens.</p>
            </div>
          </div>

          <div className="mb-6 max-h-[72px] overflow-y-auto pr-1 custom-scrollbar">
            <div className="flex flex-wrap gap-1.5">
            {topSources.map(s => (
               <Badge variant="outline" key={s.name} className="text-[9px] uppercase tracking-wider rounded-full border-primary/20 bg-primary/10 text-primary px-2 py-0.5">
                 {s.name} · {s.count}
               </Badge>
            ))}
            {sourceCount > 5 && (
               <Badge variant="outline" className="text-[9px] uppercase tracking-wider rounded-full border-white/10 bg-white/5 text-muted-foreground px-2 py-0.5">
                 + {sourceCount - 5} More
               </Badge>
            )}
            </div>
          </div>

          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">Lens Controls</h3>
          <div className="grid grid-cols-2 gap-0 rounded-2xl border border-white/10 overflow-hidden mb-8 bg-black/30 p-1">
            <button
              onClick={() => setViewMode("internal")}
              className={cn(
                "min-w-0 rounded-xl px-3 py-2.5 text-[9px] uppercase tracking-[0.1em] leading-none text-center whitespace-nowrap transition-colors",
                viewMode === "internal"
                  ? "bg-[rgba(186,137,63,0.18)] text-[#e5c27a]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              Local Lens
            </button>
            <button
              onClick={() => setViewMode("external")}
              className={cn(
                "min-w-0 rounded-xl px-3 py-2.5 text-[9px] uppercase tracking-[0.1em] leading-none text-center whitespace-nowrap transition-colors",
                viewMode === "external"
                  ? "bg-[rgba(186,137,63,0.18)] text-[#e5c27a]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              World Lens
            </button>
          </div>

          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2"><Globe2 size={12}/> How to use it</h3>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">
            Pick a country to see two lenses: what its own outlets publish, and how foreign outlets frame the same place.
          </p>
          <button onClick={() => scrollToSection(lensBriefRef)} className="text-primary border-b border-primary/60 text-[10px] uppercase tracking-widest mb-6 inline-block pb-0.5 hover:opacity-80 w-max">View guide →</button>

          <div className="flex justify-between items-end mb-3">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Coverage Heat</h3>
            <span className="text-sm font-mono text-foreground">{selectedCountryCoverage}</span>
          </div>
          <div className="flex gap-1 mb-2">
            {Array.from({length: 10}).map((_, i) => (
               <div key={i} className={cn("h-1.5 flex-1 rounded-full", i < Math.min(10, Math.ceil(selectedCountryCoverage / Math.max(1, Math.max(...Object.values(countryMetrics?.counts || {}), 1)) * 10)) ? "bg-primary" : "bg-white/10")} />
            ))}
          </div>
          <div className="flex justify-between text-[8px] uppercase tracking-widest text-muted-foreground mb-6">
            <span>Low</span>
            <span>High</span>
          </div>

          <div className="flex justify-between items-end mb-3">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Intensity</h3>
            <span className="text-sm font-mono text-foreground">{intensityScore}/5</span>
          </div>
          <div className="flex gap-1 mb-6">
            {Array.from({length: 5}).map((_, i) => (
               <div key={i} className={cn("h-1.5 flex-1 rounded-full", i < intensityScore ? "bg-primary" : "bg-white/10")} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-0 rounded-2xl border border-white/10 overflow-hidden mt-auto bg-black/30">
            <button onClick={() => setEarthLightingMode("all-lit")} className={cn("px-2 py-3 text-[9px] uppercase tracking-[0.18em] whitespace-nowrap border-r border-white/10 transition-colors", earthLightingMode === "all-lit" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>All Lit</button>
            <button onClick={() => setEarthLightingMode("day-night")} className={cn("px-2 py-3 text-[9px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors", earthLightingMode === "day-night" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>Day / Night</button>
          </div>
        </div>
        </div>
      </div>

      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}
