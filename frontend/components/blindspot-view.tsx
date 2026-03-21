"use client"

// Design thesis: compress the blindspot viewer into an editorial comparison board, with one visual anchor per lane and the rest of the screen reserved for dense, scannable gaps.

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import {
  ArrowRightLeft,
  BarChart3,
  Radar,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ClusterDetailModal } from "@/components/cluster-detail-modal"
import {
  type BlindspotCard,
  type BlindspotLane,
  type BlindspotLens,
  type TrendingCluster,
  fetchBlindspotViewer,
} from "@/lib/api"
import { cn } from "@/lib/utils"

interface BlindspotViewProps {
  category?: string
  sources?: string[]
}

type SortMode = "asymmetry" | "largest" | "recent"

const DEFAULT_LENS: BlindspotLens["id"] = "bias"
const DEFAULT_WINDOW = "1w"
const CARDS_PER_LANE = 18

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "asymmetry", label: "Most asymmetric" },
  { value: "largest", label: "Largest story" },
  { value: "recent", label: "Most recent" },
]

function serializeSources(sources?: string[]): string | undefined {
  if (!sources || sources.length === 0) {
    return undefined
  }
  return [...sources].sort().join(",")
}

function formatDate(value?: string | null): string {
  if (!value) return "No timestamp"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function sortCards(cards: BlindspotCard[], sortMode: SortMode): BlindspotCard[] {
  const sorted = [...cards]
  switch (sortMode) {
    case "largest":
      return sorted.sort((left, right) => right.article_count - left.article_count)
    case "recent":
      return sorted.sort((left, right) => {
        const leftTime = left.published_at ? new Date(left.published_at).getTime() : 0
        const rightTime = right.published_at ? new Date(right.published_at).getTime() : 0
        return rightTime - leftTime
      })
    case "asymmetry":
    default:
      return sorted.sort((left, right) => right.blindspot_score - left.blindspot_score)
  }
}

function laneAccentClass(laneId: BlindspotLane["id"]): string {
  switch (laneId) {
    case "pole_a":
      return "border-cyan-400/25 bg-cyan-400/[0.05]"
    case "pole_b":
      return "border-amber-500/25 bg-amber-500/[0.06]"
    case "shared":
    default:
      return "border-white/10 bg-white/[0.025]"
  }
}

function laneBarClass(laneId: BlindspotLane["id"]): string {
  switch (laneId) {
    case "pole_a":
      return "bg-cyan-400/80"
    case "pole_b":
      return "bg-amber-500/80"
    case "shared":
    default:
      return "bg-zinc-300/70"
  }
}

function laneDirectionalGap(card: BlindspotCard, laneId: BlindspotLane["id"]): number {
  if (laneId === "pole_a") {
    return card.coverage_shares.pole_b - card.coverage_shares.pole_a
  }
  if (laneId === "pole_b") {
    return card.coverage_shares.pole_a - card.coverage_shares.pole_b
  }
  return Math.min(card.coverage_shares.pole_a, card.coverage_shares.pole_b)
}

function coverageBar(card: BlindspotCard) {
  const entries: Array<{
    key: keyof BlindspotCard["coverage_shares"]
    color: string
  }> = [
    { key: "pole_a", color: "bg-cyan-400/80" },
    { key: "shared", color: "bg-zinc-300/70" },
    { key: "pole_b", color: "bg-amber-500/80" },
  ]

  return (
    <div className="overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
      <div className="flex h-1.5 w-full">
        {entries.map(({ key, color }) => (
          <div
            key={key}
            className={color}
            style={{ width: `${Math.max(card.coverage_shares[key] * 100, 0)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function cardToCluster(card: BlindspotCard): TrendingCluster {
  return {
    cluster_id: card.cluster_id,
    label: card.cluster_label,
    keywords: card.keywords,
    article_count: card.article_count,
    window_count: card.article_count,
    source_diversity: card.source_count,
    trending_score: card.blindspot_score,
    velocity: card.balance_score,
    representative_article: card.representative_article
      ? {
          id: card.representative_article.id,
          title: card.representative_article.title,
          source: card.representative_article.source,
          url: card.representative_article.url,
          image_url: card.representative_article.image_url ?? null,
          published_at: card.representative_article.published_at ?? undefined,
          summary: card.representative_article.summary ?? undefined,
        }
      : null,
    articles: card.articles.map((article) => ({
      id: article.id,
      title: article.title,
      source: article.source,
      url: article.url,
      image_url: article.image_url ?? null,
      published_at: article.published_at ?? undefined,
      summary: article.summary ?? undefined,
    })),
  }
}

function deriveFallbackCards(
  allCards: BlindspotCard[],
  laneId: BlindspotLane["id"],
): BlindspotCard[] {
  if (laneId === "shared") {
    return []
  }

  return [...allCards]
    .filter((card) => laneDirectionalGap(card, laneId) > 0.08)
    .sort(
      (left, right) =>
        laneDirectionalGap(right, laneId) - laneDirectionalGap(left, laneId),
    )
    .slice(0, 5)
}

function LeadStory({
  card,
  laneId,
  onOpen,
}: {
  card: BlindspotCard
  laneId: BlindspotLane["id"]
  onOpen: (card: BlindspotCard) => void
}) {
  const imageUrl = card.representative_article?.image_url

  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group relative w-full overflow-hidden border border-white/10 bg-white/[0.02] text-left transition-all duration-300 hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="flex h-full flex-col sm:flex-row">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-white/[0.04] sm:aspect-square sm:w-32">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={card.cluster_label}
              className="h-full w-full object-cover opacity-60 grayscale transition duration-700 group-hover:opacity-100 group-hover:grayscale-0 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent sm:hidden" />
        </div>

        <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70">
              <span className="text-foreground/60">{card.source_count} sources</span>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <span>{formatDate(card.published_at)}</span>
            </div>

            <h3 className="font-serif text-lg leading-[1.15] text-foreground/90 transition-colors group-hover:text-white sm:text-xl">
              {card.cluster_label}
            </h3>
            
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/80">
              {card.explanation}
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {coverageBar(card)}
            <div className="flex items-center justify-between text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-cyan-400/40" />
                <span>Pole A {card.coverage_counts.pole_a}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>Pole B {card.coverage_counts.pole_b}</span>
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500/40" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}

function StoryRow({
  card,
  onOpen,
}: {
  card: BlindspotCard
  onOpen: (card: BlindspotCard) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group flex w-full items-start justify-between gap-4 border-t border-white/5 py-2.5 text-left transition-colors duration-200 hover:bg-white/[0.03]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">
          <span>{card.source_count} sources</span>
          <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
          <span>{formatDate(card.published_at)}</span>
        </div>
        <h4 className="mt-1.5 line-clamp-1 font-serif text-[15px] leading-snug text-foreground/80 transition-colors group-hover:text-white">
          {card.cluster_label}
        </h4>
      </div>
      <div className="mt-1 flex shrink-0 items-center gap-2 font-mono text-[10px] tabular-nums tracking-wider text-muted-foreground/50">
        <span className="hidden sm:inline">SCORE</span>
        <span className="text-foreground/60">{Math.round(card.blindspot_score * 10) / 10}</span>
      </div>
    </button>
  )
}

export function BlindspotView({ category, sources }: BlindspotViewProps) {
  const [selectedLens, setSelectedLens] = useState<BlindspotLens["id"]>(DEFAULT_LENS)
  const [sortMode, setSortMode] = useState<SortMode>("asymmetry")
  const [selectedCard, setSelectedCard] = useState<BlindspotCard | null>(null)

  const serializedSources = useMemo(() => serializeSources(sources), [sources])

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "blindspots",
      "viewer",
      {
        lens: selectedLens,
        category: category || "all",
        sources: serializedSources || null,
      },
    ],
    queryFn: () =>
      fetchBlindspotViewer({
        lens: selectedLens,
        window: DEFAULT_WINDOW,
        category,
        sources: serializedSources,
        perLane: CARDS_PER_LANE,
      }),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const sortedCards = useMemo(
    () => (data ? sortCards(data.cards, sortMode) : []),
    [data, sortMode],
  )

  const laneMap = useMemo(() => {
    const grouped = new Map<BlindspotLane["id"], BlindspotCard[]>()
    if (!data) {
      return grouped
    }
    for (const lane of data.lanes) {
      grouped.set(lane.id, [])
    }
    for (const card of sortedCards) {
      const cards = grouped.get(card.lane)
      if (!cards) continue
      cards.push(card)
    }
    return grouped
  }, [data, sortedCards])

  const fallbackCards = useMemo(() => {
    return {
      pole_a: deriveFallbackCards(sortedCards, "pole_a"),
      shared: [] as BlindspotCard[],
      pole_b: deriveFallbackCards(sortedCards, "pole_b"),
    }
  }, [sortedCards])

  const selectedCluster = useMemo(
    () => (selectedCard ? cardToCluster(selectedCard) : null),
    [selectedCard],
  )

  if (isLoading && !data) {
    return (
      <div className="space-y-5 p-4 lg:p-6">
        <Skeleton className="h-48 rounded-none border border-white/10 bg-white/[0.04]" />
        <div className="grid gap-4 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-[36rem] rounded-none border border-white/10 bg-white/[0.04]"
            />
          ))}
        </div>
      </div>
    )
  }

  if (error instanceof Error) {
    return (
      <div className="flex min-h-[32rem] items-center justify-center p-6">
        <div className="max-w-xl border border-white/10 bg-white/[0.04] p-8 text-left">
          <div className="flex items-center gap-3 text-foreground">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <h2 className="font-serif text-2xl">Blindspot viewer unavailable</h2>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {error.message}
          </p>
          <Button
            onClick={() => void refetch()}
            variant="outline"
            className="mt-6 rounded-none border-white/10 bg-transparent"
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <>
      <div className="flex flex-col space-y-6 p-4 lg:p-6">
        {/* Header & Controls */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col justify-between gap-4 border-b border-white/5 pb-6 lg:flex-row lg:items-end">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 text-[10px] font-mono uppercase tracking-[0.4em] text-primary/80">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Blindspot Viewer
              </div>
              <h2 className="font-serif text-3xl leading-[1.1] text-foreground lg:text-5xl">
                Coverage gaps.
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground/80">
                Detecting holes in coverage across <span className="text-foreground">{data.summary.total_clusters}</span> clusters. 
                Active lens: <span className="text-primary/90">{data.selected_lens.label.toLowerCase()}</span>.
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 lg:items-end">
              <div className="flex items-center gap-6 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/50">
                <div className="flex flex-col items-start lg:items-end">
                  <span className="text-[8px] opacity-60">Snapshot</span>
                  <span className="text-foreground/70">{data.summary.total_clusters} clusters</span>
                </div>
                <div className="flex flex-col items-start lg:items-end">
                  <span className="text-[8px] opacity-60">Window</span>
                  <span className="text-foreground/70">{data.summary.window}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 rounded-sm bg-white/[0.03] p-1 border border-white/5">
                {data.available_lenses.map((lens) => (
                  <button
                    key={lens.id}
                    type="button"
                    onClick={() => lens.available && setSelectedLens(lens.id)}
                    disabled={!lens.available}
                    className={cn(
                      "px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] transition-all duration-200",
                      selectedLens === lens.id
                        ? "bg-primary/10 text-primary shadow-[0_0_12px_rgba(0,197,255,0.15)]"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground/80",
                      !lens.available && "cursor-not-allowed opacity-30",
                    )}
                  >
                    {lens.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary/60" />
              <p className="text-xs text-muted-foreground/70 italic">
                {data.selected_lens.description}
              </p>
            </div>
            
            <div className="flex items-center gap-1.5 rounded-sm bg-white/[0.02] p-1 border border-white/5">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSortMode(option.value)}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.15em] transition-colors",
                    sortMode === option.value
                      ? "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground/70",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </motion.header>

        {!data.selected_lens.available ? (
          <div className="border border-white/10 bg-white/[0.02] p-12 text-center">
            <h3 className="font-serif text-2xl text-foreground">
              {data.selected_lens.label} is currently unavailable
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.selected_lens.unavailable_reason || "Check back soon for updated metrics."}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
            {data.lanes.map((lane, index) => {
              const cards = laneMap.get(lane.id) ?? []
              const fallback = cards.length === 0 ? fallbackCards[lane.id] : []
              const visibleCards = cards.length > 0 ? cards : fallback
              const leadCard = visibleCards[0]
              const listCards = visibleCards.slice(1)
              const usingFallback = cards.length === 0 && fallback.length > 0

              return (
                <motion.section
                  key={lane.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut", delay: index * 0.1 }}
                  className="flex flex-col space-y-5"
                >
                  <div className="relative border-b border-white/10 pb-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-2xl text-foreground/90">
                        {lane.label}
                      </h3>
                      <div className={cn("h-4 w-1", laneBarClass(lane.id))} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5 text-[9px] font-mono uppercase tracking-[0.25em] text-muted-foreground/60">
                      <span>{lane.cluster_count} Clusters</span>
                      {usingFallback && (
                        <span className="text-amber-500/60 font-bold uppercase tracking-widest">[GAP DETECTED]</span>
                      )}
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground/70 line-clamp-2">
                      {usingFallback
                        ? "Showing clusters near the blindspot threshold."
                        : lane.description}
                    </p>
                  </div>

                  <div className="flex flex-col space-y-4">
                    {leadCard ? (
                      <>
                        <LeadStory card={leadCard} laneId={lane.id} onOpen={setSelectedCard} />
                        
                        {listCards.length > 0 && (
                          <div className="space-y-1">
                            <div className="mb-2 flex items-center gap-2">
                              <div className="h-px flex-1 bg-white/5" />
                              <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">Secondary Stream</span>
                              <div className="h-px flex-1 bg-white/5" />
                            </div>
                            <div className="max-h-[32rem] overflow-y-auto pr-2">
                              {listCards.map((card) => (
                                <StoryRow
                                  key={`${lane.id}-${card.cluster_id}`}
                                  card={card}
                                  onOpen={setSelectedCard}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="border border-dashed border-white/5 bg-white/[0.01] p-8 text-center text-xs text-muted-foreground/50">
                        No active clusters in this lane.
                      </div>
                    )}
                  </div>
                </motion.section>
              )
            })}
          </div>
        )}
      </div>

      <ClusterDetailModal
        cluster={selectedCluster}
        isBreaking={false}
        isOpen={selectedCluster !== null}
        onClose={() => setSelectedCard(null)}
      />
    </>
  )
}
