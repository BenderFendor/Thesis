"use client"

import { useState } from "react"
import { ThreeGlobe } from "./three-globe"
import { SourceInfoModal, SourceInfoModalProps } from "./source-info-modal"
import { newsData } from "@/lib/news-data"
import { ScrollView } from "./scroll-view"
import { ArticleDetailModal } from "./article-detail-modal"

export function GlobeView() {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null)
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)

  const handleCountrySelect = (country: string | null) => {
    setSelectedCountry(country)
  }

  const handleArticleSelect = (article: any) => {
    setSelectedArticle(article)
    setIsArticleModalOpen(true)
  }

  const articles = selectedCountry
    ? newsData.filter((article) => article.country === selectedCountry)
    : newsData

  return (
    <div className="h-[calc(100vh-150px)] w-full bg-background text-foreground">
      <main className="h-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 h-full">
          <div className="md:col-span-2 h-full rounded-lg border overflow-hidden">
            <ThreeGlobe onCountrySelect={handleCountrySelect} selectedCountry={selectedCountry} />
          </div>
          <div className="h-full rounded-lg border">
            <ScrollView
              articles={articles}
              onArticleSelect={handleArticleSelect}
              onSourceClick={() => setIsSourceModalOpen(true)}
            />
          </div>
        </div>
      </main>

      <SourceInfoModal isOpen={isSourceModalOpen} onClose={() => setIsSourceModalOpen(false)} />
      <ArticleDetailModal isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} article={selectedArticle} />
    </div>
  )
}
