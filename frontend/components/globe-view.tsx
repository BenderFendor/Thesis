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
          <div className="h-full rounded-lg border flex flex-col">
            {selectedCountry ? (
                <div className="p-4 border-b bg-muted/30">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <span className="text-2xl">
                                {getFlagEmoji(selectedCountry)}
                            </span>
                            {selectedCountryName || selectedCountry}
                        </h2>
                        <button onClick={() => handleCountrySelect(null)} className="text-xs text-muted-foreground hover:text-foreground">
                            Close
                        </button>
                    </div>
                    
                    <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="w-full">
                        <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="internal">Local Sources</TabsTrigger>
                            <TabsTrigger value="external">Global View</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    
                    <div className="mt-2 text-xs text-muted-foreground">
                        {viewMode === 'internal' 
                            ? `Showing articles from ${selectedCountryName} sources`
                            : `Showing articles about ${selectedCountryName} from other countries`
                        }
                    </div>
                </div>
            ) : (
                <div className="p-4 border-b bg-muted/30">
                    <h2 className="text-xl font-bold">Global Feed</h2>
                    <p className="text-sm text-muted-foreground">Select a country on the globe to filter</p>
                </div>
            )}
            
            <div className="flex-1 overflow-hidden">
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
