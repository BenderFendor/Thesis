"use client"

import { NewsArticle } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, FileText } from "lucide-react"
import { useState } from "react"
import { ArticleDetailModal } from "./article-detail-modal"

interface ListViewProps {
  articles: NewsArticle[]
  loading: boolean
}

export function ListView({ articles, loading }: ListViewProps) {
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="w-full bg-[var(--news-bg-primary)] overflow-y-auto p-6 lg:p-12">
      <div className="flex justify-between items-end mb-8 border-b border-border/60 pb-6">
        <div>
          <h2 className="font-serif text-3xl text-foreground mb-2">The Feed Index</h2>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
            Live records • {articles.length} entries
          </p>
        </div>
      </div>

      <div className="w-full">
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 py-3 border-b border-border/60 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          <div className="col-span-2">Date</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-6">Headline</div>
          <div className="col-span-2 text-right">Status</div>
        </div>

        {/* Rows */}
        {articles.map((article) => (
          <div
            key={article.id}
            onClick={() => {
              setSelectedArticle(article)
              setIsArticleModalOpen(true)
            }}
            className="grid grid-cols-12 gap-4 py-4 border-b border-border/40 text-sm hover:bg-[var(--news-bg-secondary)] hover:text-foreground transition-colors cursor-pointer group items-center"
          >
            <div className="col-span-2 font-mono text-xs text-muted-foreground group-hover:text-foreground/80">
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}
            </div>
            <div className="col-span-2 font-mono text-xs text-primary/80 truncate">
              {article.source}
            </div>
            <div className="col-span-6 font-medium text-foreground/90 group-hover:translate-x-1 transition-transform line-clamp-1 font-serif">
              {article.title}
            </div>
            <div className="col-span-2 text-right flex justify-end gap-2">
              {article.credibility && (
                <Badge
                  variant="outline"
                  className={`text-[9px] uppercase font-mono border-border/60 ${
                    article.credibility === "high"
                      ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5"
                      : article.credibility === "low"
                      ? "text-rose-500 border-rose-500/20 bg-rose-500/5"
                      : "text-amber-500 border-amber-500/20 bg-amber-500/5"
                  }`}
                >
                  {article.credibility}
                </Badge>
              )}
            </div>
          </div>
        ))}

        {articles.length === 0 && (
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
