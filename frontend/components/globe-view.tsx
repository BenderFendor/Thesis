"use client"

import { useState, useMemo } from "react"
import { InteractiveGlobe } from "./interactive-globe"
import { ScrollView } from "./scroll-view"
import { ArticleDetailModal } from "./article-detail-modal"
import { NewsArticle } from "@/lib/api"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface GlobeViewProps {
  articles: NewsArticle[]
  loading: boolean
}

export function GlobeView({ articles, loading }: GlobeViewProps) {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'internal' | 'external'>('internal')

  const handleCountrySelect = (country: string | null, name?: string | null) => {
    setSelectedCountry(country)
    setSelectedCountryName(name || null)
    setViewMode('internal')
  }

  const handleArticleSelect = (article: any) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  const filteredArticles = useMemo(() => {
      if (!selectedCountry) return articles
      
      if (viewMode === 'internal') {
          return articles.filter((article) => article.country === selectedCountry)
      } else {
          if (!selectedCountryName) return []
          const term = selectedCountryName.toLowerCase()
          return articles.filter(article => 
              article.country !== selectedCountry && 
              (article.title.toLowerCase().includes(term) || article.summary.toLowerCase().includes(term))
          )
      }
  }, [articles, selectedCountry, selectedCountryName, viewMode])

  const sourceSummary = useMemo(() => {
    const counts = new Map<string, number>()
    filteredArticles.forEach((article) => {
      const name = article.source || "Unknown"
      counts.set(name, (counts.get(name) || 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filteredArticles])

  const sourceCount = sourceSummary.length
  const focusLabel = selectedCountryName || "Global overview"

  return (
    <div className="h-[calc(100vh-150px)] w-full bg-background text-foreground">
      <main className="h-full">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] gap-4 p-4 h-full">
          <section className="relative h-full rounded-2xl border border-border/60 bg-[var(--news-bg-secondary)]/60 overflow-hidden flex flex-col shadow-lg">
            <div className="px-6 py-4 border-b border-border/60 bg-[var(--news-bg-primary)]/40">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-primary/80">Globe Overview</p>
                  <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight">The Globe</h2>
                  <p className="text-xs text-muted-foreground mt-2">
                    Live geographic signal map. Click a country to shift focus and drill into sources.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                    Live Transmission
                  </span>
                </div>
              </div>
            </div>
            <div className="flex-1 p-4 relative">
              <InteractiveGlobe articles={articles} onCountrySelect={handleCountrySelect} selectedCountry={selectedCountry} />
              <div className="pointer-events-none absolute inset-0">
                <div className="pointer-events-auto absolute right-4 top-4 w-[calc(100%-2rem)] max-w-[360px] rounded-xl border border-border/60 bg-[var(--news-bg-primary)]/90 backdrop-blur-md shadow-xl">
                  <div className="p-4 border-b border-border/60">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                          Country Focus
                        </p>
                        <h2 className="text-lg font-semibold mt-2">
                          {focusLabel}
                        </h2>
                        <p className="text-[11px] text-muted-foreground mt-2">
                          {selectedCountry
                            ? "Showing local sources and global mentions for the selected country."
                            : "Select a country on the globe to filter coverage and source lists."}
                        </p>
                      </div>
                      {selectedCountry && (
                        <button
                          onClick={() => handleCountrySelect(null)}
                          className="text-[10px] font-medium text-muted-foreground hover:text-foreground bg-background/50 px-2.5 py-1 rounded-full transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded border border-border/50 bg-background/40 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Articles</div>
                        <div className="text-sm font-semibold">{filteredArticles.length}</div>
                      </div>
                      <div className="rounded border border-border/50 bg-background/40 px-3 py-2">
                        <div className="text-[10px] uppercase text-muted-foreground">Sources</div>
                        <div className="text-sm font-semibold">{sourceCount || "All"}</div>
                      </div>
                    </div>
                    <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full mt-3">
                      <TabsList className="w-full grid grid-cols-2 bg-background/50 p-1">
                        <TabsTrigger value="internal" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                          Local Sources
                        </TabsTrigger>
                        <TabsTrigger value="external" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">
                          Global Coverage
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  {sourceSummary.length > 0 && (
                    <div className="px-4 py-3 border-b border-border/50">
                      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                        <span>Sources</span>
                        <span>{sourceSummary.length} total</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sourceSummary.slice(0, 4).map((source) => (
                          <div
                            key={source.name}
                            className="flex items-center gap-2 rounded-full border border-border/50 bg-background/40 px-3 py-1 text-[11px]"
                          >
                            <span className="text-foreground/80">{source.name}</span>
                            <span className="text-muted-foreground">{source.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                    Live coverage · {focusLabel}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-border/60 bg-[var(--news-bg-primary)]/30 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
              <span>Drag to rotate · Click to focus</span>
              <span>{focusLabel}</span>
            </div>
          </section>

          <aside className="h-full rounded-2xl border border-border/60 bg-[var(--news-bg-secondary)]/70 backdrop-blur-sm flex flex-col shadow-lg overflow-hidden">
            <div className="px-6 py-5 border-b border-border/60 bg-[var(--news-bg-primary)]/40">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-primary/80">Signal Feed</p>
                  <h3 className="font-serif text-xl font-semibold tracking-tight">Country Stream</h3>
                  <p className="text-xs text-muted-foreground mt-2">
                    Readable view of coverage for the selected focus. Scroll or use arrow keys to navigate.
                  </p>
                </div>
                <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                  {filteredArticles.length} articles
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-hidden bg-background/40 px-4 py-4">
              <div className="h-full rounded-xl border border-border/60 bg-[var(--news-bg-primary)]/50 shadow-inner overflow-hidden">
                <ScrollView articles={filteredArticles} loading={loading} />
              </div>
            </div>
          </aside>
        </div>
      </main>

      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}
