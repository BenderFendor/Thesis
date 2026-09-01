"use client"

import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from "react"
import { useCallback, useMemo, useRef, useState } from "react"
import { ArticleDetailModal } from "./article-detail-modal"
import { InteractiveGlobe } from "./interactive-globe"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  Bookmark,
  ChevronDown,
  Globe2,
  Lamp,
  MapPin,
  MoreHorizontal,
  Newspaper,
  PanelRight,
  Radio,
  ShieldCheck,
  Signal,
  X
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SafeImage } from "@/components/safe-image"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { CountryArticleCounts, CountryListItem, LocalLensResponse, NewsArticle } from '@/lib/api';
import { fetchCountryGeoData } from '@/lib/api';
import {
  buildCountryListFromArticles,
  buildCountryMetricsFromArticles,
  buildLocalLensFromArticles,
} from "@/lib/globe-live-data"
import { useBookmarks } from "@/hooks/useBookmarks"

interface GlobeViewProps {
  readonly articles: NewsArticle[]
  readonly loading: boolean
}

type LightingMode = "all-lit" | "day-night"
type CountryGeoData = Awaited<ReturnType<typeof fetchCountryGeoData>>
type PanelPointerEvent = Readonly<PointerEvent<HTMLButtonElement>>
type PanelPointerHandler = (event: PanelPointerEvent) => void
type ReadonlyArticle = Readonly<NewsArticle>
type ArticleList = readonly ReadonlyArticle[]
type CountrySelection = string | null
type LensViewMode = "internal" | "external"
type ExpandedSortMode = "recent" | "oldest" | "source"

interface SourceSummaryEntry {
  readonly name: string
  readonly count: number
}

interface WorkspaceSource extends SourceSummaryEntry {
  readonly latestArticle: ReadonlyArticle | undefined
  readonly latestPublishedAt: string | undefined
  readonly credibilityShare: number
  readonly countries: readonly string[]
}

interface WorkspaceLeader extends WorkspaceSource {
  readonly share: number
}

interface CoverageEntry {
  readonly country: string
  readonly count: number
}

interface TopicSignalEntry {
  readonly label: string
  readonly count: number
}

const ARTICLE_CARD_IMAGE_SIZE = 64,
 ARTICLE_COUNTRY_LIMIT = 4,
 COVERAGE_LIMIT = 6,
 DEFAULT_LENS_LIMIT = 40,
 EMPTY_COUNT = 0,
 FIRST_INDEX = 0,
 HEAT_SEGMENT_COUNT = 10,
 ICON_SIZE = 14,
 INTENSITY_SEGMENT_COUNT = 5,
 LENS_LIMIT_INCREMENT = 20,
 MAX_INTENSITY_SCORE = 5,
 MAX_PERCENT = 100,
 MIN_COVERAGE_BAR = 12,
 MIN_DRAG_DISTANCE = 36,
 MIN_DRAG_MOVEMENT = 8,
 MIN_SOURCE_SHARE = 8,
 TOPIC_SIGNAL_LIMIT = 8,
 TOP_SOURCE_LIMIT = 5,
 WORKSPACE_SOURCE_LIMIT = 12,

 hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > EMPTY_COUNT,

 hasCountrySelection = (country: CountrySelection): country is string =>
  country !== null && country !== "",

 hasRealImage = (src?: string | null): boolean => {
  if (!hasText(src)) {return false}
  const trimmed = src.trim()
  if (trimmed === "none") {return false}
  const lower = trimmed.toLowerCase()
  return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg")
},

 formatPublishedDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {return value}
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  })
},

 sourceLabel = (article: ReadonlyArticle): string => {
  if (hasText(article.source_country) && article.source_country !== "International") {
    return `${article.source} · ${article.source_country}`
  }
  return article.source
},

 articleRenderKey = (article: ReadonlyArticle, index: number): string => {
  let identity = article.url
  if (article.id > EMPTY_COUNT) {
    identity = String(article.id)
  }
  return `${identity}-${article.url}-${index}`
},

 intensityLabel = (metrics?: Readonly<CountryArticleCounts>): string => {
  if (!metrics?.counts) {return "Coverage heat"}
  if (metrics.window_hours !== undefined && metrics.window_hours > EMPTY_COUNT) {
    return `Coverage heat · ${metrics.window_hours}h`
  }
  return "Coverage heat"
},

 signalTotal = (
  metrics: Readonly<CountryArticleCounts> | undefined,
  signalId: string,
  countryCode: CountrySelection,
): number => {
  if (metrics?.geo_signals === undefined || countryCode === null || countryCode === "") {
    return EMPTY_COUNT
  }
  const signal = metrics.geo_signals.find((item) => item.id === signalId)
  if (signal === undefined) {return EMPTY_COUNT}
  return signal.country_counts[countryCode] ?? EMPTY_COUNT
},

 briefingDescriptionFor = (
  selectedCountry: CountrySelection,
  localLensData: Readonly<LocalLensResponse> | undefined,
): string => {
  if (selectedCountry === null || selectedCountry === "") {
    return "Select a country to compare what local outlets say with how the rest of the world covers it."
  }
  if (hasText(localLensData?.view_description)) {
    return localLensData.view_description
  }
  return "Choose a lens to compare internal and external coverage."
},

 buildSourceSummary = (articles: ArticleList): SourceSummaryEntry[] => {
  const counts = new Map<string, number>()
  for (const article of articles) {
    const key = hasText(article.source) ? article.source : "Unknown"
    counts.set(key, (counts.get(key) ?? EMPTY_COUNT) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .toSorted((left, right) => right.count - left.count)
},

 buildSourceWorkspace = (
  lensArticles: ArticleList,
  sourceSummary: readonly SourceSummaryEntry[],
): WorkspaceSource[] =>
  sourceSummary.slice(0, WORKSPACE_SOURCE_LIMIT).map((source) => {
    const sourceArticles = lensArticles.filter(
      (article) => (hasText(article.source) ? article.source : "Unknown") === source.name,
    ),
     highCredibilityCount = sourceArticles.filter((article) => article.credibility === "high").length,
     firstArticle = sourceArticles[FIRST_INDEX]
    let credibilityShare = EMPTY_COUNT
    if (sourceArticles.length > EMPTY_COUNT) {
      credibilityShare = Math.round((highCredibilityCount / sourceArticles.length) * MAX_PERCENT)
    }
    const countries = [...new Set(
      sourceArticles
        .map((article) => article.source_country ?? article.country)
        .filter(hasText),
    )].slice(0, 3)
    return {
      count: source.count,
      countries,
      credibilityShare,
      latestArticle: firstArticle,
      latestPublishedAt: firstArticle?.publishedAt,
      name: source.name,
    }
  }),


 buildTopicSignals = (articles: ArticleList): TopicSignalEntry[] => {
  const counts = new Map<string, number>()
  for (const article of articles) {
    const tokens = [
      ...(article.tags ?? []),
      article.category,
      article.geo_signal?.label,
    ].filter(hasText)
    for (const token of tokens) {
      const normalized = token.trim()
      counts.set(normalized, (counts.get(normalized) ?? EMPTY_COUNT) + 1)
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ count, label }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, TOPIC_SIGNAL_LIMIT)
},

 buildCoverageBreakdown = (articles: ArticleList): CoverageEntry[] => {
  const counts = new Map<string, number>()
  for (const article of articles) {
    let countries: readonly string[] = []
    if (article.mentioned_countries !== undefined && article.mentioned_countries.length > EMPTY_COUNT) {
      countries = article.mentioned_countries
    } else if (hasText(article.source_country)) {
      countries = [article.source_country]
    }
    for (const country of countries) {
      counts.set(country, (counts.get(country) ?? EMPTY_COUNT) + 1)
    }
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ count, country }))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, COVERAGE_LIMIT)
},

 sortExpandedArticles = (
  articles: ArticleList,
  sortMode: ExpandedSortMode,
): ReadonlyArticle[] => {
  if (sortMode === "source") {
    return articles.toSorted((left, right) => {
      const sourceCompare = (left.source ?? "").localeCompare(right.source ?? "")
      if (sourceCompare !== EMPTY_COUNT) {return sourceCompare}
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
    })
  }
  const sorted = articles.toSorted(
    (left, right) => new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime(),
  )
  if (sortMode === "recent") {
    return sorted.toReversed()
  }
  return sorted
},

 latestTimestamp = (articles: ArticleList): number | undefined => {
  const timestamps = articles
    .map((article) => new Date(article.publishedAt).getTime())
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === EMPTY_COUNT) {return undefined}
  return Math.max(...timestamps)
},

 useGlobeSelectionState = () => {
  const [earthLightingMode, setEarthLightingMode] = useState<LightingMode>("all-lit"),
    [expandedSort, setExpandedSort] = useState<ExpandedSortMode>("recent"),
    [isArticleModalOpen, setIsArticleModalOpen] = useState(false),
    [isFocusExpanded, setIsFocusExpanded] = useState(false),
    [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false),
    lensBriefRef = useRef<HTMLDivElement | null>(null),
    [lensLimit, setLensLimit] = useState(DEFAULT_LENS_LIMIT),
    [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null),
    [selectedCountry, setSelectedCountry] = useState<CountrySelection>(null),
    [selectedCountryName, setSelectedCountryName] = useState<string | null>(null),
    [sidebarTab, setSidebarTab] = useState("briefing"),
    sourceBreakdownRef = useRef<HTMLDivElement | null>(null),
    topStoriesRef = useRef<HTMLDivElement | null>(null),
    trendingTopicsRef = useRef<HTMLDivElement | null>(null),
    [viewMode, setViewMode] = useState<LensViewMode>("internal"),
    coverageMapRef = useRef<HTMLDivElement | null>(null)

  return {
    coverageMapRef,
    earthLightingMode,
    expandedSort,
    isArticleModalOpen,
    isFocusExpanded,
    isMobileSheetExpanded,
    lensBriefRef,
    lensLimit,
    selectedArticle,
    selectedCountry,
    selectedCountryName,
    setEarthLightingMode,
    setExpandedSort,
    setIsArticleModalOpen,
    setIsFocusExpanded,
    setIsMobileSheetExpanded,
    setLensLimit,
    setSelectedArticle,
    setSelectedCountry,
    setSelectedCountryName,
    setSidebarTab,
    setViewMode,
    sidebarTab,
    sourceBreakdownRef,
    topStoriesRef,
    trendingTopicsRef,
    viewMode,
  }
}

interface SheetDragState {
  readonly lastY: number
  readonly moved: boolean
  readonly pointerId: number
  readonly startY: number
}

const useSheetDragState = () => {
  const dragRef = useRef<SheetDragState | null>(null),
    suppressClickRef = useRef(false)
  return { dragRef, suppressClickRef }
}

type SheetDragRefs = ReturnType<typeof useSheetDragState>
type SetSheetExpanded = (value: boolean | ((current: boolean) => boolean)) => void

