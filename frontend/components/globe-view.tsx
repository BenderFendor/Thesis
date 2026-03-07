"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { InteractiveGlobe } from "./interactive-globe"
import { ArticleDetailModal } from "./article-detail-modal"
import {
  fetchArticleCountsByCountry,
  fetchCountryGeoData,
  fetchCountryList,
  fetchNewsForCountry,
  type CountryArticleCounts,
  type NewsArticle,
} from "@/lib/api"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertCircle,
  Globe2,
  MapPin,
  Newspaper,
  Radio,
  ShieldCheck,
  Signal,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface GlobeViewProps {
  articles: NewsArticle[]
  loading: boolean
}

const DEFAULT_WINDOW_HOURS = 24

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

function intensityLabel(metrics?: CountryArticleCounts) {
  if (!metrics?.counts) return "Coverage heat"
  return metrics.window_hours ? `Coverage heat · ${metrics.window_hours}h` : "Coverage heat"
}

export function GlobeView({ articles, loading }: GlobeViewProps) {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"internal" | "external">("internal")
  const [sidebarTab, setSidebarTab] = useState("briefing")

  const { data: countryMetrics } = useQuery({
    queryKey: ["globe-country-metrics", DEFAULT_WINDOW_HOURS],
    queryFn: () => fetchArticleCountsByCountry(),
  })

  const { data: geoData } = useQuery({
    queryKey: ["country-geo-data"],
    queryFn: fetchCountryGeoData,
    staleTime: Infinity,
  })

  const { data: countryList } = useQuery({
    queryKey: ["country-list"],
    queryFn: fetchCountryList,
  })

  const localLensQuery = useQuery({
    queryKey: ["globe-country-news", selectedCountry, viewMode, DEFAULT_WINDOW_HOURS],
    queryFn: () => fetchNewsForCountry(selectedCountry || "", viewMode, 40, 0, DEFAULT_WINDOW_HOURS),
    enabled: Boolean(selectedCountry),
  })

  const handleCountrySelect = (country: string | null, name?: string | null) => {
    setSelectedCountry(country)
    const resolvedName = country && geoData?.countries?.[country]?.name
    setSelectedCountryName(country ? resolvedName || name || country : null)
    setViewMode("internal")
    setSidebarTab("briefing")
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

  const selectedLensArticles = selectedCountry ? localLensQuery.data?.articles || [] : []
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
  const focusLabel = selectedCountryName || "Global Focus"
  const leadArticle = lensArticles[0] || null
  const topSources = (selectedCountry ? sourceSummary : globalSourceSummary).slice(0, 5)
  const briefingDescription = selectedCountry
    ? localLensQuery.data?.view_description || "Choose a lens to compare internal and external coverage."
    : "Select a country to compare what local outlets say with how the rest of the world covers it."
  const matchingStrategy = localLensQuery.data?.matching_strategy
  const isBriefingLoading = selectedCountry ? localLensQuery.isLoading : loading
  const sourceCount = selectedCountry
    ? localLensQuery.data?.source_count || sourceSummary.length
    : globalSourceSummary.length
  const articleCount = selectedCountry ? localLensQuery.data?.total || 0 : articles.length
  const selectedCountryMeta = useMemo(() => {
    if (!selectedCountry) return null
    return countryList?.countries.find((item) => item.code === selectedCountry) || null
  }, [countryList, selectedCountry])

  return (
    <div className="relative flex h-[calc(100vh-60px)] w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <div className="relative z-0 flex-1">
        <InteractiveGlobe
          articles={articles}
          countryMetrics={countryMetrics}
          onCountrySelect={handleCountrySelect}
          selectedCountry={selectedCountry}
        />

        <div className="pointer-events-none absolute inset-0 z-[1] bg-black/20" />

        <div className="pointer-events-none absolute left-8 top-8 z-10">
          <div className="pointer-events-auto space-y-3">
            <div className="flex items-center gap-3">
              <span className="rounded-sm border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-primary">
                Global Desk
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {selectedCountry ? `${articleCount} lens articles` : `${articles.length} live articles`}
              </span>
            </div>
            <h2 className="font-serif text-5xl font-semibold tracking-tight text-foreground drop-shadow-md">
              {focusLabel}
            </h2>
            <p className="max-w-lg text-sm leading-relaxed text-foreground/75">
              {briefingDescription}
            </p>
            {selectedCountry && (
              <button
                onClick={() => handleCountrySelect(null)}
                className="group flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground transition-colors hover:text-primary"
              >
                <X size={12} className="transition-transform group-hover:rotate-90" />
                Reset Focus
              </button>
            )}
          </div>
        </div>

        <div className="absolute bottom-8 left-8 z-10">
          <div className="flex items-center gap-6 rounded-none border border-white/10 bg-[var(--news-bg-secondary)]/80 px-4 py-3 shadow-xl backdrop-blur-md">
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
          </div>
        </div>
      </div>

      <div className="relative z-50 flex w-[420px] shrink-0 flex-col border-l border-white/10 bg-[var(--news-bg-secondary)]/95 shadow-2xl backdrop-blur-xl">
        <div className="space-y-3 border-b border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Focus</p>
              <h3 className="font-serif text-2xl text-foreground">{focusLabel}</h3>
              <p className="text-xs text-muted-foreground">
                {articleCount} articles · {sourceCount} sources
              </p>
            </div>
            {selectedCountry && (
              <Button variant="outline" size="sm" onClick={() => handleCountrySelect(null)}>
                Reset
              </Button>
            )}
          </div>

          {selectedCountry ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                  <div className="text-xl font-bold text-foreground">{selectedCountryCoverage}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Coverage Heat</div>
                </div>
                <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                  <div className="text-xl font-bold text-foreground">{selectedCountrySourceVolume}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Local Outlets</div>
                </div>
              </div>
              {selectedCountryMeta && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                    <div className="text-lg font-bold text-foreground">{selectedCountryMeta.article_count}</div>
                    <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Stored Source Rows</div>
                  </div>
                  <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                    <div className="text-lg font-bold text-foreground">{selectedCountryMeta.latest_article ? formatPublishedDate(selectedCountryMeta.latest_article) : "-"}</div>
                    <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Latest Indexed</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-none border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-xs leading-relaxed text-muted-foreground">
              The map is now colored by recent country coverage, not just outlet origin. Click a country to open a local lens and compare domestic framing with outside reporting.
            </div>
          )}

          <div className="border border-white/10 bg-[var(--news-bg-primary)]/30 p-3 text-xs leading-relaxed text-muted-foreground">
            {selectedCountry
              ? `Globe focus is locked on ${focusLabel}. Spin or click another country on the map to compare lenses without leaving this desk.`
              : "Use the globe as the country navigator. Hover to inspect coverage heat, then click a country to open its local and world lens."}
          </div>

          {topSources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {topSources.map((source) => (
                <Badge key={source.name} variant="outline" className="border-white/10 bg-white/5 text-[10px] uppercase tracking-wide">
                  {source.name} · {source.count}
                </Badge>
              ))}
            </div>
          )}

          <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 rounded-none border border-white/10 bg-transparent p-1">
              <TabsTrigger value="briefing" className="text-[10px] uppercase tracking-widest">Briefing</TabsTrigger>
              <TabsTrigger value="intelligence" className="text-[10px] uppercase tracking-widest">Intel</TabsTrigger>
              <TabsTrigger value="sources" className="text-[10px] uppercase tracking-widest">Sources</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="relative flex-1 overflow-hidden">
          {sidebarTab === "briefing" && (
            <div className="flex h-full flex-col">
              <div className="border-b border-white/10 bg-[var(--news-bg-primary)]/30 px-4 py-3">
                <Tabs value={viewMode} onValueChange={(value) => setViewMode(value === "external" ? "external" : "internal")} className="w-full">
                  <TabsList className="h-8 w-full rounded-none border border-white/10 bg-transparent p-0">
                    <TabsTrigger value="internal" className="h-full flex-1 rounded-none border-r border-white/10 text-[9px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                      Local Lens
                    </TabsTrigger>
                    <TabsTrigger value="external" className="h-full flex-1 rounded-none text-[9px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                      World Lens
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 custom-scrollbar">
                {!selectedCountry && (
                  <div className="space-y-4">
                    <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Globe2 size={14} className="text-primary" />
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">How to use it</span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Pick a country to see two lenses: what its own outlets publish, and how foreign outlets frame the same place.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
                        <div className="text-xl font-bold text-foreground">{countryMetrics?.country_count || 0}</div>
                        <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Countries Lit</div>
                      </div>
                      <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
                        <div className="text-xl font-bold text-foreground">{countryMetrics?.articles_with_country || 0}</div>
                        <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Mapped Articles</div>
                      </div>
                    </div>
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
                    <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <MapPin size={14} className="text-primary" />
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Lens brief</span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{briefingDescription}</p>
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
                      lensArticles.map((article) => (
                        <div
                          key={article.id}
                          onClick={() => handleArticleSelect(article)}
                          className="group cursor-pointer border border-white/10 bg-[var(--news-bg-primary)]/40 p-4 transition-all hover:border-white/40 hover:bg-[var(--news-bg-primary)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex items-center gap-2">
                                <Badge variant="outline" className="h-4 border-white/10 py-0 text-[8px] uppercase tracking-wider text-muted-foreground group-hover:border-white/40 group-hover:text-foreground">
                                  {sourceLabel(article)}
                                </Badge>
                                <span className="text-[9px] text-muted-foreground">{formatPublishedDate(article.publishedAt)}</span>
                              </div>
                              <h4 className="font-serif text-sm font-medium leading-snug transition-colors group-hover:text-foreground">
                                {article.title}
                              </h4>
                              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {article.summary}
                              </p>
                              {article.mentioned_countries && article.mentioned_countries.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {article.mentioned_countries.slice(0, 4).map((countryCode) => (
                                    <Badge key={`${article.id}-${countryCode}`} variant="outline" className="border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground">
                                      {countryCode}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            {hasRealImage(article.image) && (
                              <div className="h-16 w-16 shrink-0 overflow-hidden border border-white/10 bg-[var(--news-bg-primary)]/40">
                                <img src={article.image} alt="" className="h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-100" />
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
                  </>
                )}
              </div>
            </div>
          )}

          {sidebarTab === "intelligence" && (
            <div className="h-full space-y-6 overflow-y-auto p-4 custom-scrollbar">
              <div className="overflow-hidden border border-white/10 bg-[var(--news-bg-primary)]/40">
                <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
                  <Newspaper size={14} className="text-primary" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Spotlight Story</span>
                </div>
                {leadArticle ? (
                  <div className="cursor-pointer p-4" onClick={() => handleArticleSelect(leadArticle)}>
                    {hasRealImage(leadArticle.image) && (
                      <div className="relative mb-3 aspect-video w-full overflow-hidden border border-white/10">
                        <img src={leadArticle.image} className="h-full w-full object-cover opacity-80" alt="Lead" />
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

              <div className="overflow-hidden border border-white/10 bg-[var(--news-bg-primary)]/40">
                <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
                  <ShieldCheck size={14} className="text-foreground/70" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Verification Signal</span>
                </div>
                <div className="space-y-4 p-4">
                  <div className="flex items-end justify-between">
                    <div className="text-3xl font-bold text-foreground">{verificationStats.highPct}%</div>
                    <div className="mb-1 text-right text-[10px] text-muted-foreground">
                      High Credibility<br />Sources
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-none bg-white/10">
                    <div className="h-full bg-white/40" style={{ width: `${verificationStats.highPct}%` }} />
                  </div>
                  <div className="text-xs leading-relaxed text-muted-foreground">
                    Based on {lensArticles.length} articles from {sourceSummary.length} active sources in this lens.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                  <div className="text-xl font-bold">{articleCount}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Total Briefs</div>
                </div>
                <div className="border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
                  <div className="text-xl font-bold">{sourceCount}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">Active Feeds</div>
                </div>
              </div>

              {selectedCountry && (
                <div className="space-y-3 border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-primary" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Reading angle</span>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Local Lens shows coverage from inside {focusLabel}. World Lens keeps the country fixed but swaps the narrators to outside sources.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-white/10 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Local lens</div>
                      <div className="mt-2 text-sm text-foreground">{selectedCountrySourceVolume} source-origin signals</div>
                    </div>
                    <div className="border border-white/10 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">World lens</div>
                      <div className="mt-2 text-sm text-foreground">{selectedCountryCoverage} outside mentions in window</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {sidebarTab === "sources" && (
            <div className="h-full overflow-y-auto p-4 custom-scrollbar">
              <div className="space-y-2">
                {sourceSummary.map((source) => (
                  <div key={source.name} className="flex items-center justify-between border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 transition-colors hover:border-white/40">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-none bg-white/10 text-foreground">
                        <Signal size={14} />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{source.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {selectedCountry ? "Lens source" : "Live source"}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                      {source.count}
                    </Badge>
                  </div>
                ))}
                {sourceSummary.length === 0 && (
                  <div className="py-12 text-center text-xs uppercase tracking-widest text-muted-foreground">
                    No sources available
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}
