"use client"

import { useEffect, useMemo, useState } from "react"
import { analyzeArticle, type ArticleAnalysis, type NewsArticle } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ExternalLink, ImageOff } from "lucide-react"

interface ArticleInlineEmbedProps {
  url: string
  onOpen: (article: NewsArticle) => void
}

function toSourceName(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace("www.", "")
  } catch {
    return "unknown"
  }
}

function buildNewsArticle(url: string, analysis?: ArticleAnalysis): NewsArticle {
  const title = analysis?.title || analysis?.summary?.slice(0, 120) || toSourceName(url)
  const summary = analysis?.summary || (analysis?.full_text ? analysis.full_text.slice(0, 220) + "…" : "")
  const source = analysis?.source_analysis?.ownership || toSourceName(url)
  return {
    id: Date.now() + Math.random(),
    title: title || "Untitled",
    source,
    sourceId: source.toLowerCase().replace(/\s+/g, "-"),
    country: "United States",
    credibility: "medium",
    bias: "center",
    summary: summary || "",
    content: analysis?.full_text || analysis?.summary,
    image: "/placeholder.svg",
    publishedAt: analysis?.publish_date || new Date().toISOString(),
    category: "general",
    url,
    tags: [],
    originalLanguage: "en",
    translated: false,
  }
}

export const ArticleInlineEmbed = ({ url, onOpen }: ArticleInlineEmbedProps) => {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState<ArticleAnalysis | null>(null)

  useEffect(() => {
    let mounted = true
    const run = async () => {
      try {
        setLoading(true)
        const res = await analyzeArticle(url)
        if (!mounted) return
        setAnalysis(res)
      } catch (e) {
        if (!mounted) return
        setAnalysis(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => { mounted = false }
  }, [url])

  const article = useMemo(() => buildNewsArticle(url, analysis || undefined), [url, analysis])

  if (loading) {
    return (
      <div className="border rounded-lg p-3 flex gap-3 items-center" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="h-16 w-24 rounded-md bg-gray-800 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 bg-gray-800 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-gray-800 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => onOpen(article)}
      className="border rounded-lg p-3 flex gap-3 items-center text-left hover:border-primary transition-colors w-full"
      style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}
    >
      <div className="h-16 w-24 overflow-hidden rounded-md bg-black/40 border" style={{ borderColor: 'var(--border)' }}>
        {analysis?.grounding_metadata?.grounding_chunks?.length ? (
          // If analysis returns images later, plug here. For now, placeholder keeps layout solid.
          <img src={"/placeholder.svg"} alt="preview" className="w-full h-full object-cover opacity-80" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <ImageOff className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{article.title}</div>
        <div className="text-xs mt-1 truncate" style={{ color: 'var(--muted-foreground)' }}>{article.source}</div>
        {article.summary && (
          <div className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>{article.summary}</div>
        )}
      </div>
      <ExternalLink className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
    </button>
  )
}