const useSheetDragCallbacks = (
  setIsMobileSheetExpanded: SetSheetExpanded,
  refs: SheetDragRefs,
) => {
  const cancelSheetDrag = useCallback((event: PanelPointerEvent): void => {
      if (refs.dragRef.current?.pointerId !== event.pointerId) {return}
      refs.dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }, [refs]),
    finishSheetDrag = useCallback((event: PanelPointerEvent): void => {
      const drag = refs.dragRef.current
      if (drag === null || drag.pointerId !== event.pointerId) {return}
      refs.dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      const deltaY = drag.lastY - drag.startY
      if (!drag.moved || Math.abs(deltaY) < MIN_DRAG_DISTANCE) {return}
      setIsMobileSheetExpanded(deltaY < EMPTY_COUNT)
      refs.suppressClickRef.current = true
      globalThis.setTimeout(() => {
        refs.suppressClickRef.current = false
      }, EMPTY_COUNT)
    }, [refs, setIsMobileSheetExpanded]),
    handleSheetDragMove = useCallback((event: PanelPointerEvent): void => {
      const drag = refs.dragRef.current
      if (drag === null || drag.pointerId !== event.pointerId) {return}
      refs.dragRef.current = {
        lastY: event.clientY,
        moved: drag.moved || Math.abs(event.clientY - drag.startY) > MIN_DRAG_MOVEMENT,
        pointerId: drag.pointerId,
        startY: drag.startY,
      }
    }, [refs]),
    handleSheetDragStart = useCallback((event: PanelPointerEvent): void => {
      refs.dragRef.current = {
        lastY: event.clientY,
        moved: false,
        pointerId: event.pointerId,
        startY: event.clientY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }, [refs]),
    handleSheetHandleClick = useCallback((): void => {
      if (refs.suppressClickRef.current) {
        refs.suppressClickRef.current = false
        return
      }
      setIsMobileSheetExpanded((current) => !current)
    }, [refs, setIsMobileSheetExpanded])

  return {
    cancelSheetDrag,
    finishSheetDrag,
    handleSheetDragMove,
    handleSheetDragStart,
    handleSheetHandleClick,
  }
},

 useSheetDragActions = (setIsMobileSheetExpanded: SetSheetExpanded) =>
  useSheetDragCallbacks(setIsMobileSheetExpanded, useSheetDragState()),

 useGlobeInteractionActions = (
  state: Readonly<ReturnType<typeof useGlobeSelectionState>>,
  geoData: Readonly<CountryGeoData> | undefined,
) => {
  const {
    setEarthLightingMode,
    setExpandedSort,
    setIsArticleModalOpen,
    setIsFocusExpanded,
    setIsMobileSheetExpanded,
    setLensLimit,
    setSelectedArticle,
    setSelectedCountry,
    setSelectedCountryName,
    setSidebarTab,
    setViewMode,
  } = state,
   sheetActions = useSheetDragActions(setIsMobileSheetExpanded),
    handleArticleSelect = useCallback((article: ReadonlyArticle): void => {
      setSelectedArticle(article)
      setIsArticleModalOpen(true)
    }, [setIsArticleModalOpen, setSelectedArticle]),
    handleCountrySelect = useCallback((country: CountrySelection, name?: string | null): void => {
      let resolvedName = name
      if (country !== null && country !== "") {
        resolvedName = geoData?.countries?.[country]?.name ?? name ?? country
      }
      setSelectedCountry(country)
      setSelectedCountryName(resolvedName ?? null)
      setViewMode("internal")
      setSidebarTab("briefing")
      setIsFocusExpanded(false)
      setIsMobileSheetExpanded(false)
      setLensLimit(DEFAULT_LENS_LIMIT)
    }, [geoData, setIsFocusExpanded, setIsMobileSheetExpanded, setLensLimit, setSelectedCountry, setSelectedCountryName, setSidebarTab, setViewMode]),
    cycleExpandedSort = useCallback((): void => {
      setExpandedSort((current) => {
        if (current === "recent") {return "oldest"}
        if (current === "oldest") {return "source"}
        return "recent"
      })
    }, [setExpandedSort]),
    handleQuickNav = useCallback((
      tab: "briefing" | "intelligence" | "sources",
      ref: RefObject<HTMLDivElement | null>,
    ): void => {
      setSidebarTab(tab)
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, [setSidebarTab]),
    scrollToSection = useCallback((ref: RefObject<HTMLDivElement | null>): void => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, []),
    setAllLit = useCallback((): void => {
      setEarthLightingMode("all-lit")
    }, [setEarthLightingMode]),
    setDayNight = useCallback((): void => {
      setEarthLightingMode("day-night")
    }, [setEarthLightingMode]),
    toggleMobileSheet = useCallback((): void => {
      setIsMobileSheetExpanded((current) => !current)
    }, [setIsMobileSheetExpanded])

  return {
    ...sheetActions,
    cycleExpandedSort,
    handleArticleSelect,
    handleCountrySelect,
    handleQuickNav,
    scrollToSection,
    setAllLit,
    setDayNight,
    toggleMobileSheet,
  }
}

interface GlobeDisplayOptions {
  articles: NewsArticle[]
  geoData: CountryGeoData | undefined
  selectedCountry: CountrySelection
  selectedCountryName: string | null
  lensLimit: number
  viewMode: LensViewMode
  expandedSort: ExpandedSortMode
}

interface GlobeCoreData {
  readonly countryList: ReturnType<typeof buildCountryListFromArticles>
  readonly countryMetrics: CountryArticleCounts
  readonly globalSourceCount: number
  readonly globalSourceSummary: SourceSummaryEntry[]
  readonly localLensData: LocalLensResponse | undefined
}

interface GlobeWorkspaceData {
  readonly lensArticles: NewsArticle[]
  readonly sourceCoverageLeaders: WorkspaceLeader[]
  readonly sourceSummary: SourceSummaryEntry[]
  readonly sourceWorkspace: WorkspaceSource[]
  readonly verificationStats: { readonly highPct: number }
}

interface GlobePresentationData extends GlobeWorkspaceData {
  readonly articleCount: number
  readonly countryMetrics: CountryArticleCounts
  readonly coverageBreakdown: CoverageEntry[]
  readonly expandedArticles: ReadonlyArticle[]
  readonly focusLabel: string
  readonly heatLabel: string
  readonly intensityScore: number
  readonly latestLensTimestamp: number | undefined
  readonly localLensData: LocalLensResponse | undefined
  readonly selectedCountryCoverage: number
  readonly selectedCountryMentionVolume: number
  readonly selectedCountryMeta: CountryListItem | undefined
  readonly selectedCountryOriginVolume: number
  readonly selectedCountrySourceVolume: number
  readonly topSources: SourceSummaryEntry[]
  readonly topicSignals: TopicSignalEntry[]
  readonly sourceCount: number
}

const getLensArticles = (
  articles:readonly NewsArticle[],
  localLensData: LocalLensResponse | undefined,
  selectedCountry: CountrySelection,
): NewsArticle[] => {
  if (selectedCountry === null || selectedCountry === "") {return [...articles]}
  return localLensData?.articles ?? []
},

 buildSourceCoverageLeaders = (sourceWorkspace: readonly WorkspaceSource[]): WorkspaceLeader[] => {
  const [leadSource] = sourceWorkspace
  if (leadSource === undefined) {return []}
  const leadCount = Math.max(leadSource.count, 1)
  return sourceWorkspace.map((source) => ({
    ...source,
    share: Math.max(MIN_SOURCE_SHARE, Math.round((source.count / leadCount) * MAX_PERCENT)),
  }))
},

 buildVerificationStats = (articles: ArticleList): { readonly highPct: number } => {
  const total = articles.length
  if (total === EMPTY_COUNT) {return { highPct: EMPTY_COUNT }}
  const high = articles.filter((article) => article.credibility === "high").length
  return { highPct: Math.round((high / total) * MAX_PERCENT) }
},

 useGlobeCoreData = (options: Readonly<GlobeDisplayOptions>): GlobeCoreData => {
  const {
    articles,
    geoData,
    lensLimit,
    selectedCountry,
    selectedCountryName,
    viewMode,
  } = options,
   countryList = useMemo(() => buildCountryListFromArticles(articles), [articles]),
    countryMetrics = useMemo<CountryArticleCounts>(() => buildCountryMetricsFromArticles(articles), [articles]),
    globalSourceCount = useMemo(() => new Set(
      articles
        .map((article) => article.sourceId ?? article.source)
        .filter(hasText),
    ).size, [articles]),
    globalSourceSummary = useMemo(() => buildSourceSummary(articles).slice(0, TOP_SOURCE_LIMIT), [articles]),
    localLensData = useMemo(() => {
      if (selectedCountry === null || selectedCountry === "") {return}
      const countryName = geoData?.countries?.[selectedCountry]?.name ?? selectedCountryName ?? selectedCountry
      return buildLocalLensFromArticles({
        articles,
        code: selectedCountry,
        countryName,
        limit: lensLimit,
        view: viewMode,
      })
    }, [articles, geoData, lensLimit, selectedCountry, selectedCountryName, viewMode])

  return { countryList, countryMetrics, globalSourceCount, globalSourceSummary, localLensData }
},

 useGlobeWorkspaceData = (
  options: Readonly<Pick<GlobeDisplayOptions, "articles" | "selectedCountry"> & {
    readonly localLensData: LocalLensResponse | undefined
  }>,
): GlobeWorkspaceData => {
  const { articles, localLensData, selectedCountry } = options,
   lensArticles = getLensArticles(articles, localLensData, selectedCountry),
   workspace = useMemo(() => {
    const sourceSummary = buildSourceSummary(lensArticles),
     sourceWorkspace = buildSourceWorkspace(lensArticles, sourceSummary)
    return {
      lensArticles,
      sourceCoverageLeaders: buildSourceCoverageLeaders(sourceWorkspace),
      sourceSummary,
      sourceWorkspace,
      verificationStats: buildVerificationStats(lensArticles),
    }
  }, [lensArticles])
  return workspace
},

 getCountryMetric = (
  metrics: Readonly<CountryArticleCounts>,
  country: CountrySelection,
  values: Record<string, number> | undefined,
): number => {
  if (country === null || country === "" || values === undefined) {return EMPTY_COUNT}
  return values[country] ?? EMPTY_COUNT
},

 calculateIntensityScore = (
  metrics: Readonly<CountryArticleCounts>,
  selectedCountry: CountrySelection,
  selectedCountryCoverage: number,
): number => {
  if (selectedCountry === null || selectedCountry === "") {return EMPTY_COUNT}
  const counts = Object.values(metrics.counts),
    maxCoverage = Math.max(...counts, EMPTY_COUNT)
  if (maxCoverage === EMPTY_COUNT) {return EMPTY_COUNT}
  return Math.max(1, Math.min(MAX_INTENSITY_SCORE, Math.ceil((selectedCountryCoverage / maxCoverage) * MAX_INTENSITY_SCORE)))
},

 useGlobeCountryTotals = (
  options: Readonly<{
    readonly selectedCountry: CountrySelection
    readonly coreData: GlobeCoreData
  }>,
) => {
  const { coreData, selectedCountry } = options,
   { countryList, countryMetrics } = coreData,
   selectedCountryCoverage = getCountryMetric(countryMetrics, selectedCountry, countryMetrics.counts),
    selectedCountryMentionVolume = signalTotal(countryMetrics, "country_mentions", selectedCountry),
    selectedCountryOriginVolume = signalTotal(countryMetrics, "source_origin", selectedCountry),
    selectedCountrySourceVolume = getCountryMetric(countryMetrics, selectedCountry, countryMetrics.source_counts),
   selectedCountryMeta = useMemo(() => {
    if (selectedCountry === null || selectedCountry === "") {return}
    return countryList.countries.find((item) => item.code === selectedCountry)
  }, [countryList, selectedCountry]),
   intensityScore = calculateIntensityScore(countryMetrics, selectedCountry, selectedCountryCoverage)
  return {
    countryMetrics,
    heatLabel: intensityLabel(countryMetrics),
    intensityScore,
    selectedCountryCoverage,
    selectedCountryMentionVolume,
    selectedCountryMeta,
    selectedCountryOriginVolume,
    selectedCountrySourceVolume,
  }
},

 useGlobeCountrySummary = (
  options: Readonly<{
    readonly articles: NewsArticle[]
    readonly selectedCountry: CountrySelection
    readonly selectedCountryName: string | null
    readonly coreData: GlobeCoreData
    readonly workspaceData: GlobeWorkspaceData
  }>,
) => {
  const { articles, coreData, selectedCountry, selectedCountryName, workspaceData } = options,
   { globalSourceCount, globalSourceSummary, localLensData } = coreData,
   { sourceSummary } = workspaceData
  let articleCount = articles.length,
    sourceCount = globalSourceCount,
    topSources = globalSourceSummary
  if (selectedCountry !== null && selectedCountry !== "") {
    articleCount = localLensData?.total ?? EMPTY_COUNT
    sourceCount = localLensData?.source_count ?? sourceSummary.length
    topSources = sourceSummary
  }
  return {
    articleCount,
    focusLabel: selectedCountryName ?? "Global Focus",
    sourceCount,
    topSources: topSources.slice(0, TOP_SOURCE_LIMIT),
  }
},

 useGlobeDisplayData = (options: Readonly<GlobeDisplayOptions>): GlobePresentationData => {
  const coreData = useGlobeCoreData(options),
   workspaceData = useGlobeWorkspaceData({
    articles: options.articles,
    localLensData: coreData.localLensData,
    selectedCountry: options.selectedCountry,
  }),
   countryTotals = useGlobeCountryTotals({
    coreData,
    selectedCountry: options.selectedCountry,
  }),
   countrySummary = useGlobeCountrySummary({
    articles: options.articles,
    coreData,
    selectedCountry: options.selectedCountry,
    selectedCountryName: options.selectedCountryName,
    workspaceData,
  }),
   { lensArticles } = workspaceData,
   articlePresentation = useMemo(() => ({
    coverageBreakdown: buildCoverageBreakdown(lensArticles),
    expandedArticles: sortExpandedArticles(lensArticles, options.expandedSort),
    latestLensTimestamp: latestTimestamp(lensArticles),
    topicSignals: buildTopicSignals(lensArticles),
  }), [lensArticles, options.expandedSort])
  return {
    ...coreData,
    ...workspaceData,
    ...countryTotals,
    ...countrySummary,
    ...articlePresentation,
  }
}

interface FloatingHeaderProps {
  readonly articleCount: number
  readonly focusLabel: string
  readonly globalArticleCount: number
  readonly isFocusExpanded: boolean
  readonly localLensData: LocalLensResponse | undefined
  readonly onResetFocus: () => void
  readonly selectedCountry: CountrySelection
}

const floatingHeaderVisibility = (isFocusExpanded: boolean, selectedCountry: CountrySelection): string => {
  if (isFocusExpanded) {return "opacity-0"}
  if (hasCountrySelection(selectedCountry)) {return "opacity-0 lg:opacity-100"}
  return "opacity-100"
},

 floatingHeaderScale = (selectedCountry: CountrySelection): string => {
  if (hasCountrySelection(selectedCountry)) {return "scale-95 lg:scale-100"}
  return "scale-100"
},

 FloatingHeaderMeta = (props: Readonly<FloatingHeaderProps>) => {
  const { articleCount, globalArticleCount, selectedCountry } = props
  let countLabel = `${globalArticleCount} live articles`
  if (hasCountrySelection(selectedCountry)) {
    countLabel = `${articleCount} lens articles`
  }
  return (
    <div className="flex items-center gap-2 lg:gap-3">
      <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-primary">
        Global Desk
      </span>
      <span className="font-mono text-[9px] lg:text-[10px] uppercase tracking-widest text-muted-foreground">
        {countLabel}
      </span>
    </div>
  )
},

 FloatingHeaderReset = (props: Readonly<Pick<FloatingHeaderProps, "onResetFocus">>) => (
  <button
    type="button"
    onClick={props.onResetFocus}
    className="group mt-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground transition-colors hover:text-primary"
  >
    <X size={ICON_SIZE - 2} className="transition-transform group-hover:rotate-90" />
    Reset Focus
  </button>
),

 FloatingHeaderCard = (props: Readonly<FloatingHeaderProps>) => {
  const { focusLabel, localLensData, selectedCountry } = props
  return (
    <div className={cn(
      "pointer-events-auto max-w-full space-y-2 rounded-2xl border border-white/10 bg-black/40 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-500 lg:max-w-[31rem] lg:space-y-3 lg:p-6",
      floatingHeaderScale(selectedCountry),
    )}>
      <FloatingHeaderMeta {...props} />
      <h2 className="font-serif text-3xl font-semibold tracking-tight text-foreground drop-shadow-md lg:text-5xl">
        {focusLabel}
      </h2>
      <p className="max-w-[20rem] text-xs leading-relaxed text-foreground/75 lg:max-w-md lg:text-sm">
        {briefingDescriptionFor(selectedCountry, localLensData)}
      </p>
      {hasCountrySelection(selectedCountry) && <FloatingHeaderReset onResetFocus={props.onResetFocus} />}
    </div>
  )
},

 FloatingHeader = (props: Readonly<FloatingHeaderProps>) => (
  <div className={cn(
    "pointer-events-none absolute left-3 right-3 top-3 z-10 hidden transition-all duration-500 lg:left-8 lg:right-auto lg:top-8 lg:block",
    floatingHeaderVisibility(props.isFocusExpanded, props.selectedCountry),
  )}>
    <FloatingHeaderCard {...props} />
  </div>
)

interface IntensityPanelProps {
  readonly heatLabel: string
  readonly isFocusExpanded: boolean
  readonly lightingMode: LightingMode
  readonly onLightingChange: (mode: LightingMode) => void
}

const IntensitySegments = () => (
  <div className="flex gap-1">
    <div className="h-1.5 w-3 rounded-sm bg-primary/20" />
    <div className="h-1.5 w-3 rounded-sm bg-primary/40" />
    <div className="h-1.5 w-3 rounded-sm bg-primary/60" />
    <div className="h-1.5 w-3 rounded-sm bg-primary/80" />
    <div className="h-1.5 w-3 rounded-sm bg-primary" />
  </div>
),

 IntensityLegend = (props: Readonly<Pick<IntensityPanelProps, "heatLabel">>) => (
  <div className="flex items-center gap-6">
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/80">{props.heatLabel}</span>
    </div>
    <div className="h-4 w-px bg-white/10" />
    <div className="flex items-center gap-3">
      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Intensity</span>
      <IntensitySegments />
    </div>
  </div>
)

interface LightingButtonsProps {
  readonly lightingMode: LightingMode
  readonly onAllLit: () => void
  readonly onDayNight: () => void
}

const lightingButtonClassName = (active: boolean): string => {
  if (active) {return "bg-white/10 text-foreground"}
  return "text-muted-foreground hover:text-foreground"
},

 LightingButtons = (props: Readonly<LightingButtonsProps>) => (
  <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-1">
    <button
      type="button"
      onClick={props.onAllLit}
      className={cn(
        "rounded-full px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] transition-colors",
        lightingButtonClassName(props.lightingMode === "all-lit"),
      )}
    >
      All Lit
    </button>
    <button
      type="button"
      onClick={props.onDayNight}
      className={cn(
        "rounded-full px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] transition-colors",
        lightingButtonClassName(props.lightingMode === "day-night"),
      )}
    >
      Day/Night
    </button>
  </div>
),

 LightingControls = (props: Readonly<Pick<IntensityPanelProps, "lightingMode" | "onLightingChange">>) => {
  const onAllLit = useCallback(() =>{  props.onLightingChange("all-lit"); }, [props.onLightingChange]),
    onDayNight = useCallback(() =>{  props.onLightingChange("day-night"); }, [props.onLightingChange])
  return (
    <div className="flex items-center gap-2">
      <Lamp className="h-3.5 w-3.5 text-foreground/55" />
      <LightingButtons lightingMode={props.lightingMode} onAllLit={onAllLit} onDayNight={onDayNight} />
    </div>
  )
},

 IntensityPanel = (props: Readonly<IntensityPanelProps>) => (
  <div className={cn(
    "absolute bottom-8 left-8 z-10 hidden transition-opacity duration-500 lg:block",
    props.isFocusExpanded ? "opacity-0" : "opacity-100",
  )}>
    <div className="flex items-center gap-6 rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 shadow-2xl backdrop-blur-xl">
      <IntensityLegend heatLabel={props.heatLabel} />
      <LightingControls lightingMode={props.lightingMode} onLightingChange={props.onLightingChange} />
    </div>
  </div>
)

interface BriefingArticleCardProps {
  readonly article: ReadonlyArticle
  readonly onSelect: (article: ReadonlyArticle) => void
}

const BriefingArticleMeta = (props: Readonly<Pick<BriefingArticleCardProps, "article">>) => (
  <div className="mb-2 flex items-center gap-2">
    <Badge
      variant="outline"
      className="h-4 rounded-full border-white/10 py-0 text-[8px] uppercase tracking-wider text-muted-foreground group-hover:border-white/40 group-hover:text-foreground"
    >
      {sourceLabel(props.article)}
    </Badge>
    <span className="text-[9px] text-muted-foreground">{formatPublishedDate(props.article.publishedAt)}</span>
  </div>
),

 BriefingArticleTags = (props: Readonly<Pick<BriefingArticleCardProps, "article">>) => {
  const { article } = props,
   hasGeoSignal = article.geo_signal !== undefined,
    hasMentionedCountries = article.mentioned_countries !== undefined && article.mentioned_countries.length > EMPTY_COUNT
  if (!hasGeoSignal && !hasMentionedCountries) {return}
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {hasGeoSignal && (
        <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground">
          {article.geo_signal?.label}
        </Badge>
      )}
      {hasMentionedCountries && article.mentioned_countries?.slice(0, ARTICLE_COUNTRY_LIMIT).map((countryCode) => (
        <Badge
          key={`${article.id}-${countryCode}`}
          variant="outline"
          className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground"
        >
          {countryCode}
        </Badge>
      ))}
    </div>
  )
},

 BriefingArticleCopy = (props: Readonly<BriefingArticleCardProps>) => (
  <div className="min-w-0 flex-1">
    <BriefingArticleMeta article={props.article} />
    <h4 className="font-serif text-sm font-medium leading-snug transition-colors group-hover:text-foreground">{props.article.title}</h4>
    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{props.article.summary}</p>
    <BriefingArticleTags article={props.article} />
  </div>
),

 BriefingArticleImage = (props: Readonly<Pick<BriefingArticleCardProps, "article">>) => {
  if (!hasRealImage(props.article.image)) {return}
  return (
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-primary)]/40">
      <SafeImage
        src={props.article.image}
        alt=""
        width={ARTICLE_CARD_IMAGE_SIZE}
        height={ARTICLE_CARD_IMAGE_SIZE}
        className="h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-100"
      />
    </div>
  )
},

 BriefingArticleCard = (props: Readonly<BriefingArticleCardProps>) => {
  const handleSelect = useCallback(() =>{  props.onSelect(props.article); }, [props.article, props.onSelect])
  return (
    <button
      type="button"
      onClick={handleSelect}
      className="group w-full cursor-pointer rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4 text-left transition-all hover:scale-[1.02] hover:border-white/40 hover:bg-[var(--news-bg-primary)]"
    >
      <div className="flex items-start justify-between gap-3">
        <BriefingArticleCopy article={props.article} onSelect={props.onSelect} />
        <BriefingArticleImage article={props.article} />
      </div>
    </button>
  )
},

 getSheetToggleLabel = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "Collapse globe briefing"
  }
  return "Expand globe briefing"
}

