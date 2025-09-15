"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, MapPin, Info } from "lucide-react"
import { ThreeGlobe } from "./three-globe"
import { SourceInfoModal } from "./source-info-modal"
import { getArticlesByCountry, getSourceById, type NewsArticle } from "@/lib/api"

interface GlobeViewProps {
  selectedCountry: string | null
  onCountrySelect: (country: string | null) => void
}

export function GlobeView({ selectedCountry, onCountrySelect }: GlobeViewProps) {
  const [selectedNews, setSelectedNews] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadCountryNews = async () => {
      if (!selectedCountry) {
        setSelectedNews([])
        return
      }
      
      setLoading(true)
      try {
        const articles = await getArticlesByCountry(selectedCountry)
        setSelectedNews(articles)
      } catch (error) {
        console.error('Failed to load country news:', error)
        setSelectedNews([])
      } finally {
        setLoading(false)
      }
    }
    
    loadCountryNews()
  }, [selectedCountry])

  const getCredibilityColor = (credibility: string) => {
    switch (credibility) {
      case "high":
        return "default"
      case "medium":
        return "secondary"
      case "low":
        return "destructive"
      default:
        return "outline"
    }
  }

  const getBiasIndicator = (bias: string) => {
    switch (bias) {
      case "left":
        return "🔵"
      case "right":
        return "🔴"
      case "center":
        return "⚪"
      default:
        return "⚫"
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 3D Globe */}
      <div className="lg:col-span-2">
        <Card className="h-[600px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Interactive 3D News Globe
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Click on countries to view their latest political news. The globe rotates automatically.
            </p>
          </CardHeader>
          <CardContent className="h-[500px] relative">
            <ThreeGlobe selectedCountry={selectedCountry} onCountrySelect={onCountrySelect} />
          </CardContent>
        </Card>
      </div>

      {/* News Sidebar */}
      <div className="space-y-4">
        {selectedCountry ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{selectedCountry}</CardTitle>
                <p className="text-sm text-muted-foreground">Latest political news • {selectedNews.length} articles</p>
              </CardHeader>
            </Card>

            {selectedNews.map((article: NewsArticle) => {
              return (
                <Card key={article.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={getCredibilityColor(article.credibility)} className="text-xs">
                          {article.credibility} credibility
                        </Badge>
                        <span className="text-xs" title={`${article.bias} bias`}>
                          {getBiasIndicator(article.bias)}
                        </span>
                        {article.translated && (
                          <Badge variant="outline" className="text-xs">
                            Translated
                          </Badge>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </div>
                    <h3 className="font-semibold text-sm mb-2 line-clamp-2">{article.title}</h3>
                    <p className="text-xs text-muted-foreground mb-2">{article.summary}</p>
                    <div className="flex items-center justify-between">
                      <SourceInfoModal sourceId={article.sourceId}>
                        <Button variant="ghost" size="sm" className="text-xs font-medium text-primary p-0 h-auto">
                          <Info className="w-3 h-3 mr-1" />
                          {article.source}
                        </Button>
                      </SourceInfoModal>
                      {/* Source funding info removed for now - would need async handling */}
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {selectedNews.length === 0 && (
              <Card className="h-[200px] flex items-center justify-center">
                <CardContent className="text-center">
                  <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No news available for {selectedCountry}</p>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card className="h-[200px] flex items-center justify-center">
            <CardContent className="text-center">
              <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Select a country on the globe to view news</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
