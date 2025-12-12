"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fetchNewsForCountry, fetchCountryGeoData } from "@/lib/api"
import type { NewsArticle } from "@/lib/api"

interface LocalLensViewProps {
    countryCode: string
    onClose?: () => void
}

export function LocalLensView({ countryCode, onClose }: LocalLensViewProps) {
    const [view, setView] = useState<"internal" | "external">("internal")
    const [offset, setOffset] = useState(0)
    const limit = 20

    // Get country name from geo data
    const { data: geoData } = useQuery({
        queryKey: ["country-geo"],
        queryFn: fetchCountryGeoData,
        staleTime: Infinity,
    })

    const countryName = geoData?.countries[countryCode]?.name || countryCode

    // Fetch news for the selected view
    const { data, isLoading, isFetching } = useQuery({
        queryKey: ["local-lens", countryCode, view, offset],
        queryFn: () => fetchNewsForCountry(countryCode, view, limit, offset),
    })

    const handleLoadMore = () => {
        if (data?.has_more) {
            setOffset((prev) => prev + limit)
        }
    }

    const handleViewChange = (newView: string) => {
        setView(newView as "internal" | "external")
        setOffset(0)
    }

    return (
        <Card className="w-full max-w-4xl">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl flex items-center gap-2">
                            <span className="text-2xl">{getCountryFlag(countryCode)}</span>
                            {countryName}
                        </CardTitle>
                        <CardDescription>
                            {data?.total || 0} articles in {view === "internal" ? "internal" : "external"} view
                        </CardDescription>
                    </div>
                    {onClose && (
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            Close
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <Tabs value={view} onValueChange={handleViewChange}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="internal">
                            What {countryName} says
                        </TabsTrigger>
                        <TabsTrigger value="external">
                            Coverage from abroad
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value={view} className="mt-4">
                        <p className="text-sm text-muted-foreground mb-4">
                            {data?.view_description}
                        </p>

                        {isLoading ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {data?.articles?.map((article: NewsArticle) => (
                                    <ArticleCard key={article.id} article={article} />
                                ))}

                                {data?.articles?.length === 0 && (
                                    <p className="text-center py-8 text-muted-foreground">
                                        No articles found for this view.
                                    </p>
                                )}

                                {data?.has_more && (
                                    <div className="flex justify-center pt-4">
                                        <Button
                                            variant="outline"
                                            onClick={handleLoadMore}
                                            disabled={isFetching}
                                        >
                                            {isFetching ? "Loading..." : "Load More"}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    )
}

// Simple article card for the Local Lens view
function ArticleCard({ article }: { article: NewsArticle }) {
    return (
        <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-3 rounded-lg border hover:bg-muted/50 transition-colors"
        >
            <div className="flex gap-3">
                {article.image && (
                    <img
                        src={article.image}
                        alt=""
                        className="w-20 h-14 object-cover rounded flex-shrink-0"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none"
                        }}
                    />
                )}
                <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm line-clamp-2">{article.title}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{article.source}</span>
                        <span>|</span>
                        <span>{formatDate(article.publishedAt)}</span>
                    </div>
                </div>
            </div>
        </a>
    )
}

// Helper to get country flag emoji from ISO code
function getCountryFlag(code: string): string {
    if (code === "International" || code.length !== 2) return "globe"
    const codePoints = code
        .toUpperCase()
        .split("")
        .map((char) => 127397 + char.charCodeAt(0))
    return String.fromCodePoint(...codePoints)
}

// Helper to format date
function formatDate(dateStr: string): string {
    try {
        const date = new Date(dateStr)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

        if (diffHours < 1) return "Just now"
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffHours < 48) return "Yesterday"

        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        })
    } catch {
        return dateStr
    }
}