interface CollapsedPanelHeaderProps {
  readonly selectedCountry: CountrySelection
  readonly focusLabel: string
  readonly articleCount: number
  readonly sourceCount: number
  readonly selectedCountryCoverage: number
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined
  readonly isMobileSheetExpanded: boolean
  readonly onToggleMobileSheet: () => void
  readonly onResetFocus: () => void
  readonly onExpandFocus: () => void
  readonly onHandleClick: () => void
  readonly onHandlePointerDown: PanelPointerHandler
  readonly onHandlePointerMove: PanelPointerHandler
  readonly onHandlePointerUp: PanelPointerHandler
  readonly onHandlePointerCancel: PanelPointerHandler
  readonly topSources: readonly SourceSummaryEntry[]
  readonly sidebarTab: string
  readonly onSidebarTabChange: (value: string) => void
  readonly lightingMode: LightingMode
  readonly onSetAllLit: () => void
  readonly onSetDayNight: () => void
}

type CollapsedPanelHeaderPartProps = Readonly<{
  readonly header: CollapsedPanelHeaderProps
}>

const CollapsedPanelDragHandle = ({
  header,
}: Readonly<CollapsedPanelHeaderPartProps>) => {
  const {
    isMobileSheetExpanded,
    onHandleClick,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  } = header
  return (
    <button
      type="button"
      onClick={onHandleClick}
      onPointerDown={onHandlePointerDown}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerCancel}
      className="group mx-auto -my-1 flex h-8 w-24 touch-none items-center justify-center lg:hidden"
      aria-label={getSheetToggleLabel(isMobileSheetExpanded)}
    >
      <span className="h-1 w-12 rounded-full bg-white/35 transition-all duration-200 group-hover:w-16 group-hover:bg-white/60 group-active:w-20 group-active:bg-primary/80" />
    </button>
  )
}

type CollapsedPanelCoverageHeatProps = Readonly<{
  readonly selectedCountryCoverage: number
}>

const CollapsedPanelCoverageHeat = (props: CollapsedPanelCoverageHeatProps) => (
  <span
    className="flex cursor-help items-center gap-1"
    title="Combined global attention signal for this country in the active global window."
  >
    <span className="font-medium text-foreground/80">{props.selectedCountryCoverage}</span>
    coverage heat
  </span>
),

 CollapsedPanelCoverageIndicator = ({
  selectedCountryCoverage,
}: CollapsedPanelCoverageHeatProps) => (
  <>
    <span className="text-white/20">•</span>
    <CollapsedPanelCoverageHeat selectedCountryCoverage={selectedCountryCoverage} />
  </>
)

type CollapsedPanelLatestArticleProps = Readonly<{
  latestArticle: string | null | undefined
  visible: boolean
}>

const CollapsedPanelLatestArticle = (props: CollapsedPanelLatestArticleProps) => {
  if (!props.visible || !hasText(props.latestArticle)) {
    return
  }
  return (
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
      Latest: {formatPublishedDate(props.latestArticle)}
    </div>
  )
},

 CollapsedPanelFocusMetrics = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props,
   showCoverageHeat = hasCountrySelection(header.selectedCountry),
    showLatestArticle = showCoverageHeat && header.isMobileSheetExpanded,
    latestArticle = header.selectedCountryMeta?.latest_article
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground/80">{header.articleCount}</span> articles
        <span className="text-white/20">•</span>
        <span className="font-medium text-foreground/80">{header.sourceCount}</span> sources
        {showCoverageHeat && (
          <CollapsedPanelCoverageIndicator
            selectedCountryCoverage={header.selectedCountryCoverage}
          />
        )}
      </div>
      <CollapsedPanelLatestArticle latestArticle={latestArticle} visible={showLatestArticle} />
    </div>
  )
},

 CollapsedPanelFocusSummary = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <div>
    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Focus</p>
    <h3 className="font-serif text-2xl text-foreground mt-1 mb-1 lg:text-3xl xl:text-4xl">{props.header.focusLabel}</h3>
    <CollapsedPanelFocusMetrics header={props.header} />
  </div>
),

 CollapsedPanelActions = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props,
   sheetToggleLabel = getSheetToggleLabel(header.isMobileSheetExpanded)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={header.onToggleMobileSheet}
        className="h-8 w-8 rounded-full border-white/10 bg-transparent p-0 hover:bg-white/5 lg:hidden"
        aria-label={sheetToggleLabel}
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", header.isMobileSheetExpanded && "rotate-180")} />
      </Button>
      {hasCountrySelection(header.selectedCountry) && (
        <CollapsedPanelCountryActions
          onExpandFocus={header.onExpandFocus}
          onResetFocus={header.onResetFocus}
        />
      )}
    </>
  )
}

type CollapsedPanelCountryActionsProps = Readonly<{
  readonly onResetFocus: () => void
  readonly onExpandFocus: () => void
}>

const CollapsedPanelCountryActions = (props: CollapsedPanelCountryActionsProps) => (
  <div className="flex flex-col items-end gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={props.onExpandFocus}
      className="hidden rounded-full border-white/10 bg-transparent px-3 text-[10px] hover:bg-white/5 lg:flex h-8"
    >
      <ChevronDown className="mr-1.5 h-3 w-3 rotate-180" />
      Expand Focus
    </Button>
    <Button
      variant="outline"
      size="sm"
      onClick={props.onResetFocus}
      className="rounded-full border-white/10 bg-transparent hover:bg-white/5 h-8 w-8 p-0"
    >
      <X className="h-3 w-3" />
    </Button>
  </div>
),

 CollapsedPanelHeaderBody = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <div className="flex items-start justify-between">
    <CollapsedPanelFocusSummary header={props.header} />
    <CollapsedPanelActions header={props.header} />
  </div>
),

 CollapsedPanelGuidance = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <>
    {!hasCountrySelection(props.header.selectedCountry) && (
      <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-xs leading-relaxed text-muted-foreground mt-2 lg:p-4 lg:mt-4">
        The map shows recent coverage volume. Click a country to view local and foreign reporting.
      </div>
    )}
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/30 p-4 text-xs leading-relaxed text-muted-foreground",
        hasCountrySelection(props.header.selectedCountry) && "hidden",
        !props.header.isMobileSheetExpanded && "hidden lg:block",
      )}
    >
      Use the globe as the country navigator. Hover to inspect coverage heat, then click a
      country to open its local and world lens.
    </div>
  </>
),

 CollapsedPanelSourceBadges = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  if (props.header.topSources.length === EMPTY_COUNT) {
    return
  }
  return (
    <div className={cn("flex flex-wrap gap-2 mt-2 lg:mt-4", !props.header.isMobileSheetExpanded && "hidden lg:flex")}>
      {props.header.topSources.map((source) => (
        <Badge key={source.name} variant="outline" className="rounded-full border-white/10 bg-white/5 px-3 py-1 text-[9px] uppercase tracking-wide">
          {source.name} · {source.count}
        </Badge>
      ))}
    </div>
  )
},

 CollapsedPanelTabList = () => (
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
),

 CollapsedPanelTabs = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props
  return (
    <Tabs value={header.sidebarTab} onValueChange={header.onSidebarTabChange} className={cn("w-full mt-4", !header.isMobileSheetExpanded && "hidden lg:block")}>
      <CollapsedPanelTabList />
  </Tabs>
  )
},

 collapsedLightingClassName = (lightingMode: LightingMode, mode: LightingMode): string => {
  if (lightingMode === mode) {
      return "bg-primary/15 text-primary"
  }
  return "text-muted-foreground"
},

 CollapsedPanelLightingControls = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props
  return (
    <div className={cn("grid grid-cols-2 gap-2 lg:hidden", !header.isMobileSheetExpanded && "hidden")}>
      <button
        type="button"
        onClick={header.onSetAllLit}
        className={cn(
          "rounded-full border border-white/10 px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em]",
          collapsedLightingClassName(header.lightingMode, "all-lit"),
        )}
      >
        All Lit
      </button>
      <button
        type="button"
        onClick={header.onSetDayNight}
        className={cn(
          "rounded-full border border-white/10 px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em]",
          collapsedLightingClassName(header.lightingMode, "day-night"),
        )}
      >
        Day/Night
      </button>
    </div>
  )
},

 CollapsedPanelHeader = (props: CollapsedPanelHeaderProps) => (
  <div className="space-y-2.5 border-b border-white/10 p-3 shrink-0 lg:space-y-3 lg:p-4">
    <CollapsedPanelDragHandle header={props} />
    <CollapsedPanelHeaderBody header={props} />
    <CollapsedPanelGuidance header={props} />
    <CollapsedPanelSourceBadges header={props} />
    <CollapsedPanelTabs header={props} />
    <CollapsedPanelLightingControls header={props} />
  </div>
)

interface CollapsedBriefingTabProps {
  readonly viewMode: LensViewMode
  readonly onViewModeChange: (value: LensViewMode) => void
  readonly selectedCountry: CountrySelection
  readonly localLensData: LocalLensResponse | undefined
  readonly loading: boolean
  readonly lensArticles: ArticleList
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined
  readonly onArticleSelect: (article: ReadonlyArticle) => void
  readonly onLoadMore: () => void
}

const normalizeLensViewMode = (value: string): LensViewMode => {
  if (value === "external") {return "external"}
  return "internal"
},

 CollapsedBriefingTabList = () => (
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
),

 CollapsedBriefingViewTabs = (props: Readonly<Pick<CollapsedBriefingTabProps, "viewMode" | "onViewModeChange">>) => {
  const handleValueChange = useCallback(
    (value: string) =>{  props.onViewModeChange(normalizeLensViewMode(value)); },
    [props.onViewModeChange],
  )
  return (
    <div className="border-b border-white/10 bg-[var(--news-bg-primary)]/30 px-4 py-3">
      <Tabs value={props.viewMode} onValueChange={handleValueChange} className="w-full">
        <CollapsedBriefingTabList />
      </Tabs>
    </div>
  )
},

 CollapsedBriefingHowToHeader = () => (
  <div className="mb-2 flex items-center gap-2">
    <Globe2 size={ICON_SIZE} className="text-primary" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">How to use it</span>
  </div>
),

 CollapsedBriefingHowTo = () => (
  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
    <CollapsedBriefingHowToHeader />
    <p className="text-sm leading-relaxed text-muted-foreground">
      Pick a country to see two lenses: what its own outlets publish, and how foreign outlets frame the same place.
    </p>
  </div>
),

 CollapsedBriefingLoading = () => (
  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
    <Radio className="mb-3 h-8 w-8 animate-pulse opacity-20" />
    <p className="text-xs uppercase tracking-widest">Loading country lens</p>
  </div>
)

