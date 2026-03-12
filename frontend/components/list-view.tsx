"use client"

import { NewsArticle } from "@/lib/api"
import { useMemo, useState } from "react"
import { ArticleDetailModal } from "./article-detail-modal"
import { motion, AnimatePresence } from "framer-motion"
import {
  Clock,
  ArrowUpDown,
  ChevronDown,
  ArrowRight,
  Loader2,
  Newspaper,
} from "lucide-react"

interface ListViewProps {
  articles: NewsArticle[]
  loading: boolean
  totalCount?: number
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
}

const sortOptions = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "source", label: "Publisher" },
  { value: "credibility", label: "Credibility" },
  { value: "title", label: "Headline" },
  { value: "left", label: "Left Leaning" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right Leaning" },
] as const

export function ListView({
  articles,
  loading,
  totalCount,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
}: ListViewProps) {
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null)
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false)
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "source" | "credibility" | "title" | "left" | "center" | "right">("newest")
  const [isSortOpen, setIsSortOpen] = useState(false)

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
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="flex h-full w-full items-center justify-center bg-background p-12"
      >
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-border/30 bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
            </div>
          </div>
          <span className="text-sm font-medium text-muted-foreground">Curating stories...</span>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-20 border-b border-border/40 bg-background/80 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between px-6 py-5 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <Newspaper className="h-4 w-4 text-primary/70" />
              <h2 className="font-serif text-xl font-medium text-foreground">All Stories</h2>
            </div>
            <div className="h-5 w-px bg-border/50" />
            <span className="text-sm text-muted-foreground">
              {articles.length}
              {typeof totalCount === "number" && totalCount > articles.length && (
                <span className="text-muted-foreground/60"> of {totalCount}</span>
              )}
            </span>
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsSortOpen(!isSortOpen)}
              className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-foreground transition-all duration-300 hover:border-primary/40 hover:bg-primary/10"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-primary/70" />
              <span>{sortOptions.find((o) => o.value === sortBy)?.label}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-primary/70 transition-transform duration-300 ease-[0.16,1,0.3,1] ${isSortOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {isSortOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-primary/20 bg-card/95 p-1 shadow-lg backdrop-blur-xl"
                >
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSortBy(option.value as typeof sortBy)
                        setIsSortOpen(false)
                      }}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-200 ${
                        sortBy === option.value
                          ? "bg-primary/15 font-medium text-primary"
                          : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* Article List */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {sortedArticles.map((article, index) => (
            <motion.article
              key={article.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{
                duration: 0.6,
                delay: Math.min(index * 0.04, 0.4),
                ease: [0.16, 1, 0.3, 1],
              }}
              onClick={() => {
                setSelectedArticle(article)
                setIsArticleModalOpen(true)
              }}
              className="group relative cursor-pointer border-b border-border/20 px-6 py-6 transition-colors duration-500 hover:bg-primary/5 lg:px-8"
            >
              <div className="flex items-start gap-6">
                {/* Date Column */}
                <div className="hidden w-24 shrink-0 flex-col gap-1 sm:flex">
                  <span className="text-sm font-medium text-foreground/80">
                    {new Date(article.publishedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                    <Clock className="h-3 w-3" />
                    {new Date(article.publishedAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary/80">
                      {article.source}
                    </span>
                    <span className="text-xs text-muted-foreground/60 sm:hidden">
                      {new Date(article.publishedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    {article.category && (
                      <span className="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {article.category}
                      </span>
                    )}
                  </div>

                  <h3 className="font-serif text-lg font-medium leading-snug text-foreground/90 transition-colors duration-300 group-hover:text-primary md:text-xl">
                    {article.title}
                  </h3>

                  {article.summary && (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground/80">
                      {article.summary}
                    </p>
                  )}

                  {/* Meta Row */}
                  <div className="mt-3 flex items-center gap-4">
                    {/* Credibility */}
                    {article.credibility && (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {[1, 2, 3].map((level) => {
                            const score =
                              article.credibility === "high"
                                ? 3
                                : article.credibility === "medium"
                                  ? 2
                                  : 1
                            const isActive = level <= score
                            return (
                              <div
                                key={level}
                                className={`h-1.5 w-3 rounded-sm transition-colors duration-300 ${
                                  isActive
                                    ? article.credibility === "high"
                                      ? "bg-emerald-500"
                                      : article.credibility === "medium"
                                        ? "bg-amber-500"
                                        : "bg-rose-500"
                                    : "bg-border"
                                }`}
                              />
                            )
                          })}
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                          {article.credibility}
                        </span>
                      </div>
                    )}

                    {/* Bias */}
                    {article.bias && (
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            article.bias === "left"
                              ? "bg-blue-500"
                              : article.bias === "right"
                                ? "bg-rose-500"
                                : "bg-purple-500"
                          }`}
                        />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                          {article.bias}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <div className="hidden shrink-0 items-center sm:flex">
                  <ArrowRight className="h-5 w-5 text-muted-foreground/30 transition-all duration-500 group-hover:translate-x-1 group-hover:text-primary" />
                </div>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>

      {/* Empty State */}
      {sortedArticles.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center"
        >
          <div className="flex max-w-md flex-col items-center rounded-2xl border border-border/40 bg-card/30 p-10 backdrop-blur-sm">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Newspaper className="h-8 w-8 text-primary/60" />
            </div>
            <h3 className="mb-3 font-serif text-2xl font-medium text-foreground">No signals detected</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Try adjusting your filters or sort order to discover more editorial content.
            </p>
          </div>
        </motion.div>
      )}

      {/* Load More */}
      {hasNextPage && (
        <div className="flex justify-center border-t border-border/40 p-6">
          <button
            type="button"
            onClick={() => fetchNextPage?.()}
            disabled={isFetchingNextPage}
            className="group flex items-center gap-3 rounded-full border border-primary/20 bg-primary/5 px-8 py-3 text-sm font-medium text-foreground transition-all duration-500 hover:border-primary/40 hover:bg-primary/10 disabled:opacity-50"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                <span>Load More Stories</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-500 ease-[0.16,1,0.3,1] group-hover:translate-x-1" />
              </>
            )}
          </button>
        </div>
      )}

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
