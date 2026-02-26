"use client"

import { NewsArticle } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { useMemo, useState } from "react"
import { ArticleDetailModal } from "./article-detail-modal"

interface ListViewProps {
  articles: NewsArticle[]
  loading: boolean
}

export function ListView({ articles, loading }: ListViewProps) {
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "source" | "credibility" | "title" | "left" | "center" | "right">("newest")

  const sortedArticles = useMemo(() => {
    const sorted = [...articles]
    const byDateDesc = (a: NewsArticle, b: NewsArticle) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    const byDateAsc = (a: NewsArticle, b: NewsArticle) =>
      new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
    const credibilityRank = (value?: string) => {
      switch ((value || "").toLowerCase()) {
        case "high":
          return 0
        case "medium":
          return 1
        case "low":
          return 2
        default:
          return 3
      }
    }
    const biasRank = (value?: string) => {
      switch ((value || "").toLowerCase()) {
        case "left":
          return 0
        case "center-left":
          return 1
        case "center":
          return 2
        case "center-right":
          return 3
        case "right":
          return 4
        default:
          return 5
      }
    }

    switch (sortBy) {
      case "oldest":
        return sorted.sort(byDateAsc)
      case "source":
        return sorted.sort((a, b) => {
          const sourceSort = (a.source || "").localeCompare(b.source || "")
          return sourceSort || byDateDesc(a, b)
        })
      case "credibility":
        return sorted.sort((a, b) => {
          const rankSort = credibilityRank(a.credibility) - credibilityRank(b.credibility)
          return rankSort || byDateDesc(a, b)
        })
      case "title":
        return sorted.sort((a, b) => {
          const titleSort = (a.title || "").localeCompare(b.title || "")
          return titleSort || byDateDesc(a, b)
        })
      case "left":
        return sorted.filter((a) => (a.bias || "").toLowerCase().includes("left"))
      case "center":
        return sorted.filter((a) => (a.bias || "").toLowerCase().includes("center"))
      case "right":
        return sorted.filter((a) => (a.bias || "").toLowerCase().includes("right"))
      case "newest":
      default:
        return sorted.sort(byDateDesc)
    }
  }, [articles, sortBy])

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="w-full bg-[var(--news-bg-primary)] overflow-y-auto p-6 lg:p-12">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8 border-b border-white/10 pb-6">
        <div>
          <h2 className="font-serif text-2xl text-foreground mb-2">Records</h2>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
            Live records • {articles.length} entries
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
          <span>Sort</span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            className="border border-white/10 bg-[var(--news-bg-secondary)] px-2 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-foreground"
            aria-label="Sort records"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="source">Source</option>
            <option value="credibility">Credibility</option>
            <option value="title">Headline</option>
            <option value="left">Bias: Left</option>
            <option value="center">Bias: Center</option>
            <option value="right">Bias: Right</option>
          </select>
        </div>
      </div>

      <div className="w-full">
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 py-3 border-b border-white/10 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          <div className="col-span-2">Date</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-6">Headline</div>
          <div className="col-span-2 text-right">Status</div>
        </div>

        {/* Rows */}
        {sortedArticles.map((article) => (
          <div
            key={article.id}
            onClick={() => {
              setSelectedArticle(article)
              setIsArticleModalOpen(true)
            }}
            className="grid grid-cols-12 gap-4 py-4 border-b border-white/10 text-sm hover:bg-[var(--news-bg-secondary)] hover:text-foreground transition-[transform,background-color,border-color] duration-300 cursor-pointer group items-center"
          >
            <div className="col-span-2 font-mono text-xs text-muted-foreground/70 group-hover:text-foreground/80">
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}
            </div>
            <div className="col-span-2 font-mono text-xs text-primary/80 truncate">
              {article.source}
            </div>
            <div className="col-span-6 flex flex-col gap-1">
              <div className="font-medium text-foreground/90 group-hover:translate-x-1 transition-transform text-base font-serif line-clamp-1">
                {article.title}
              </div>
              {article.summary && (
                <div className="text-xs text-muted-foreground line-clamp-2 max-h-0 opacity-0 transition-all duration-300 group-hover:max-h-12 group-hover:opacity-100">
                  {article.summary}
                </div>
              )}
            </div>
            <div className="col-span-2 text-right flex justify-end gap-2">
              {article.credibility && (
                <Badge
                  variant="outline"
                  className="text-[9px] uppercase font-mono border-white/10 bg-white/5 text-foreground/70"
                >
                  {article.credibility}
                </Badge>
              )}
              {article.category && (
                <Badge
                  variant="outline"
                  className="text-[9px] uppercase font-mono border-white/10 bg-white/5 text-foreground/60"
                >
                  {article.category}
                </Badge>
              )}
            </div>
          </div>
        ))}

        {sortedArticles.length === 0 && (
          <div className="py-12 text-center text-muted-foreground font-mono text-xs uppercase tracking-widest">
            No records found
          </div>
        )}
      </div>

      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => {
          setIsArticleModalOpen(false)
          setSelectedArticle(null)
        }}
      />
    </div>
  )
}