interface CollapsedLensBriefProps {
  readonly selectedCountry: CountrySelection
  readonly localLensData: LocalLensResponse | undefined
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined
}

const CollapsedLensBriefHeader = () => (
  <div className="mb-2 flex items-center gap-2">
    <MapPin size={ICON_SIZE} className="text-primary" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Lens brief</span>
  </div>
),

 CollapsedLensBriefSignal = (props: Readonly<Pick<CollapsedLensBriefProps, "localLensData">>) => {
  if (props.localLensData?.geo_signal === undefined) {return}
  return (
    <Badge
      variant="outline"
      className="mt-3 rounded-full border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground"
    >
      {props.localLensData.geo_signal.label}
    </Badge>
  )
},

 CollapsedLensBriefMetadata = (props: Readonly<CollapsedLensBriefProps>) => {
  const { localLensData, selectedCountryMeta } = props,
   matchingStrategy = localLensData?.matching_strategy,
    latestArticle = selectedCountryMeta?.latest_article
  return (
    <div className="space-y-3">
      {hasText(matchingStrategy) && (
        <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
          Match: {matchingStrategy.replaceAll("_", " ")}
        </p>
      )}
      {hasText(latestArticle) && (
        <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
          Latest indexed: {formatPublishedDate(latestArticle)}
        </p>
      )}
    </div>
  )
},

 CollapsedLensBrief = (props: Readonly<CollapsedLensBriefProps>) => (
  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
    <CollapsedLensBriefHeader />
    <p className="text-sm leading-relaxed text-muted-foreground">
      {briefingDescriptionFor(props.selectedCountry, props.localLensData)}
    </p>
    <CollapsedLensBriefSignal localLensData={props.localLensData} />
    <CollapsedLensBriefMetadata {...props} />
  </div>
),

 CollapsedNoArticles = () => (
  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
    <Radio className="mb-3 h-8 w-8 opacity-20" />
    <p className="text-xs uppercase tracking-widest">No articles found</p>
  </div>
),

 CollapsedBriefingArticles = (props: Readonly<Pick<CollapsedBriefingTabProps, "lensArticles" | "onArticleSelect">>) => {
  if (props.lensArticles.length === EMPTY_COUNT) {return <CollapsedNoArticles />}
  return (
    <>
      {props.lensArticles.map((article, index) => (
        <BriefingArticleCard
          key={articleRenderKey(article, index)}
          article={article}
          onSelect={props.onArticleSelect}
        />
      ))}
    </>
  )
},

 CollapsedBriefingLoaded = (props: Readonly<CollapsedBriefingTabProps>) => (
  <>
    <CollapsedLensBrief
      localLensData={props.localLensData}
      selectedCountry={props.selectedCountry}
      selectedCountryMeta={props.selectedCountryMeta}
    />
    <CollapsedBriefingArticles lensArticles={props.lensArticles} onArticleSelect={props.onArticleSelect} />
    {props.localLensData?.has_more === true && (
      <Button
        variant="outline"
        size="sm"
        onClick={props.onLoadMore}
        className="w-full rounded-xl border-white/10 hover:bg-white/5"
      >
        Show More Articles
      </Button>
    )}
  </>
),

 CollapsedBriefingContent = (props: Readonly<CollapsedBriefingTabProps>) => {
  if (!hasCountrySelection(props.selectedCountry)) {return <CollapsedBriefingHowTo />}
  if (props.loading) {return <CollapsedBriefingLoading />}
  return <CollapsedBriefingLoaded {...props} />
},

 CollapsedBriefingTab = (props: Readonly<CollapsedBriefingTabProps>) => (
  <div className="flex h-full min-h-0 flex-col">
    <CollapsedBriefingViewTabs onViewModeChange={props.onViewModeChange} viewMode={props.viewMode} />
    <div className="flex min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
      <CollapsedBriefingContent {...props} />
    </div>
  </div>
)

interface CollapsedIntelligenceTabProps {
  readonly lensArticles: ArticleList
  readonly selectedCountry: CountrySelection
  readonly focusLabel: string
  readonly articleCount: number
  readonly sourceCount: number
  readonly sourceSummaryLength: number
  readonly highPct: number
  readonly originVolume: number
  readonly sourceVolume: number
  readonly mentionVolume: number
  readonly coverage: number
  readonly onArticleSelect: (article: ReadonlyArticle) => void
}

const CollapsedIntelligenceHeader = (props: Readonly<{ readonly icon: "spotlight" | "verification" }>) => {
  let Icon = ShieldCheck,
   label = "Verification Signal"
  if (props.icon === "spotlight") {
    Icon = Newspaper
    label = "Spotlight Story"
  }
  let iconClass = "text-foreground/70"
  if (props.icon === "spotlight") {iconClass = "text-primary"}
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
      <Icon size={ICON_SIZE} className={iconClass} />
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  )
}

interface CollapsedSpotlightStoryProps {
  readonly article: ReadonlyArticle
  readonly onSelect: (article: ReadonlyArticle) => void
}

const CollapsedSpotlightTitle = (props: Readonly<Pick<CollapsedSpotlightStoryProps, "article">>) => (
  <div className="absolute bottom-2 left-2 right-2">
    <h4 className="font-serif text-sm font-medium leading-tight text-foreground drop-shadow-md">{props.article.title}</h4>
  </div>
),

 CollapsedSpotlightImage = (props: Readonly<Pick<CollapsedSpotlightStoryProps, "article">>) => {
  if (!hasRealImage(props.article.image)) {return}
  return (
    <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg border border-white/10">
      <SafeImage
        src={props.article.image}
        className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"
        alt="Lead"
        fill
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <CollapsedSpotlightTitle article={props.article} />
    </div>
  )
},

 CollapsedSpotlightStory = (props: CollapsedSpotlightStoryProps) => {
  const handleSelect = useCallback(() =>{  props.onSelect(props.article); }, [props.article, props.onSelect])
  return (
    <button type="button" className="group w-full cursor-pointer p-4 text-left" onClick={handleSelect}>
      <CollapsedSpotlightImage article={props.article} />
      <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{props.article.summary}</p>
    </button>
  )
},

 CollapsedSpotlight = (props: Readonly<Pick<CollapsedIntelligenceTabProps, "lensArticles" | "onArticleSelect">>) => {
  const leadArticle = props.lensArticles[FIRST_INDEX]
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40">
      <CollapsedIntelligenceHeader icon="spotlight" />
      {leadArticle !== undefined && <CollapsedSpotlightStory article={leadArticle} onSelect={props.onArticleSelect} />}
      {leadArticle === undefined && <div className="p-8 text-center text-xs text-muted-foreground">No lead story available</div>}
    </div>
  )
},

 CollapsedVerificationValue = (props: Readonly<Pick<CollapsedIntelligenceTabProps, "highPct">>) => (
  <div className="flex items-end justify-between">
    <div className="text-3xl font-bold text-foreground">{props.highPct}%</div>
    <div className="mb-1 text-right text-[10px] text-muted-foreground">High Credibility<br />Sources</div>
  </div>
),

 CollapsedVerificationBar = (props: Readonly<Pick<CollapsedIntelligenceTabProps, "highPct">>) => {
  const barStyle = { width: `${props.highPct}%` }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-white/40" style={barStyle} />
    </div>
  )
},

 CollapsedVerification = (props: Readonly<Pick<CollapsedIntelligenceTabProps, "highPct" | "lensArticles" | "sourceSummaryLength">>) => (
  <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40">
    <CollapsedIntelligenceHeader icon="verification" />
    <div className="space-y-4 p-4">
      <CollapsedVerificationValue highPct={props.highPct} />
      <CollapsedVerificationBar highPct={props.highPct} />
      <div className="text-xs leading-relaxed text-muted-foreground">
        Based on {props.lensArticles.length} articles from {props.sourceSummaryLength} active sources in this lens.
      </div>
    </div>
  </div>
)

interface CollapsedIntelligenceStatProps {
  readonly label: string
  readonly value: number
}

const CollapsedIntelligenceStat = (props: CollapsedIntelligenceStatProps) => (
  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
    <div className="text-xl font-bold">{props.value}</div>
    <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
  </div>
),

 CollapsedIntelligenceStats = (props: Readonly<Pick<CollapsedIntelligenceTabProps, "articleCount" | "sourceCount">>) => (
  <div className="grid grid-cols-2 gap-3">
    <CollapsedIntelligenceStat label="Total Briefs" value={props.articleCount} />
    <CollapsedIntelligenceStat label="Active Feeds" value={props.sourceCount} />
  </div>
),

 positiveValueOrFallback = (value: number, fallback: number): number => {
  if (value > EMPTY_COUNT) {return value}
  return fallback
},

 CollapsedReadingAngleHeader = () => (
  <div className="flex items-center gap-2">
    <AlertCircle size={ICON_SIZE} className="text-primary" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Reading angle</span>
  </div>
)

interface CollapsedReadingAngleCardProps {
  readonly label: string
  readonly value: number
  readonly suffix: string
}

const CollapsedReadingAngleCard = (props: CollapsedReadingAngleCardProps) => (
  <div className="rounded-xl border border-white/10 bg-black/40 p-3 backdrop-blur-md">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
    <div className="mt-2 text-sm text-foreground">{props.value} {props.suffix}</div>
  </div>
),

 CollapsedReadingAngle = (props: Readonly<CollapsedIntelligenceTabProps>) => {
  const localVolume = positiveValueOrFallback(props.originVolume, props.sourceVolume),
    worldVolume = positiveValueOrFallback(props.mentionVolume, props.coverage)
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">
      <CollapsedReadingAngleHeader />
      <p className="text-sm leading-relaxed text-muted-foreground">
        Local Lens shows coverage from inside {props.focusLabel}. World Lens keeps the country fixed but swaps the narrators to outside sources.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <CollapsedReadingAngleCard label="Local lens" suffix="source-origin signals" value={localVolume} />
        <CollapsedReadingAngleCard label="World lens" suffix="article mentions in window" value={worldVolume} />
      </div>
    </div>
  )
},

 CollapsedIntelligenceTab = (props: Readonly<CollapsedIntelligenceTabProps>) => (
  <div className="flex-1 space-y-6 p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
    <CollapsedSpotlight lensArticles={props.lensArticles} onArticleSelect={props.onArticleSelect} />
    <CollapsedVerification highPct={props.highPct} lensArticles={props.lensArticles} sourceSummaryLength={props.sourceSummaryLength} />
    <CollapsedIntelligenceStats articleCount={props.articleCount} sourceCount={props.sourceCount} />
    {hasCountrySelection(props.selectedCountry) && <CollapsedReadingAngle {...props} />}
  </div>
),

 COLLAPSED_SOURCE_LIMIT = 10,
  GLOBAL_COLLAPSED_SOURCE_LIMIT = 8

interface CollapsedSourcesTabProps {
  readonly selectedCountry: CountrySelection
  readonly focusLabel: string
  readonly sourceCount: number
  readonly sourceWorkspace: readonly WorkspaceSource[]
  readonly sourceSummaryLength: number
  readonly onArticleSelect: (article: ReadonlyArticle) => void
}

const collapsedSourceLimit = (selectedCountry: CountrySelection): number => {
  if (hasCountrySelection(selectedCountry)) {return COLLAPSED_SOURCE_LIMIT}
  return GLOBAL_COLLAPSED_SOURCE_LIMIT
},

 collapsedSourceModeLabel = (selectedCountry: CountrySelection): string => {
  if (hasCountrySelection(selectedCountry)) {return "Lens source"}
  return "Live source"
},

 collapsedSourceWorkspaceTitle = (selectedCountry: CountrySelection, focusLabel: string): string => {
  if (hasCountrySelection(selectedCountry)) {return `Active outlets in ${focusLabel}`}
  return "Top live outlets in the current globe feed"
},

 CollapsedSourcesHeader = (props: Readonly<Pick<CollapsedSourcesTabProps, "focusLabel" | "selectedCountry" | "sourceCount">>) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Source Workspace</div>
      <div className="mt-1 text-sm text-foreground">{collapsedSourceWorkspaceTitle(props.selectedCountry, props.focusLabel)}</div>
    </div>
    <Badge
      variant="outline"
      className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-primary"
    >
      {props.sourceCount} sources
    </Badge>
  </div>
),

 CollapsedSourcesGuidance = () => (
  <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-muted-foreground">
    Pick a country to turn this into a local source workspace. Until then, this tab shows the strongest live sources across the global feed.
  </div>
),

 CollapsedSourceIdentityText = (props: Readonly<Pick<WorkspaceSource, "name"> & { readonly selectedCountry: CountrySelection }>) => (
  <div className="min-w-0">
    <div className="truncate text-sm font-medium text-foreground">{props.name}</div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{collapsedSourceModeLabel(props.selectedCountry)}</div>
  </div>
),

 CollapsedSourceIdentity = (props: Readonly<Pick<WorkspaceSource, "name"> & { readonly selectedCountry: CountrySelection }>) => (
  <div className="flex min-w-0 items-center gap-3">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-foreground">
      <Signal size={ICON_SIZE} />
    </div>
    <CollapsedSourceIdentityText name={props.name} selectedCountry={props.selectedCountry} />
  </div>
),

 CollapsedSourceRow = (props: Readonly<Pick<CollapsedSourcesTabProps, "onArticleSelect" | "selectedCountry"> & { readonly source: WorkspaceSource }>) => {
  const handleClick = useCallback((): void => {
    if (props.source.latestArticle !== undefined) {
      props.onArticleSelect(props.source.latestArticle)
    }
  }, [props.onArticleSelect, props.source])
  return (
    <button
      key={props.source.name}
      type="button"
      onClick={handleClick}
      className="w-full rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-left transition-colors hover:border-white/40"
    >
      <div className="flex items-center justify-between gap-3">
        <CollapsedSourceIdentity name={props.source.name} selectedCountry={props.selectedCountry} />
        <Badge variant="outline" className="shrink-0 rounded-full border-white/10 bg-white/5 text-muted-foreground">
          {props.source.count}
        </Badge>
      </div>
    </button>
  )
},

 CollapsedSourcesEmpty = () => (
  <div className="py-12 text-center text-xs uppercase tracking-widest text-muted-foreground">No sources available</div>
),

 CollapsedSourceList = (props: Readonly<Pick<CollapsedSourcesTabProps, "onArticleSelect" | "selectedCountry" | "sourceWorkspace">>) => (
  <div className="space-y-2">
    {props.sourceWorkspace.slice(0, collapsedSourceLimit(props.selectedCountry)).map((source) => (
      <CollapsedSourceRow
        key={source.name}
        onArticleSelect={props.onArticleSelect}
        selectedCountry={props.selectedCountry}
        source={source}
      />
    ))}
    {props.sourceWorkspace.length === EMPTY_COUNT && <CollapsedSourcesEmpty />}
  </div>
),

 CollapsedSourcesFooter = (props: Readonly<Pick<CollapsedSourcesTabProps, "selectedCountry" | "sourceSummaryLength">>) => {
  const limit = collapsedSourceLimit(props.selectedCountry)
  if (props.sourceSummaryLength <= limit) {return}
  return (
    <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Showing top {limit} of {props.sourceSummaryLength} sources
    </div>
  )
},

 CollapsedSourcesCard = (props: Readonly<CollapsedSourcesTabProps>) => (
  <div className="rounded-2xl border border-white/10 bg-[var(--news-bg-primary)]/30 p-4">
    <CollapsedSourcesHeader focusLabel={props.focusLabel} selectedCountry={props.selectedCountry} sourceCount={props.sourceCount} />
    {!hasCountrySelection(props.selectedCountry) && <CollapsedSourcesGuidance />}
    <CollapsedSourceList
      onArticleSelect={props.onArticleSelect}
      selectedCountry={props.selectedCountry}
      sourceWorkspace={props.sourceWorkspace}
    />
    <CollapsedSourcesFooter selectedCountry={props.selectedCountry} sourceSummaryLength={props.sourceSummaryLength} />
  </div>
),

 CollapsedSourcesTab = (props: Readonly<CollapsedSourcesTabProps>) => (
  <div className="flex min-h-0 flex-1 overflow-y-auto p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
    <CollapsedSourcesCard
      focusLabel={props.focusLabel}
      onArticleSelect={props.onArticleSelect}
      selectedCountry={props.selectedCountry}
      sourceCount={props.sourceCount}
      sourceSummaryLength={props.sourceSummaryLength}
      sourceWorkspace={props.sourceWorkspace}
    />
  </div>
)

