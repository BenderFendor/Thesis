"use client"

import { useState, useMemo } from "react"
import { InteractiveGlobe } from "./interactive-globe"
import { ArticleDetailModal } from "./article-detail-modal"
import { NewsArticle } from "@/lib/api"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { 
  AlertCircle,
  ExternalLink,
  MapPin,
  Signal,
  X,
  ShieldCheck,
  Newspaper,
  LayoutDashboard,
  Radio,
  BookOpen
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

interface GlobeViewProps {
  articles: NewsArticle[]
  loading: boolean
}

export function GlobeView({ articles, loading }: GlobeViewProps) {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'internal' | 'external'>('internal')
  const [sidebarTab, setSidebarTab] = useState("briefing")

  const handleCountrySelect = (country: string | null, name?: string | null) => {
    setSelectedCountry(country)
    setSelectedCountryName(name || null)
    setViewMode('internal')
    setSidebarTab("briefing")
  }

  const handleArticleSelect = (article: NewsArticle) => {
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

  const hasRealImage = (src?: string | null) => {
    if (!src) return false
    const trimmed = src.trim()
    if (!trimmed) return false
    const lower = trimmed.toLowerCase()
    return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg")
  }

  const verificationStats = useMemo(() => {
    const total = filteredArticles.length
    if (total === 0) return { high: 0, medium: 0, low: 0, highPct: 0 }
    const high = filteredArticles.filter(a => a.credibility === 'high').length
    return {
      highPct: Math.round((high / total) * 100)
    }
  }, [filteredArticles])

  const focusLabel = selectedCountryName || "Global Focus"
  const leadArticle = filteredArticles[0]
  const topSources = sourceSummary.slice(0, 5)

  return (
    <div className="relative h-[calc(100vh-60px)] w-full overflow-hidden bg-[var(--news-bg-primary)] flex">
      {/* Main Globe Area */}
      <div className="flex-1 relative z-0">
        <InteractiveGlobe 
          articles={articles} 
          onCountrySelect={handleCountrySelect} 
          selectedCountry={selectedCountry} 
        />
        
        {/* Top Left Overlay: Breadcrumbs / Status */}
        <div className="absolute top-8 left-8 z-10 pointer-events-none">
          <div className="space-y-2 pointer-events-auto">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded-sm border font-mono text-[9px] uppercase tracking-[0.2em] bg-primary/10 text-primary border-primary/20">
                Live Signal
              </span>
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                {filteredArticles.length} Articles
              </span>
            </div>
            <h2 className="font-serif text-5xl font-semibold tracking-tight text-foreground drop-shadow-md">
              {focusLabel}
            </h2>
            {selectedCountry && (
              <button 
                onClick={() => handleCountrySelect(null)}
                className="group flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground hover:text-primary transition-colors"
              >
                <X size={12} className="group-hover:rotate-90 transition-transform" />
                Reset Focus
              </button>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-8 left-8 z-10">
          <div className="px-4 py-3 rounded-lg border border-border/60 bg-[var(--news-bg-secondary)]/80 backdrop-blur-md shadow-xl flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/80">Active Pulse</span>
            </div>
            <div className="h-4 w-px bg-border/60" />
            <div className="flex items-center gap-3">
               <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Intensity</span>
               <div className="flex gap-1">
                 <div className="w-3 h-1.5 rounded-sm bg-primary/20" />
                 <div className="w-3 h-1.5 rounded-sm bg-primary/40" />
                 <div className="w-3 h-1.5 rounded-sm bg-primary/60" />
                 <div className="w-3 h-1.5 rounded-sm bg-primary/80" />
                 <div className="w-3 h-1.5 rounded-sm bg-primary" />
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Persistent Right Sidebar */}
      <div className="w-[420px] shrink-0 border-l border-border/60 bg-[var(--news-bg-secondary)]/95 backdrop-blur-xl flex flex-col z-50 shadow-2xl relative">
        <div className="p-4 border-b border-border/60 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Focus</p>
              <h3 className="font-serif text-2xl text-foreground">{focusLabel}</h3>
              <p className="text-xs text-muted-foreground">
                {filteredArticles.length} articles · {sourceSummary.length} sources
              </p>
            </div>
            {selectedCountry && (
              <Button variant="outline" size="sm" onClick={() => handleCountrySelect(null)}>
                Reset
              </Button>
            )}
          </div>
          {topSources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {topSources.map((source) => (
                <Badge key={source.name} variant="outline" className="text-[10px] uppercase tracking-wide">
                  {source.name} · {source.count}
                </Badge>
              ))}
            </div>
          )}
          <Tabs value={sidebarTab} onValueChange={setSidebarTab} className="w-full">
            <TabsList className="w-full grid grid-cols-3 bg-black/20 p-1">
              <TabsTrigger value="briefing" className="text-[10px] uppercase tracking-widest">Briefing</TabsTrigger>
              <TabsTrigger value="intelligence" className="text-[10px] uppercase tracking-widest">Intel</TabsTrigger>
              <TabsTrigger value="sources" className="text-[10px] uppercase tracking-widest">Sources</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-hidden relative">
          
          {/* --- BRIEFING TAB --- */}
          {sidebarTab === 'briefing' && (
            <div className="h-full flex flex-col">
              <div className="px-4 py-3 border-b border-border/60 bg-[var(--news-bg-primary)]/30">
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full">
                  <TabsList className="w-full bg-transparent border border-border/40 h-8 p-0">
                    <TabsTrigger value="internal" className="flex-1 text-[9px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary h-full rounded-none border-r border-border/40">
                      Local Signal
                    </TabsTrigger>
                    <TabsTrigger value="external" className="flex-1 text-[9px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary h-full rounded-none">
                      Global View
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                {filteredArticles.length > 0 ? (
                  filteredArticles.map((article) => (
                    <div 
                      key={article.id}
                      onClick={() => handleArticleSelect(article)}
                      className="group p-4 rounded-lg border border-border/40 bg-[var(--news-bg-primary)]/40 hover:bg-[var(--news-bg-primary)] hover:border-primary/40 transition-all cursor-pointer"
                    >
                      <div className="flex justify-between items-start gap-3">
                         <div className="flex-1">
                           <div className="flex items-center gap-2 mb-2">
                             <Badge variant="outline" className="text-[8px] uppercase tracking-wider py-0 h-4 border-border/60 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary">
                               {article.source}
                             </Badge>
                             <span className="text-[9px] text-muted-foreground">{new Date(article.publishedAt).toLocaleDateString()}</span>
                           </div>
                           <h4 className="font-serif text-sm font-medium leading-snug group-hover:text-primary transition-colors">
                             {article.title}
                           </h4>
                           <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                             {article.summary}
                           </p>
                         </div>
                         {hasRealImage(article.image) && (
                           <div className="w-16 h-16 shrink-0 rounded bg-muted overflow-hidden">
                             <img src={article.image} alt="" className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                           </div>
                         )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Radio className="w-8 h-8 mb-3 opacity-20" />
                    <p className="text-xs uppercase tracking-widest">No articles found</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* --- INTELLIGENCE TAB --- */}
          {sidebarTab === 'intelligence' && (
             <div className="h-full overflow-y-auto custom-scrollbar p-4 space-y-6">
                
                {/* Lead Story Card */}
                <div className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/40 overflow-hidden">
                  <div className="p-3 border-b border-border/60 flex items-center gap-2 bg-black/20">
                    <Newspaper size={14} className="text-primary" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Spotlight Story</span>
                  </div>
                  {leadArticle ? (
                    <div className="p-4">
                       {hasRealImage(leadArticle.image) && (
                         <div className="relative aspect-video w-full overflow-hidden rounded border border-border/40 mb-3">
                           <img src={leadArticle.image} className="object-cover w-full h-full opacity-80" alt="Lead" />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                           <div className="absolute bottom-2 left-2 right-2">
                             <h4 className="font-serif text-sm font-medium text-white leading-tight drop-shadow-md">
                               {leadArticle.title}
                             </h4>
                           </div>
                         </div>
                       )}
                       <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                         {leadArticle.summary}
                       </p>
                       <Button size="sm" variant="outline" className="w-full text-xs h-8 border-border/60" onClick={() => handleArticleSelect(leadArticle)}>
                         Read Analysis
                       </Button>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      No lead story available
                    </div>
                  )}
                </div>

                {/* Verification Stats */}
                <div className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/40 overflow-hidden">
                  <div className="p-3 border-b border-border/60 flex items-center gap-2 bg-black/20">
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Verification Signal</span>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="flex items-end justify-between">
                      <div className="text-3xl font-bold text-primary">{verificationStats.highPct}%</div>
                      <div className="text-[10px] text-muted-foreground text-right mb-1">
                        High Credibility<br/>Sources
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
                        style={{ width: `${verificationStats.highPct}%` }} 
                      />
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      Based on analysis of {filteredArticles.length} articles from {sourceSummary.length} detected sources in this region.
                    </div>
                  </div>
                </div>

                {/* Desk Summary Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded border border-border/60 bg-[var(--news-bg-primary)]/40 text-center">
                    <div className="text-xl font-bold">{filteredArticles.length}</div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">Total Briefs</div>
                  </div>
                  <div className="p-3 rounded border border-border/60 bg-[var(--news-bg-primary)]/40 text-center">
                    <div className="text-xl font-bold">{sourceSummary.length}</div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">Active Feeds</div>
                  </div>
                </div>

             </div>
          )}

          {/* --- SOURCES TAB --- */}
          {sidebarTab === 'sources' && (
            <div className="h-full overflow-y-auto custom-scrollbar p-4">
               <div className="space-y-2">
                 {sourceSummary.map((source) => (
                   <div key={source.name} className="flex items-center justify-between p-3 rounded border border-border/40 bg-[var(--news-bg-primary)]/40 hover:border-primary/40 transition-colors">
                     <div className="flex items-center gap-3">
                       <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary">
                         <Signal size={14} />
                       </div>
                       <div>
                         <div className="text-sm font-medium">{source.name}</div>
                         <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Verified Source</div>
                       </div>
                     </div>
                     <Badge variant="secondary" className="bg-black/20 text-muted-foreground border-0">{source.count}</Badge>
                   </div>
                 ))}
               </div>
            </div>
          )}

        </div>
      </div>

      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}
