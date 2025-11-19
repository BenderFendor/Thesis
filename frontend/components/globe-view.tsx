"use client"

import { useState, useMemo } from "react"
import { InteractiveGlobe } from "./interactive-globe"
import { SourceInfoModal } from "./source-info-modal"
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

  return (
    <div className="h-[calc(100vh-150px)] w-full bg-background text-foreground">
      <main className="h-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 h-full">
          <div className="md:col-span-2 h-full rounded-lg border overflow-hidden relative">
            <InteractiveGlobe articles={articles} onCountrySelect={handleCountrySelect} selectedCountry={selectedCountry} />
          </div>
          <div className="h-full rounded-xl border bg-card/50 backdrop-blur-sm flex flex-col shadow-lg overflow-hidden">
            {selectedCountry ? (
                <div className="p-6 border-b bg-gradient-to-r from-primary/10 to-transparent">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-2xl font-bold flex items-center gap-3">
                            <span className="text-4xl shadow-sm">
                                {getFlagEmoji(selectedCountry)}
                            </span>
                            <span className="tracking-tight">{selectedCountryName || selectedCountry}</span>
                        </h2>
                        <button 
                            onClick={() => handleCountrySelect(null)} 
                            className="text-xs font-medium text-muted-foreground hover:text-foreground bg-background/50 px-3 py-1.5 rounded-full transition-colors"
                        >
                            Close
                        </button>
                    </div>
                    
                    <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full">
                        <TabsList className="w-full grid grid-cols-2 bg-background/50 p-1">
                            <TabsTrigger value="internal" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Local Sources</TabsTrigger>
                            <TabsTrigger value="external" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Global View</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    
                    <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                        {viewMode === 'internal' 
                            ? `Showing articles from ${selectedCountryName} sources`
                            : `Showing articles about ${selectedCountryName} from other countries`
                        }
                    </div>
                </div>
            ) : (
                <div className="p-8 border-b bg-gradient-to-br from-muted/50 to-transparent flex flex-col items-center justify-center text-center h-48">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                    </div>
                    <h2 className="text-xl font-bold mb-2">Global Feed</h2>
                    <p className="text-sm text-muted-foreground max-w-[200px]">Select a country on the globe to filter news by region</p>
                </div>
            )}
            
            <div className="flex-1 overflow-hidden bg-background/30">
                <ScrollView articles={filteredArticles} loading={loading} />
            </div>
          </div>
        </div>
      </main>

      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}

function getFlagEmoji(countryCode: string) {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char =>  127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