interface CollapsedPanelProps extends CollapsedPanelHeaderProps {
  readonly isFocusExpanded: boolean
  readonly viewMode: LensViewMode
  readonly onViewModeChange: (value: LensViewMode) => void
  readonly localLensData: LocalLensResponse | undefined
  readonly loading: boolean
  readonly lensArticles: ArticleList
  readonly onArticleSelect: (article: ReadonlyArticle) => void
  readonly onLoadMore: () => void
  readonly sourceWorkspace: readonly WorkspaceSource[]
  readonly sourceSummaryLength: number
  readonly highPct: number
  readonly originVolume: number
  readonly sourceVolume: number
  readonly mentionVolume: number
  readonly coverage: number
}

const collapsedPanelClassName = (props: Readonly<Pick<CollapsedPanelProps, "isFocusExpanded" | "isMobileSheetExpanded" | "selectedCountry">>): string => {
  let panelSize = "bottom-0 left-0 right-0 translate-y-0 overflow-y-auto rounded-t-3xl lg:bottom-4 lg:right-4 lg:top-auto lg:left-auto lg:h-auto lg:w-[420px] lg:translate-y-0 lg:rounded-2xl lg:overflow-hidden"
  if (hasCountrySelection(props.selectedCountry)) {
    panelSize = "bottom-0 left-0 right-0 translate-y-0 overflow-y-auto rounded-t-3xl lg:bottom-4 lg:right-4 lg:top-4 lg:left-auto lg:h-auto lg:w-[420px] lg:rounded-2xl lg:overflow-hidden"
  }
  const heightClass = props.isMobileSheetExpanded
    ? "h-[58vh]"
    : (hasCountrySelection(props.selectedCountry) ? "max-h-[26vh]" : "max-h-[28vh]")
  return cn(
    "absolute z-40 flex flex-col border border-white/10 bg-black/55 shadow-2xl backdrop-blur-2xl transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height,max-height]",
    panelSize,
    heightClass,
    props.isFocusExpanded ? "hidden opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto",
  )
},

 CollapsedPanelTabContent = (props: Readonly<CollapsedPanelProps>) => {
  if (props.sidebarTab === "briefing") {
    return (
      <CollapsedBriefingTab
        lensArticles={props.lensArticles}
        localLensData={props.localLensData}
        loading={props.loading}
        onArticleSelect={props.onArticleSelect}
        onLoadMore={props.onLoadMore}
        onViewModeChange={props.onViewModeChange}
        selectedCountry={props.selectedCountry}
        selectedCountryMeta={props.selectedCountryMeta}
        viewMode={props.viewMode}
      />
    )
  }
  if (props.sidebarTab === "intelligence") {
    return (
      <CollapsedIntelligenceTab
        articleCount={props.articleCount}
        coverage={props.coverage}
        focusLabel={props.focusLabel}
        highPct={props.highPct}
        lensArticles={props.lensArticles}
        mentionVolume={props.mentionVolume}
        onArticleSelect={props.onArticleSelect}
        originVolume={props.originVolume}
        selectedCountry={props.selectedCountry}
        sourceCount={props.sourceCount}
        sourceSummaryLength={props.sourceSummaryLength}
        sourceVolume={props.sourceVolume}
      />
    )
  }
  return (
    <CollapsedSourcesTab
      focusLabel={props.focusLabel}
      onArticleSelect={props.onArticleSelect}
      selectedCountry={props.selectedCountry}
      sourceCount={props.sourceCount}
      sourceSummaryLength={props.sourceSummaryLength}
      sourceWorkspace={props.sourceWorkspace}
    />
  )
},

 CollapsedPanelContent = (props: Readonly<CollapsedPanelProps>) => (
  <div className={cn("relative flex min-h-0 flex-1 flex-col lg:overflow-hidden", !props.isMobileSheetExpanded && "hidden lg:flex")}>
    <CollapsedPanelTabContent {...props} />
  </div>
),

 CollapsedPanel = (props: Readonly<CollapsedPanelProps>) => (
  <div className={collapsedPanelClassName(props)}>
    <CollapsedPanelHeader {...props} />
    <CollapsedPanelContent {...props} />
  </div>
)

interface ExpandedLeftSidebarProps {
  readonly focusLabel: string
  readonly articleCount: number
  readonly sourceCount: number
  readonly selectedCountryCoverage: number
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined
  readonly topSources: readonly SourceSummaryEntry[]
  readonly viewMode: LensViewMode
  readonly onViewModeChange: (value: LensViewMode) => void
  readonly sidebarTab: string
  readonly onNavigate: (tab: "briefing" | "intelligence" | "sources", ref: RefObject<HTMLDivElement | null>) => void
  readonly lensBriefRef: RefObject<HTMLDivElement | null>
  readonly topStoriesRef: RefObject<HTMLDivElement | null>
  readonly trendingTopicsRef: RefObject<HTMLDivElement | null>
  readonly sourceBreakdownRef: RefObject<HTMLDivElement | null>
  readonly coverageMapRef: RefObject<HTMLDivElement | null>
}

const ExpandedFocusSources = (props: Readonly<Pick<ExpandedLeftSidebarProps, "sourceCount" | "topSources">>) => (
  <div className="mt-4 flex flex-wrap gap-1.5">
    {props.topSources.map((source) => (
      <Badge variant="outline" key={source.name} className="rounded-full border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-primary">
        {source.name} · {source.count}
      </Badge>
    ))}
    {props.sourceCount > TOP_SOURCE_LIMIT && (
      <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
        + {props.sourceCount - TOP_SOURCE_LIMIT} More
      </Badge>
    )}
  </div>
),

 ExpandedFocusSection = (props: Readonly<Pick<ExpandedLeftSidebarProps, "articleCount" | "focusLabel" | "selectedCountryCoverage" | "selectedCountryMeta" | "sourceCount" | "topSources">>) => (
  <div className="border-b border-white/10 p-6">
    <h3 className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Focus</h3>
    <h2 className="mb-2 font-serif text-3xl text-foreground">{props.focusLabel}</h2>
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>{props.articleCount} articles</span>
      <span>·</span>
      <span>{props.sourceCount} sources</span>
      <span>·</span>
      <span>{props.selectedCountryCoverage} coverage heat</span>
    </div>
    {hasText(props.selectedCountryMeta?.latest_article) && (
      <div className="mt-3 text-[9px] uppercase tracking-widest text-muted-foreground/60">
        Latest: {formatPublishedDate(props.selectedCountryMeta.latest_article)}
      </div>
    )}
    <ExpandedFocusSources sourceCount={props.sourceCount} topSources={props.topSources} />
  </div>
),

 expandedViewClassName = (active: boolean): string => {
  if (active) {return "bg-primary/10 text-primary"}
  return "text-muted-foreground hover:bg-white/5 hover:text-foreground"
},

 ExpandedViewButtons = (props: Readonly<Pick<ExpandedLeftSidebarProps, "onViewModeChange" | "viewMode">>) => {
  const onInternal = useCallback(() =>{  props.onViewModeChange("internal"); }, [props.onViewModeChange]),
    onExternal = useCallback(() =>{  props.onViewModeChange("external"); }, [props.onViewModeChange])
  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <button
        type="button"
        onClick={onInternal}
        className={cn("flex w-full items-center gap-2.5 whitespace-nowrap border-b border-white/10 px-3 py-3 text-left text-[9px] uppercase tracking-[0.14em] transition-colors", expandedViewClassName(props.viewMode === "internal"))}
      >
        <Radio size={ICON_SIZE} className={props.viewMode === "internal" ? "text-primary" : undefined} /> Local Lens
      </button>
      <button
        type="button"
        onClick={onExternal}
        className={cn("flex w-full items-center gap-2.5 whitespace-nowrap px-3 py-3 text-left text-[9px] uppercase tracking-[0.14em] transition-colors", expandedViewClassName(props.viewMode === "external"))}
      >
        <Globe2 size={ICON_SIZE} className={props.viewMode === "external" ? "text-primary" : undefined} /> World Lens
      </button>
    </div>
  )
},

 ExpandedViewsSection = (props: Readonly<Pick<ExpandedLeftSidebarProps, "onViewModeChange" | "viewMode">>) => (
  <div className="border-b border-white/10 p-6">
    <h3 className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Views</h3>
    <ExpandedViewButtons onViewModeChange={props.onViewModeChange} viewMode={props.viewMode} />
  </div>
)

interface ExpandedQuickNavButtonProps {
  readonly active: boolean
  readonly label: string
  readonly onNavigate: ExpandedLeftSidebarProps["onNavigate"]
  readonly refTarget: RefObject<HTMLDivElement | null>
  readonly tab: "briefing" | "intelligence" | "sources"
  readonly withMarker?: boolean
}

const ExpandedQuickNavButton = (props: ExpandedQuickNavButtonProps) => {
  const handleClick = useCallback(() =>{  props.onNavigate(props.tab, props.refTarget); }, [props.onNavigate, props.refTarget, props.tab])
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn("w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors", expandedViewClassName(props.active))}
    >
      {props.withMarker === true && <span className="mr-3 inline-block h-1.5 w-1.5 rounded-full bg-primary" />}
      {props.label}
    </button>
  )
},

 ExpandedQuickNavSection = (props: Readonly<Pick<ExpandedLeftSidebarProps, "coverageMapRef" | "lensBriefRef" | "onNavigate" | "sidebarTab" | "sourceBreakdownRef" | "topStoriesRef" | "trendingTopicsRef">>) => (
  <div className="border-b border-white/10 p-6">
    <h3 className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Quick Nav</h3>
    <div className="flex flex-col gap-1">
      <ExpandedQuickNavButton active={props.sidebarTab === "briefing"} label="Lens Brief" onNavigate={props.onNavigate} refTarget={props.lensBriefRef} tab="briefing" withMarker />
      <ExpandedQuickNavButton active={props.sidebarTab === "briefing"} label="Top Stories" onNavigate={props.onNavigate} refTarget={props.topStoriesRef} tab="briefing" />
      <ExpandedQuickNavButton active={props.sidebarTab === "intelligence"} label="Trending Topics" onNavigate={props.onNavigate} refTarget={props.trendingTopicsRef} tab="intelligence" />
      <ExpandedQuickNavButton active={props.sidebarTab === "sources"} label="Source Breakdown" onNavigate={props.onNavigate} refTarget={props.sourceBreakdownRef} tab="sources" />
      <ExpandedQuickNavButton active={props.sidebarTab === "sources"} label="Coverage Map" onNavigate={props.onNavigate} refTarget={props.coverageMapRef} tab="sources" />
    </div>
  </div>
),

 ExpandedAboutHeader = () => (
  <h3 className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
    <Globe2 size={ICON_SIZE - 2} /> About Globe View
  </h3>
),

 ExpandedAboutSection = (props: Readonly<Pick<ExpandedLeftSidebarProps, "coverageMapRef" | "onNavigate">>) => {
  const handleLearnMore = useCallback(() =>{  props.onNavigate("sources", props.coverageMapRef); }, [props.coverageMapRef, props.onNavigate])
  return (
    <div className="mt-auto p-6">
      <ExpandedAboutHeader />
      <p className="text-xs leading-relaxed text-muted-foreground">Compare how local outlets report on their own country versus how the world covers it.</p>
      <button type="button" onClick={handleLearnMore} className="mt-3 inline-flex items-center border-b border-primary/60 pb-0.5 text-xs text-primary hover:opacity-80">Learn more →</button>
    </div>
  )
},

 ExpandedLeftSidebar = (props: Readonly<ExpandedLeftSidebarProps>) => (
  <div className="flex w-[280px] flex-col overflow-y-auto border-r border-white/10 bg-black/35 backdrop-blur-xl custom-scrollbar">
    <ExpandedFocusSection
      articleCount={props.articleCount}
      focusLabel={props.focusLabel}
      selectedCountryCoverage={props.selectedCountryCoverage}
      selectedCountryMeta={props.selectedCountryMeta}
      sourceCount={props.sourceCount}
      topSources={props.topSources}
    />
    <ExpandedViewsSection onViewModeChange={props.onViewModeChange} viewMode={props.viewMode} />
    <ExpandedQuickNavSection
      coverageMapRef={props.coverageMapRef}
      lensBriefRef={props.lensBriefRef}
      onNavigate={props.onNavigate}
      sidebarTab={props.sidebarTab}
      sourceBreakdownRef={props.sourceBreakdownRef}
      topStoriesRef={props.topStoriesRef}
      trendingTopicsRef={props.trendingTopicsRef}
    />
    <ExpandedAboutSection coverageMapRef={props.coverageMapRef} onNavigate={props.onNavigate} />
  </div>
)

