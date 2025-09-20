"use client"

import { useState } from "react"
import { ThreeGlobe } from "./three-globe"
import { SourceInfoModal } from "./source-info-modal"
import { ScrollView } from "./scroll-view"
import { ArticleDetailModal } from "./article-detail-modal"
import { NewsArticle } from "@/lib/api"

interface GlobeViewProps {
  articles: NewsArticle[]
  loading: boolean
}

export function GlobeView({ articles, loading }: GlobeViewProps) {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)

  const handleCountrySelect = (country: string | null) => {
    setSelectedCountry(country)
  }

  const handleArticleSelect = (article: any) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  // Filter articles by selected country if one is selected
  const filteredArticles = selectedCountry
    ? articles.filter((article) => article.country === selectedCountry)
    : articles

  return (
    <div className="h-[calc(100vh-150px)] w-full bg-background text-foreground">
      <main className="h-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 h-full">
          <div className="md:col-span-2 h-full rounded-lg border overflow-hidden">
            <ThreeGlobe onCountrySelect={handleCountrySelect} selectedCountry={selectedCountry} />
          </div>
          <div className="h-full rounded-lg border">
            <ScrollView articles={filteredArticles} loading={loading} />
          </div>
        </div>
      </main>

      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}