interface ExpandedTopNavProps {
  readonly sidebarTab: string
  readonly onNavigate: ExpandedLeftSidebarProps["onNavigate"]
  readonly onClose: () => void
  readonly lensBriefRef: RefObject<HTMLDivElement | null>
  readonly trendingTopicsRef: RefObject<HTMLDivElement | null>
  readonly sourceBreakdownRef: RefObject<HTMLDivElement | null>
}

const expandedTopNavClassName = (active: boolean): string => {
  if (active) {return "border-primary text-primary"}
  return "border-transparent text-muted-foreground hover:text-foreground"
}

interface ExpandedTopNavLinkProps {
  readonly active: boolean
  readonly label: string
  readonly onNavigate: ExpandedTopNavProps["onNavigate"]
  readonly refTarget: RefObject<HTMLDivElement | null>
  readonly tab: "briefing" | "intelligence" | "sources"
}

const ExpandedTopNavLink = (props: ExpandedTopNavLinkProps) => {
  const handleClick = useCallback(() =>{  props.onNavigate(props.tab, props.refTarget); }, [props.onNavigate, props.refTarget, props.tab])
  return (
    <button type="button" onClick={handleClick} className={cn("h-full border-b-2 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors", expandedTopNavClassName(props.active))}>
      {props.label}
    </button>
  )
},

 ExpandedTopNavLinks = (props: Readonly<ExpandedTopNavProps>) => (
  <div className="flex h-14 gap-8">
    <ExpandedTopNavLink active={props.sidebarTab === "briefing"} label="Briefing" onNavigate={props.onNavigate} refTarget={props.lensBriefRef} tab="briefing" />
    <ExpandedTopNavLink active={props.sidebarTab === "intelligence"} label="Intel" onNavigate={props.onNavigate} refTarget={props.trendingTopicsRef} tab="intelligence" />
    <ExpandedTopNavLink active={props.sidebarTab === "sources"} label="Sources" onNavigate={props.onNavigate} refTarget={props.sourceBreakdownRef} tab="sources" />
  </div>
),

 ExpandedTopNavActions = (props: Readonly<Pick<ExpandedTopNavProps, "onClose">>) => (
  <div className="flex items-center gap-3">
    <Button type="button" variant="outline" size="sm" onClick={props.onClose} className="h-9 rounded-full border-white/10 bg-black/20 px-4 text-xs text-foreground hover:bg-white/5">
      <Globe2 className="mr-2 h-3.5 w-3.5" /> Show Global
    </Button>
    <Button type="button" variant="outline" size="icon" onClick={props.onClose} className="h-9 w-9 rounded-full border-white/10 bg-black/20 text-foreground hover:bg-white/5">
      <PanelRight size={ICON_SIZE} />
    </Button>
  </div>
),

 ExpandedTopNav = (props: Readonly<ExpandedTopNavProps>) => (
  <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-8 py-0 backdrop-blur-xl">
    <ExpandedTopNavLinks {...props} />
    <ExpandedTopNavActions onClose={props.onClose} />
  </div>
)

interface ExpandedSourceDossierProps {
  readonly source: WorkspaceSource
  readonly onSelect: (article: ReadonlyArticle) => void
}

const ExpandedSourceDossierHeader = (props: Readonly<Pick<ExpandedSourceDossierProps, "source">>) => (
  <div className="mb-2 flex flex-wrap items-center gap-3">
    <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-primary">{props.source.name}</Badge>
    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{props.source.count} articles</span>
    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{props.source.credibilityShare}% high credibility</span>
  </div>
),

 ExpandedSourceDossierLatest = (props: Readonly<Pick<ExpandedSourceDossierProps, "source">>) => {
  const { source } = props
  if (source.latestArticle === undefined) {
    return <div className="text-sm text-muted-foreground">No recent article available.</div>
  }
  const latestDate = source.latestPublishedAt ?? source.latestArticle.publishedAt
  return (
    <div>
      <div className="line-clamp-1 font-serif text-lg text-foreground">{source.latestArticle.title}</div>
      <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{source.latestArticle.summary}</div>
      <div className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Latest dispatch {formatPublishedDate(latestDate)}</div>
    </div>
  )
},

 ExpandedSourceDossierCountryBadges = (props: Readonly<Pick<WorkspaceSource, "countries" | "name">>) => {
  if (props.countries.length === EMPTY_COUNT) {
    return <span className="text-xs text-muted-foreground">No country tags</span>
  }
  return (
    <>
      {props.countries.map((country) => (
        <Badge key={`${props.name}-${country}`} variant="outline" className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground">{country}</Badge>
      ))}
    </>
  )
},

 ExpandedSourceDossierCoverage = (props: Readonly<Pick<ExpandedSourceDossierProps, "source">>) => (
  <div className="w-[180px] shrink-0">
    <div className="mb-2 text-right text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Coverage Footprint</div>
    <div className="flex flex-wrap justify-end gap-2">
      <ExpandedSourceDossierCountryBadges countries={props.source.countries} name={props.source.name} />
    </div>
  </div>
),

 ExpandedSourceDossier = (props: ExpandedSourceDossierProps) => {
  const handleClick = useCallback((): void => {
    if (props.source.latestArticle !== undefined) {
      props.onSelect(props.source.latestArticle)
    }
  }, [props.onSelect, props.source])
  return (
    <button type="button" onClick={handleClick} className="w-full rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ExpandedSourceDossierHeader source={props.source} />
          <ExpandedSourceDossierLatest source={props.source} />
        </div>
        <ExpandedSourceDossierCoverage source={props.source} />
      </div>
    </button>
  )
},

 MIN_ARTICLE_DENOMINATOR = 1

interface ExpandedSourcesTabProps {
  readonly articleCount: number
  readonly sourceCount: number
  readonly focusLabel: string
  readonly sourceWorkspace: readonly WorkspaceSource[]
  readonly sourceCoverageLeaders: readonly WorkspaceLeader[]
  readonly coverageBreakdown: readonly CoverageEntry[]
  readonly originVolume: number
  readonly sourceVolume: number
  readonly selectedCountryCoverage: number
  readonly onArticleSelect: (article: ReadonlyArticle) => void
  readonly sourceBreakdownRef: RefObject<HTMLDivElement | null>
  readonly coverageMapRef: RefObject<HTMLDivElement | null>
}

const expandedTopSourceShare = (sources: readonly WorkspaceSource[], articleCount: number): string => {
  const [topSource] = sources
  if (topSource === undefined) {return "0%"}
  const share = Math.round((topSource.count / Math.max(articleCount, MIN_ARTICLE_DENOMINATOR)) * MAX_PERCENT)
  return `${share}%`
}

interface ExpandedSourceStatProps {
  readonly label: string
  readonly value: string | number
}

const ExpandedSourceStat = (props: ExpandedSourceStatProps) => (
  <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
    <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</div>
    <div className="mt-2 font-serif text-2xl text-foreground">{props.value}</div>
  </div>
),

 ExpandedSourceStats = (props: Readonly<Pick<ExpandedSourcesTabProps, "articleCount" | "sourceCount" | "sourceWorkspace">>) => (
  <div className="grid grid-cols-3 gap-3">
    <ExpandedSourceStat label="Active Sources" value={props.sourceCount} />
    <ExpandedSourceStat label="Routed Articles" value={props.articleCount} />
    <ExpandedSourceStat label="Top Source Share" value={expandedTopSourceShare(props.sourceWorkspace, props.articleCount)} />
  </div>
),

 ExpandedSourceWorkspaceIntro = (props: Readonly<Pick<ExpandedSourcesTabProps, "focusLabel">>) => (
  <div>
    <div className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Source Workspace</div>
    <h2 className="font-serif text-3xl text-foreground">Source network behind {props.focusLabel}</h2>
    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
      This tab tracks which outlets are driving the current lens, where those outlets are based, and which source clusters are actually carrying the story.
    </p>
  </div>
),

 ExpandedSourceWorkspaceHeader = (props: Readonly<ExpandedSourcesTabProps>) => (
  <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
    <ExpandedSourceWorkspaceIntro focusLabel={props.focusLabel} />
    <ExpandedSourceStats articleCount={props.articleCount} sourceCount={props.sourceCount} sourceWorkspace={props.sourceWorkspace} />
  </div>
),

 ExpandedSourceDossierHeaderBar = () => (
  <div className="mb-5 flex items-center justify-between">
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Source Dossiers</div>
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Live Data</div>
  </div>
),

 ExpandedSourceDossierList = (props: Readonly<Pick<ExpandedSourcesTabProps, "onArticleSelect" | "sourceWorkspace">>) => {
  if (props.sourceWorkspace.length === EMPTY_COUNT) {
    return <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-10 text-center text-sm text-muted-foreground">No sources available for this lens.</div>
  }
  return (
    <div className="space-y-3">
      {props.sourceWorkspace.map((source) => (
        <ExpandedSourceDossier key={source.name} onSelect={props.onArticleSelect} source={source} />
      ))}
    </div>
  )
},

 ExpandedSourceDossierSection = (props: Readonly<Pick<ExpandedSourcesTabProps, "onArticleSelect" | "sourceWorkspace">>) => (
  <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
    <ExpandedSourceDossierHeaderBar />
    <ExpandedSourceDossierList onArticleSelect={props.onArticleSelect} sourceWorkspace={props.sourceWorkspace} />
  </div>
),

 ExpandedLeaderboardBar = (props: Readonly<Pick<WorkspaceLeader, "share">>) => {
  const barStyle = { width: `${props.share}%` }
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-[linear-gradient(90deg,rgba(186,137,63,0.95),rgba(231,118,43,0.95))]" style={barStyle} />
    </div>
  )
},

 ExpandedLeaderboardRow = (props: Readonly<{ readonly source: WorkspaceLeader }>) => (
  <div>
    <div className="mb-2 flex items-center justify-between text-sm">
      <span className="truncate pr-4 text-foreground">{props.source.name}</span>
      <span className="shrink-0 text-muted-foreground">{props.source.count}</span>
    </div>
    <ExpandedLeaderboardBar share={props.source.share} />
  </div>
),

 ExpandedSourceLeaderboard = (props: Readonly<Pick<ExpandedSourcesTabProps, "sourceCoverageLeaders">>) => (
  <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
    <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Source Leaderboard</div>
    <div className="space-y-4">
      {props.sourceCoverageLeaders.map((source) => <ExpandedLeaderboardRow key={source.name} source={source} />)}
    </div>
  </div>
),

 ExpandedSourceMetric = (props: ExpandedSourceStatProps) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
    <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{props.label}</div>
    <div className="mt-2 font-serif text-2xl text-foreground">{props.value}</div>
  </div>
),

 ExpandedSourceBreakdown = (props: Readonly<Pick<ExpandedSourcesTabProps, "originVolume" | "selectedCountryCoverage" | "sourceBreakdownRef" | "sourceVolume">>) => (
  <div ref={props.sourceBreakdownRef} className="rounded-[24px] border border-white/10 bg-black/20 p-6">
    <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Source Breakdown</div>
    <div className="grid grid-cols-2 gap-4">
      <ExpandedSourceMetric label="Local Outlet Volume" value={positiveValueOrFallback(props.sourceVolume, props.originVolume)} />
      <ExpandedSourceMetric label="Coverage Heat" value={props.selectedCountryCoverage} />
    </div>
  </div>
),

 ExpandedCoverageBar = (props: Readonly<{ readonly percent: number }>) => {
  const barStyle = { width: `${props.percent}%` }
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-primary" style={barStyle} />
    </div>
  )
},

 ExpandedCoverageRow = (props: Readonly<{ readonly entry: CoverageEntry; readonly leadCount: number }>) => {
  const percent = Math.max(MIN_COVERAGE_BAR, (props.entry.count / props.leadCount) * MAX_PERCENT)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{props.entry.country}</span>
        <span>{props.entry.count}</span>
      </div>
      <ExpandedCoverageBar percent={percent} />
    </div>
  )
},

 ExpandedCoverageMap = (props: Readonly<Pick<ExpandedSourcesTabProps, "coverageBreakdown" | "coverageMapRef">>) => {
  const [leadEntry] = props.coverageBreakdown
  return (
    <div ref={props.coverageMapRef} className="rounded-[24px] border border-white/10 bg-black/20 p-6">
      <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Coverage Map</div>
      {leadEntry === undefined ? (
        <p className="text-sm text-muted-foreground">Coverage breakdown appears after the lens resolves article geography.</p>
      ) : (
        <div className="space-y-3">
          {props.coverageBreakdown.map((entry) => <ExpandedCoverageRow key={entry.country} entry={entry} leadCount={leadEntry.count} />)}
        </div>
      )}
    </div>
  )
},

 ExpandedSourcesAside = (props: Readonly<ExpandedSourcesTabProps>) => (
  <div className="space-y-6">
    <ExpandedSourceLeaderboard sourceCoverageLeaders={props.sourceCoverageLeaders} />
    <ExpandedSourceBreakdown
      originVolume={props.originVolume}
      selectedCountryCoverage={props.selectedCountryCoverage}
      sourceBreakdownRef={props.sourceBreakdownRef}
      sourceVolume={props.sourceVolume}
    />
    <ExpandedCoverageMap coverageBreakdown={props.coverageBreakdown} coverageMapRef={props.coverageMapRef} />
  </div>
),

 ExpandedSourcesBody = (props: Readonly<ExpandedSourcesTabProps>) => (
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
    <ExpandedSourceDossierSection onArticleSelect={props.onArticleSelect} sourceWorkspace={props.sourceWorkspace} />
    <ExpandedSourcesAside {...props} />
  </div>
),

 ExpandedSourcesTab = (props: Readonly<ExpandedSourcesTabProps>) => (
  <div className="space-y-8">
    <div className="rounded-[28px] border border-white/10 bg-black/30 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <ExpandedSourceWorkspaceHeader {...props} />
      <ExpandedSourcesBody {...props} />
    </div>
  </div>
),

 ACTION_ICON_SIZE = 16,
  ARTICLE_IMAGE_HEIGHT = 120,
  ARTICLE_IMAGE_WIDTH = 200

interface ExpandedArticleRowProps {
  readonly article: ReadonlyArticle
  readonly isBookmarked: (articleId: number) => boolean
  readonly onToggleBookmark: (articleId: number) => Promise<void>
  readonly onSelect: (article: ReadonlyArticle) => void
}

const expandedArticleCountryLabel = (article: ReadonlyArticle): string => {
  if (article.source_country === "United States") {return "US"}
  if (hasText(article.source_country)) {return article.source_country}
  return "GLB"
},

 ExpandedArticleMeta = (props: Readonly<Pick<ExpandedArticleRowProps, "article">>) => (
  <div className="mb-2 flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
    <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-primary">{sourceLabel(props.article)}</Badge>
    <span>{formatPublishedDate(props.article.publishedAt)}</span>
  </div>
),

 ExpandedArticleBody = (props: Readonly<Pick<ExpandedArticleRowProps, "article">>) => (
  <div className="min-w-0 flex-1 py-1">
    <ExpandedArticleMeta article={props.article} />
    <h3 className="mb-2 font-serif text-lg text-foreground transition-colors group-hover:text-primary">{props.article.title}</h3>
    <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{props.article.summary}</p>
    <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">{expandedArticleCountryLabel(props.article)}</Badge>
  </div>
),

 bookmarkClassName = (bookmarked: boolean): string => {
  if (bookmarked) {return "text-primary"}
  return "hover:text-foreground"
},

 bookmarkLabel = (bookmarked: boolean): string => {
  if (bookmarked) {return "Remove bookmark"}
  return "Bookmark article"
},

 ExpandedArticleActions = (props: Readonly<ExpandedArticleRowProps>) => {
  const bookmarked = props.isBookmarked(props.article.id),
   handleBookmark = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    void props.onToggleBookmark(props.article.id)
  }, [props.article.id, props.onToggleBookmark]),
   handleOpenOriginal = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    globalThis.open(props.article.url, "_blank", "noopener,noreferrer")
  }, [props.article.url])
  return (
    <div className="mb-2 flex gap-2 text-muted-foreground">
      <button
        type="button"
        onClick={handleBookmark}
        className={cn("transition-colors", bookmarkClassName(bookmarked))}
        title={bookmarkLabel(bookmarked)}
        aria-label={bookmarkLabel(bookmarked)}
      >
        <Bookmark size={ACTION_ICON_SIZE} className={bookmarked ? "fill-current" : undefined} />
      </button>
      <button type="button" onClick={handleOpenOriginal} className="hover:text-foreground" title="Open original article" aria-label="Open original article">
        <MoreHorizontal size={ACTION_ICON_SIZE} />
      </button>
    </div>
  )
},

 ExpandedArticleImage = (props: Readonly<Pick<ExpandedArticleRowProps, "article">>) => {
  if (!hasRealImage(props.article.image)) {return}
  return (
    <div className="h-[120px] w-[200px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[var(--news-bg-primary)]/40 sepia transition-all group-hover:sepia-0">
      <SafeImage src={props.article.image} alt="" width={ARTICLE_IMAGE_WIDTH} height={ARTICLE_IMAGE_HEIGHT} className="h-full w-full object-cover" />
    </div>
  )
},

 ExpandedArticleAside = (props: Readonly<ExpandedArticleRowProps>) => (
  <div className="flex shrink-0 flex-col items-end justify-between">
    <ExpandedArticleActions {...props} />
    <ExpandedArticleImage article={props.article} />
  </div>
),

 ExpandedArticleRow = (props: ExpandedArticleRowProps) => {
  const handleSelect = useCallback(() =>{  props.onSelect(props.article); }, [props.article, props.onSelect]),
   handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      handleSelect()
    }
  }, [handleSelect])
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open article: ${props.article.title}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className="group flex cursor-pointer gap-6 border-b border-white/10 p-6 transition-all last:border-0 hover:bg-white/[0.03]"
    >
      <ExpandedArticleBody article={props.article} />
      <ExpandedArticleAside {...props} />
    </div>
  )
}

interface ExpandedBriefingTabProps {
  readonly selectedCountry: CountrySelection
  readonly localLensData: LocalLensResponse | undefined
  readonly latestLensTimestamp: number | undefined
  readonly articleCount: number
  readonly expandedArticles: readonly ReadonlyArticle[]
  readonly expandedSort: ExpandedSortMode
  readonly onCycleSort: () => void
  readonly isBookmarked: (articleId: number) => boolean
  readonly onToggleBookmark: (articleId: number) => Promise<void>
  readonly onArticleSelect: (article: ReadonlyArticle) => void
  readonly topicSignals: readonly TopicSignalEntry[]
  readonly sourceSummary: readonly SourceSummaryEntry[]
  readonly selectedCountryCoverage: number
  readonly intensityScore: number
  readonly coverageBreakdown: readonly CoverageEntry[]
  readonly lensBriefRef: RefObject<HTMLDivElement | null>
  readonly topStoriesRef: RefObject<HTMLDivElement | null>
  readonly trendingTopicsRef: RefObject<HTMLDivElement | null>
  readonly sourceBreakdownRef: RefObject<HTMLDivElement | null>
  readonly coverageMapRef: RefObject<HTMLDivElement | null>
}

const expandedSortLabel = (sortMode: ExpandedSortMode): string => {
  if (sortMode === "oldest") {return "Oldest First"}
  if (sortMode === "source") {return "Source A-Z"}
  return "Most Recent"
},

 formatLatestTimestamp = (timestamp: number | undefined): string => {
  if (timestamp === undefined) {return "N/A"}
  return formatPublishedDate(new Date(timestamp).toISOString())
},

 ExpandedLensBriefHeader = () => (
  <div className="mb-4 flex items-center gap-2 text-primary">
    <MapPin size={ICON_SIZE} />
    <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Lens Brief</span>
  </div>
),

 ExpandedLensBriefSignal = (props: Readonly<Pick<ExpandedBriefingTabProps, "localLensData">>) => {
  if (props.localLensData?.geo_signal === undefined) {return}
  return (
    <Badge variant="outline" className="mb-4 rounded-full border-primary/25 bg-primary/10 px-3 py-1 text-[9px] uppercase tracking-widest text-primary">
      {props.localLensData.geo_signal.label}
    </Badge>
  )
},

 ExpandedLensBriefMetadata = (props: Readonly<Pick<ExpandedBriefingTabProps, "latestLensTimestamp" | "localLensData">>) => {
  const matchingStrategy = props.localLensData?.matching_strategy
  return (
    <div className="space-y-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      <div>Match: {hasText(matchingStrategy) ? matchingStrategy.replaceAll("_", " ") : "N/A"}</div>
      <div>Latest Indexed: {formatLatestTimestamp(props.latestLensTimestamp)}</div>
    </div>
  )
},

 ExpandedLensBriefCopy = (props: Readonly<ExpandedBriefingTabProps>) => (
  <div className="relative z-10 w-2/3">
    <ExpandedLensBriefHeader />
    <h2 className="mb-6 font-serif text-2xl text-foreground">{briefingDescriptionFor(props.selectedCountry, props.localLensData)}</h2>
    <ExpandedLensBriefSignal localLensData={props.localLensData} />
    <ExpandedLensBriefMetadata latestLensTimestamp={props.latestLensTimestamp} localLensData={props.localLensData} />
  </div>
),

 ExpandedLensBriefDecoration = () => (
  <div className="absolute right-8 top-1/2 flex -translate-y-1/2 items-center justify-center opacity-60">
    <div className="h-32 w-48 rounded-full bg-[radial-gradient(circle,rgba(186,137,63,0.45)_1px,transparent_1.4px)] blur-[0.2px] [background-size:8px_8px]" />
  </div>
),

 ExpandedLensBrief = (props: Readonly<ExpandedBriefingTabProps>) => (
  <div ref={props.lensBriefRef} className="relative mb-8 overflow-hidden rounded-[28px] border border-primary/15 bg-[linear-gradient(135deg,rgba(186,137,63,0.12),rgba(10,10,10,0.78)_45%,rgba(10,10,10,0.92))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
    <ExpandedLensBriefCopy {...props} />
    <ExpandedLensBriefDecoration />
  </div>
),

 ExpandedArticleUpdated = (props: Readonly<{ readonly timestampLabel: string }>) => (
  <span>Updated {props.timestampLabel} <Radio size={ICON_SIZE - 2} className="ml-1 inline" /></span>
),

 ExpandedArticleListControls = (props: Readonly<Pick<ExpandedBriefingTabProps, "expandedSort" | "latestLensTimestamp" | "onCycleSort">>) => (
  <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
    <ExpandedArticleUpdated timestampLabel={formatLatestTimestamp(props.latestLensTimestamp)} />
    <button type="button" onClick={props.onCycleSort} className="flex items-center gap-1 transition-colors hover:text-foreground">
      {expandedSortLabel(props.expandedSort)} <ChevronDown size={ICON_SIZE - 2} />
    </button>
  </div>
),

 ExpandedArticleListHeader = (props: Readonly<Pick<ExpandedBriefingTabProps, "articleCount" | "expandedSort" | "latestLensTimestamp" | "onCycleSort" | "topStoriesRef">>) => (
  <div ref={props.topStoriesRef} className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{props.articleCount} Articles</div>
    <ExpandedArticleListControls expandedSort={props.expandedSort} latestLensTimestamp={props.latestLensTimestamp} onCycleSort={props.onCycleSort} />
  </div>
),

 ExpandedArticleList = (props: Readonly<Pick<ExpandedBriefingTabProps, "expandedArticles" | "isBookmarked" | "onArticleSelect" | "onToggleBookmark">>) => {
  if (props.expandedArticles.length === EMPTY_COUNT) {
    return <div className="rounded-[28px] border border-white/10 bg-black/30 p-12 text-center text-sm font-mono uppercase tracking-widest text-muted-foreground">No articles available</div>
  }
  return (
    <div className="space-y-0 overflow-hidden rounded-[28px] border border-white/10 bg-black/30 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      {props.expandedArticles.map((article, index) => (
        <ExpandedArticleRow
          key={articleRenderKey(article, index)}
          article={article}
          isBookmarked={props.isBookmarked}
          onSelect={props.onArticleSelect}
          onToggleBookmark={props.onToggleBookmark}
        />
      ))}
    </div>
  )
},

 ExpandedTopicSignalList = (props: Readonly<Pick<ExpandedBriefingTabProps, "topicSignals">>) => {
  if (props.topicSignals.length === EMPTY_COUNT) {
    return <p className="text-sm text-muted-foreground">No topic signals yet for this lens.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {props.topicSignals.map((topic) => (
        <Badge key={topic.label} variant="outline" className="rounded-full border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-wider text-primary">{topic.label} · {topic.count}</Badge>
      ))}
    </div>
  )
},

 ExpandedTopicSignals = (props: Readonly<Pick<ExpandedBriefingTabProps, "topicSignals" | "trendingTopicsRef">>) => (
  <div ref={props.trendingTopicsRef} className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
    <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Trending Topics</div>
    <ExpandedTopicSignalList topicSignals={props.topicSignals} />
  </div>
),

 ExpandedSourceSummaryRows = (props: Readonly<Pick<ExpandedBriefingTabProps, "sourceSummary">>) => (
  <div className="space-y-3">
    {props.sourceSummary.slice(0, COVERAGE_LIMIT).map((source) => (
      <div key={source.name} className="flex items-center justify-between text-sm">
        <span className="text-foreground">{source.name}</span>
        <span className="text-muted-foreground">{source.count}</span>
      </div>
    ))}
  </div>
),

 ExpandedSourceSummary = (props: Readonly<Pick<ExpandedBriefingTabProps, "sourceBreakdownRef" | "sourceSummary">>) => (
  <div ref={props.sourceBreakdownRef} className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
    <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Source Breakdown</div>
    <ExpandedSourceSummaryRows sourceSummary={props.sourceSummary} />
  </div>
),

 ExpandedSnapshotMetric = (props: Readonly<{ readonly label: string; readonly value: string }>) => (
  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
    <div className="mt-2 font-serif text-2xl text-foreground">{props.value}</div>
  </div>
),

 ExpandedLensSnapshot = (props: Readonly<Pick<ExpandedBriefingTabProps, "intensityScore" | "selectedCountryCoverage">>) => (
  <div className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
    <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Lens Snapshot</div>
    <div className="grid grid-cols-2 gap-4">
      <ExpandedSnapshotMetric label="Coverage Heat" value={String(props.selectedCountryCoverage)} />
      <ExpandedSnapshotMetric label="Intensity" value={`${props.intensityScore}/${MAX_INTENSITY_SCORE}`} />
    </div>
  </div>
),

 ExpandedCoverageMapCard = (props: Readonly<Pick<ExpandedBriefingTabProps, "coverageBreakdown" | "coverageMapRef">>) => {
  const [leadEntry] = props.coverageBreakdown
  return (
    <div ref={props.coverageMapRef} className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
      <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Coverage Map</div>
      {leadEntry === undefined ? (
        <p className="text-sm text-muted-foreground">Coverage breakdown appears after the lens resolves article geography.</p>
      ) : (
        <div className="space-y-3">
          {props.coverageBreakdown.map((entry) => <ExpandedCoverageRow key={entry.country} entry={entry} leadCount={leadEntry.count} />)}
        </div>
      )}
    </div>
  )
},

 ExpandedBriefingSummary = (props: Readonly<ExpandedBriefingTabProps>) => (
  <>
    <div className="mt-8 grid grid-cols-2 gap-6">
      <ExpandedSourceSummary sourceBreakdownRef={props.sourceBreakdownRef} sourceSummary={props.sourceSummary} />
      <ExpandedLensSnapshot intensityScore={props.intensityScore} selectedCountryCoverage={props.selectedCountryCoverage} />
    </div>
    <ExpandedCoverageMapCard coverageBreakdown={props.coverageBreakdown} coverageMapRef={props.coverageMapRef} />
  </>
),

 ExpandedBriefingTab = (props: Readonly<ExpandedBriefingTabProps>) => (
  <>
    <ExpandedLensBrief {...props} />
    <ExpandedArticleListHeader
      articleCount={props.articleCount}
      expandedSort={props.expandedSort}
      latestLensTimestamp={props.latestLensTimestamp}
      onCycleSort={props.onCycleSort}
      topStoriesRef={props.topStoriesRef}
    />
    <ExpandedArticleList
      expandedArticles={props.expandedArticles}
      isBookmarked={props.isBookmarked}
      onArticleSelect={props.onArticleSelect}
      onToggleBookmark={props.onToggleBookmark}
    />
    <ExpandedTopicSignals topicSignals={props.topicSignals} trendingTopicsRef={props.trendingTopicsRef} />
    <ExpandedBriefingSummary {...props} />
  </>
)

function ExpandedRightSidebar({
  focusLabel,
  articleCount,
  sourceCount,
  selectedCountryCoverage,
  topSources,
  viewMode,
  onViewModeChange,
  lightingMode,
  onLightingChange,
  intensityScore,
  countryMetrics,
  onScrollTo,
  lensBriefRef,
}:Readonly< {
  focusLabel: string
  articleCount: number
  sourceCount: number
  selectedCountryCoverage: number
  topSources: SourceSummaryEntry[]
  viewMode: "internal" | "external"
  onViewModeChange: (value: "internal" | "external") => void
  lightingMode: LightingMode
  onLightingChange: (mode: LightingMode) => void
  intensityScore: number
  countryMetrics: CountryArticleCounts
  onScrollTo: (ref: RefObject<HTMLDivElement | null>) => void
  lensBriefRef: RefObject<HTMLDivElement | null>
}>) {
  return (
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
          onClick={() =>{  onViewModeChange("internal"); }}
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
          onClick={() =>{  onViewModeChange("external"); }}
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
      <button onClick={() =>{  onScrollTo(lensBriefRef); }} className="text-primary border-b border-primary/60 text-[10px] uppercase tracking-widest mb-6 inline-block pb-0.5 hover:opacity-80 w-max">View guide →</button>

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
        <button onClick={() =>{  onLightingChange("all-lit"); }} className={cn("px-2 py-3 text-[9px] uppercase tracking-[0.18em] whitespace-nowrap border-r border-white/10 transition-colors", lightingMode === "all-lit" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>All Lit</button>
        <button onClick={() =>{  onLightingChange("day-night"); }} className={cn("px-2 py-3 text-[9px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors", lightingMode === "day-night" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground")}>Day / Night</button>
      </div>
    </div>
  )
}

type GlobeViewExpandedDashboardProps = Readonly<{
  isFocusExpanded: boolean
  sidebarTab: string
  leftSidebar: Parameters<typeof ExpandedLeftSidebar>[0]
  topNav: Omit<Parameters<typeof ExpandedTopNav>[0], "onClose">
  sourcesTab: Parameters<typeof ExpandedSourcesTab>[0]
  briefingTab: Parameters<typeof ExpandedBriefingTab>[0]
  rightSidebar: Parameters<typeof ExpandedRightSidebar>[0]
  onClose: () => void
}>

const GlobeViewExpandedDashboard = ({
  isFocusExpanded,
  sidebarTab,
  leftSidebar,
  topNav,
  sourcesTab,
  briefingTab,
  rightSidebar,
  onClose,
}: GlobeViewExpandedDashboardProps) => (
  <div className={cn(
    "absolute inset-0 z-50 hidden text-foreground transition-all duration-500 lg:block",
    isFocusExpanded ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none hidden",
  )}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(186,137,63,0.14),transparent_28%),rgba(3,3,3,0.36)] backdrop-blur-md" />
    <div className="relative z-10 flex h-full">
      <ExpandedLeftSidebar {...leftSidebar} />
      <div className="flex-1 flex flex-col min-w-0 bg-transparent">
        <ExpandedTopNav {...topNav} onClose={onClose} />
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          {sidebarTab === "sources" ? (
            <ExpandedSourcesTab {...sourcesTab} />
          ) : (
            <ExpandedBriefingTab {...briefingTab} />
          )}
        </div>
      </div>
      <ExpandedRightSidebar {...rightSidebar} />
    </div>
  </div>
)

type GlobeViewLayoutProps = Readonly<{
  articles: NewsArticle[]
  countryMetrics: CountryArticleCounts
  onCountrySelect: (country: string | null) => void
  selectedCountry: string | null
  lightingMode: LightingMode
  floatingHeader: Parameters<typeof FloatingHeader>[0]
  intensityPanel: Parameters<typeof IntensityPanel>[0]
  collapsedPanel: Parameters<typeof CollapsedPanel>[0]
  expandedDashboard: GlobeViewExpandedDashboardProps
  articleModal: Parameters<typeof ArticleDetailModal>[0]
}>

const GlobeViewLayout = ({
  articles,
  countryMetrics,
  onCountrySelect,
  selectedCountry,
  lightingMode,
  floatingHeader,
  intensityPanel,
  collapsedPanel,
  expandedDashboard,
  articleModal,
}: GlobeViewLayoutProps) => (
  <div className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
    <div className="absolute inset-0 z-0">
      <InteractiveGlobe
        articles={articles}
        countryMetrics={countryMetrics}
        onCountrySelect={onCountrySelect}
        selectedCountry={selectedCountry}
        lightingMode={lightingMode}
      />
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />
    </div>
    <FloatingHeader {...floatingHeader} />
    <IntensityPanel {...intensityPanel} />
    <CollapsedPanel {...collapsedPanel} />
    <GlobeViewExpandedDashboard {...expandedDashboard} />
    <ArticleDetailModal {...articleModal} />
  </div>
)

type GlobeViewContentProps = Readonly<{
  articles: NewsArticle[]
  loading: boolean
  selectionState: ReturnType<typeof useGlobeSelectionState>
  displayData: ReturnType<typeof useGlobeDisplayData>
  actions: ReturnType<typeof useGlobeInteractionActions>
  bookmarks: ReturnType<typeof useBookmarks>
}>

type GlobeViewRenderInput = GlobeViewContentProps

const buildFloatingHeaderProps = ({
  articles,
  selectionState,
  displayData,
  actions,
}: GlobeViewRenderInput): Parameters<typeof FloatingHeader>[0] => {
  const { isFocusExpanded, selectedCountry } = selectionState,
   { articleCount, focusLabel, localLensData } = displayData
  return {
    articleCount,
    focusLabel,
    globalArticleCount: articles.length,
    isFocusExpanded,
    localLensData: localLensData ?? undefined,
    onResetFocus: () => { actions.handleCountrySelect(null); },
    selectedCountry,
  }
},

 buildIntensityPanelProps = ({
  selectionState,
  displayData,
}: GlobeViewRenderInput): Parameters<typeof IntensityPanel>[0] => ({
  heatLabel: displayData.heatLabel,
  isFocusExpanded: selectionState.isFocusExpanded,
  lightingMode: selectionState.earthLightingMode,
  onLightingChange: selectionState.setEarthLightingMode,
}),

 buildCollapsedPanelProps = ({
  loading,
  selectionState,
  displayData,
  actions,
}: GlobeViewRenderInput): Parameters<typeof CollapsedPanel>[0] => {
  const {
    selectedCountry,
    isFocusExpanded,
    isMobileSheetExpanded,
    sidebarTab,
    setSidebarTab,
    setIsFocusExpanded,
    setLensLimit,
    viewMode,
    setViewMode,
    earthLightingMode,
  } = selectionState,
   {
    focusLabel,
    articleCount,
    sourceCount,
    selectedCountryCoverage,
    selectedCountryMeta,
    topSources,
    localLensData,
    lensArticles,
    sourceWorkspace,
    sourceSummary,
    selectedCountryOriginVolume,
    selectedCountrySourceVolume,
    selectedCountryMentionVolume,
    verificationStats,
  } = displayData,
   {
    handleCountrySelect,
    handleSheetHandleClick,
    handleSheetDragStart,
    handleSheetDragMove,
    finishSheetDrag,
    cancelSheetDrag,
    handleArticleSelect,
    setAllLit,
    setDayNight,
    toggleMobileSheet,
  } = actions
  return {
    articleCount,
    coverage: selectedCountryCoverage,
    focusLabel,
    highPct: verificationStats.highPct,
    isFocusExpanded,
    isMobileSheetExpanded,
    lensArticles,
    lightingMode: earthLightingMode,
    loading,
    localLensData: localLensData ?? undefined,
    mentionVolume: selectedCountryMentionVolume,
    onArticleSelect: handleArticleSelect,
    onExpandFocus: () => { setIsFocusExpanded(true); },
    onHandleClick: handleSheetHandleClick,
    onHandlePointerCancel: cancelSheetDrag,
    onHandlePointerDown: handleSheetDragStart,
    onHandlePointerMove: handleSheetDragMove,
    onHandlePointerUp: finishSheetDrag,
    onLoadMore: () => { setLensLimit((previous) => previous + 20); },
    onResetFocus: () => { handleCountrySelect(null); },
    onSetAllLit: setAllLit,
    onSetDayNight: setDayNight,
    onSidebarTabChange: setSidebarTab,
    onToggleMobileSheet: toggleMobileSheet,
    onViewModeChange: setViewMode,
    originVolume: selectedCountryOriginVolume,
    selectedCountry,
    selectedCountryCoverage,
    selectedCountryMeta: selectedCountryMeta ?? undefined,
    sidebarTab,
    sourceCount,
    sourceSummaryLength: sourceSummary.length,
    sourceVolume: selectedCountrySourceVolume,
    sourceWorkspace,
    topSources,
    viewMode,
  }
},

 buildExpandedLeftSidebarProps = ({
  selectionState,
  displayData,
  actions,
}: GlobeViewRenderInput): Parameters<typeof ExpandedLeftSidebar>[0] => {
  const { sidebarTab, viewMode, setViewMode, lensBriefRef, topStoriesRef, trendingTopicsRef, sourceBreakdownRef, coverageMapRef } = selectionState,
   { focusLabel, articleCount, sourceCount, selectedCountryCoverage, selectedCountryMeta, topSources } = displayData
  return {
    articleCount,
    coverageMapRef,
    focusLabel,
    lensBriefRef,
    onNavigate: actions.handleQuickNav,
    onViewModeChange: setViewMode,
    selectedCountryCoverage,
    selectedCountryMeta: selectedCountryMeta ?? undefined,
    sidebarTab,
    sourceBreakdownRef,
    sourceCount,
    topSources,
    topStoriesRef,
    trendingTopicsRef,
    viewMode,
  }
},

 buildExpandedTopNavProps = ({
  selectionState,
  actions,
}: GlobeViewRenderInput): Omit<Parameters<typeof ExpandedTopNav>[0], "onClose"> => ({
  lensBriefRef: selectionState.lensBriefRef,
  onNavigate: actions.handleQuickNav,
  sidebarTab: selectionState.sidebarTab,
  sourceBreakdownRef: selectionState.sourceBreakdownRef,
  trendingTopicsRef: selectionState.trendingTopicsRef,
}),

 buildExpandedSourcesTabProps = ({
  selectionState,
  displayData,
  actions,
}: GlobeViewRenderInput): Parameters<typeof ExpandedSourcesTab>[0] => {
  const { sourceBreakdownRef, coverageMapRef } = selectionState,
   {
    articleCount,
    sourceCount,
    focusLabel,
    sourceWorkspace,
    sourceCoverageLeaders,
    coverageBreakdown,
    selectedCountryOriginVolume,
    selectedCountrySourceVolume,
    selectedCountryCoverage,
  } = displayData
  return {
    articleCount,
    coverageBreakdown,
    coverageMapRef,
    focusLabel,
    onArticleSelect: actions.handleArticleSelect,
    originVolume: selectedCountryOriginVolume,
    selectedCountryCoverage,
    sourceBreakdownRef,
    sourceCount,
    sourceCoverageLeaders,
    sourceVolume: selectedCountrySourceVolume,
    sourceWorkspace,
  }
},

 buildExpandedBriefingTabProps = ({
  selectionState,
  displayData,
  actions,
  bookmarks,
}: GlobeViewRenderInput): Parameters<typeof ExpandedBriefingTab>[0] => {
  const {
    selectedCountry,
    expandedSort,
    lensBriefRef,
    topStoriesRef,
    trendingTopicsRef,
    sourceBreakdownRef,
    coverageMapRef,
  } = selectionState,
   {
    localLensData,
    latestLensTimestamp,
    articleCount,
    expandedArticles,
    topicSignals,
    sourceSummary,
    selectedCountryCoverage,
    intensityScore,
    coverageBreakdown,
  } = displayData
  return {
    articleCount,
    coverageBreakdown,
    coverageMapRef,
    expandedArticles,
    expandedSort,
    intensityScore,
    isBookmarked: bookmarks.isBookmarked,
    latestLensTimestamp: latestLensTimestamp ?? undefined,
    lensBriefRef,
    localLensData: localLensData ?? undefined,
    onArticleSelect: actions.handleArticleSelect,
    onCycleSort: actions.cycleExpandedSort,
    onToggleBookmark: bookmarks.toggleBookmark,
    selectedCountry,
    selectedCountryCoverage,
    sourceBreakdownRef,
    sourceSummary,
    topStoriesRef,
    topicSignals,
    trendingTopicsRef,
  }
},

 buildExpandedRightSidebarProps = ({
  selectionState,
  displayData,
  actions,
}: GlobeViewRenderInput): Parameters<typeof ExpandedRightSidebar>[0] => {
  const { viewMode, setViewMode, earthLightingMode, setEarthLightingMode, lensBriefRef } = selectionState,
   {
    focusLabel,
    articleCount,
    sourceCount,
    selectedCountryCoverage,
    topSources,
    intensityScore,
    countryMetrics,
  } = displayData
  return {
    articleCount,
    countryMetrics,
    focusLabel,
    intensityScore,
    lensBriefRef,
    lightingMode: earthLightingMode,
    onLightingChange: setEarthLightingMode,
    onScrollTo: actions.scrollToSection,
    onViewModeChange: setViewMode,
    selectedCountryCoverage,
    sourceCount,
    topSources,
    viewMode,
  }
},

 buildExpandedDashboardProps = (
  input: GlobeViewRenderInput,
): GlobeViewExpandedDashboardProps => ({
  briefingTab: buildExpandedBriefingTabProps(input),
  isFocusExpanded: input.selectionState.isFocusExpanded,
  leftSidebar: buildExpandedLeftSidebarProps(input),
  onClose: () => { input.selectionState.setIsFocusExpanded(false); },
  rightSidebar: buildExpandedRightSidebarProps(input),
  sidebarTab: input.selectionState.sidebarTab,
  sourcesTab: buildExpandedSourcesTabProps(input),
  topNav: buildExpandedTopNavProps(input),
}),

 buildArticleModalProps = ({
  selectionState,
}: GlobeViewRenderInput): Parameters<typeof ArticleDetailModal>[0] => ({
  article: selectionState.selectedArticle,
  isOpen: selectionState.isArticleModalOpen,
  onClose: () => { selectionState.setIsArticleModalOpen(false); },
}),

 GlobeViewContent = (props: GlobeViewContentProps) => {
  const { articles, displayData, selectionState, actions } = props
  return (
    <GlobeViewLayout
      articles={articles}
      countryMetrics={displayData.countryMetrics}
      onCountrySelect={actions.handleCountrySelect}
      selectedCountry={selectionState.selectedCountry}
      lightingMode={selectionState.earthLightingMode}
      floatingHeader={buildFloatingHeaderProps(props)}
      intensityPanel={buildIntensityPanelProps(props)}
      collapsedPanel={buildCollapsedPanelProps(props)}
      expandedDashboard={buildExpandedDashboardProps(props)}
      articleModal={buildArticleModalProps(props)}
    />
  )
}

export function GlobeView({ articles, loading }: GlobeViewProps) {
  const selectionState = useGlobeSelectionState(),
   bookmarks = useBookmarks(),

  { data: geoData } = useQuery({
    queryFn: fetchCountryGeoData,
    queryKey: ["country-geo-data"],
    staleTime: Infinity,
  }),
   actions = useGlobeInteractionActions(selectionState, geoData),

   displayData = useGlobeDisplayData({
    articles,
    expandedSort: selectionState.expandedSort,
    geoData,
    lensLimit: selectionState.lensLimit,
    selectedCountry: selectionState.selectedCountry,
    selectedCountryName: selectionState.selectedCountryName,
    viewMode: selectionState.viewMode,
  })

  return (
    <GlobeViewContent
      articles={articles}
      loading={loading}
      selectionState={selectionState}
      displayData={displayData}
      actions={actions}
      bookmarks={bookmarks}
    />
  )
}
