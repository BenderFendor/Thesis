"use client"

// Design thesis: Refactor the Blindspot View into a dynamic 2-column layout focusing on asymmetric coverage gaps.
// Adaptive labeling handles Bias (Left/Right), Credibility, and other lenses while following the borderless "Scoop" aesthetic.

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { RefreshCcw, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ClusterDetailModal } from "@/components/cluster-detail-modal"
import { SafeImage } from "@/components/safe-image"
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

function coverageBar(card: BlindspotCard) {
  const entries: Array<{
    key: keyof BlindspotCard["coverage_shares"]
    color: string
  }> = [
    { key: "pole_a", color: "bg-cyan-400/80" },
    { key: "shared", color: "bg-zinc-300/70" },
    { key: "pole_b", color: "bg-red-500/80" },
  ]

  return (
    <div className="overflow-hidden rounded-full border border-white/5 bg-white/[0.04]">
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

function geographySignalBadges(card: BlindspotCard) {
  if (!card.geography_signals || card.geography_signals.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {card.geography_signals.map((signal) => (
        <Badge
          key={signal.id}
          variant="outline"
          className="rounded-full border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          {signal.label} · {signal.count}
        </Badge>
      ))}
    </div>
  )
}

function LeadStory({
  card,
  laneId,
  poleLabels,
  onOpen,
}: {
  card: BlindspotCard
  laneId: BlindspotLane["id"]
  poleLabels: { pole_a: string; pole_b: string }
  onOpen: (card: BlindspotCard) => void
}) {
  const imageUrl = card.representative_article?.image_url
  const isLackingPoleA = laneId === "pole_b"
  const isLackingPoleB = laneId === "pole_a"
  
  const blindspotLabel = isLackingPoleA ? `Missed by ${poleLabels.pole_a}` : isLackingPoleB ? `Missed by ${poleLabels.pole_b}` : "Asymmetric"
  const blindspotValue = isLackingPoleA 
    ? Math.round(card.coverage_shares.pole_a * 100) 
    : Math.round(card.coverage_shares.pole_b * 100)

  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group relative flex w-full flex-col overflow-hidden rounded-3xl bg-black/20 text-left transition-all duration-500 ease-out hover:bg-white/[0.03] shadow-2xl"
    >
      {/* Image Header */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-white/5">
        {imageUrl ? (
          <SafeImage
            src={imageUrl}
            alt={card.cluster_label}
            fill
            className="h-full w-full object-cover opacity-80 grayscale transition duration-700 group-hover:opacity-100 group-hover:grayscale-0 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        
        {/* Top Badges */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <span className={cn(
            "px-2.5 py-1 text-[10px] font-bold font-mono uppercase tracking-widest text-white shadow-lg",
            isLackingPoleA ? "bg-red-500/80" : isLackingPoleB ? "bg-cyan-500/80" : "bg-primary/80"
          )}>
            {blindspotLabel}: {blindspotValue}%
          </span>
        </div>

        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60">
            <span>{card.source_count} sources</span>
            <span className="h-1 w-1 rounded-full bg-white/40" />
            <span>{formatDate(card.published_at)}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-between p-6 space-y-6">
        <div className="space-y-3">
          <h3 className="font-serif text-2xl leading-[1.15] text-foreground/90 transition-colors group-hover:text-white sm:text-3xl">
            {card.cluster_label}
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground/60 italic">
            {card.explanation}
          </p>
        </div>

        <div className="space-y-4">
          {geographySignalBadges(card)}
          <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-cyan-400" />
              <span>{poleLabels.pole_a} {Math.round(card.coverage_shares.pole_a * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-zinc-400" />
              <span>Balanced {Math.round(card.coverage_shares.shared * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span>{poleLabels.pole_b} {Math.round(card.coverage_shares.pole_b * 100)}%</span>
              <div className="h-2 w-2 rounded-full bg-red-500" />
            </div>
          </div>
          {coverageBar(card)}
        </div>
      </div>
    </button>
  )
}

function StoryRow({
  card,
  poleLabels,
  onOpen,
}: {
  card: BlindspotCard
  poleLabels: { pole_a: string; pole_b: string }
  onOpen: (card: BlindspotCard) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="group flex w-full flex-col gap-3 rounded-2xl bg-white/[0.02] p-4 text-left transition-all duration-300 hover:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.15em] text-muted-foreground/40">
            <span>{card.source_count} sources</span>
            <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
            <span>{formatDate(card.published_at)}</span>
          </div>
          <h4 className="mt-1.5 line-clamp-2 font-serif text-lg leading-snug text-foreground/80 transition-colors group-hover:text-white">
            {card.cluster_label}
          </h4>
        </div>
        <div className="mt-1 flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-[10px] text-primary/60 tracking-wider">GAP SCORE</span>
          <span className="font-mono text-lg font-bold text-foreground/70">{Math.round(card.blindspot_score * 10) / 10}</span>
        </div>
      </div>
      
      <div className="space-y-2">
        {geographySignalBadges(card)}
        <div className="flex items-center justify-between text-[8px] font-mono uppercase tracking-widest text-muted-foreground/30">
          <span>{poleLabels.pole_a.charAt(0)} {Math.round(card.coverage_shares.pole_a * 100)}%</span>
          <span>B {Math.round(card.coverage_shares.shared * 100)}%</span>
          <span>{poleLabels.pole_b.charAt(0)} {Math.round(card.coverage_shares.pole_b * 100)}%</span>
        </div>
        {coverageBar(card)}
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

  const selectedCluster = useMemo(
    () => (selectedCard ? cardToCluster(selectedCard) : null),
    [selectedCard],
  )

  const poleLabels = useMemo(() => {
    if (!data) return { pole_a: "Pole A", pole_b: "Pole B" }
    const laneA = data.lanes.find(l => l.id === "pole_a")
    const laneB = data.lanes.find(l => l.id === "pole_b")
    return {
      pole_a: laneA?.label || "Pole A",
      pole_b: laneB?.label || "Pole B"
    }
  }, [data])

  if (isLoading && !data) {
    return (
      <div className="space-y-12">
        <Skeleton className="h-12 w-full rounded-sm opacity-20" />
        <div className="grid gap-12 xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="space-y-6">
              <Skeleton className="h-10 w-48 opacity-20" />
              <Skeleton className="h-64 w-full rounded-3xl opacity-10" />
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-2xl opacity-5" />
                <Skeleton className="h-20 w-full rounded-2xl opacity-5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error instanceof Error) {
    return (
      <div className="flex min-h-[32rem] items-center justify-center p-6">
        <div className="max-w-xl bg-white/[0.02] p-12 text-center rounded-2xl">
          <div className="flex flex-col items-center gap-4 text-foreground">
            <ShieldAlert className="h-12 w-12 text-primary/40" />
            <h2 className="font-serif text-3xl">Viewer unavailable</h2>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground/60">
            {error.message}
          </p>
          <Button
            onClick={() => void refetch()}
            variant="outline"
            className="mt-8 border-white/10 bg-white/[0.03] text-[10px] font-mono uppercase tracking-widest px-8"
          >
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
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
      <div className="flex flex-col space-y-16 p-6 lg:p-10">
        {/* Compact Controls Area */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="space-y-2">
            <h2 className="font-serif text-4xl font-medium tracking-tight text-foreground/90">
              Media Blindspots
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground/50 italic">
              Detecting asymmetric reporting where one perspective is missing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1">
              <span className="px-2 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40">Perspective</span>
              <select
                value={selectedLens}
                onChange={(e) => setSelectedLens(e.target.value as BlindspotLens["id"])}
                className="cursor-pointer border-none bg-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0"
              >
                {data.available_lenses.map((lens) => (
                  <option key={lens.id} value={lens.id} disabled={!lens.available} className="bg-[#0a0a0a]">
                    {lens.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1">
              <span className="px-2 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40">Rank By</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="cursor-pointer border-none bg-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-[#0a0a0a]">
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>

        {!data.selected_lens.available ? (
          <div className="bg-white/[0.01] py-32 text-center rounded-3xl border border-dashed border-white/5">
            <h3 className="font-serif text-2xl text-foreground/60">
              {data.selected_lens.label} analyzer is offline
            </h3>
            <p className="mt-2 text-sm text-muted-foreground/40">
              {data.selected_lens.unavailable_reason || "Check back shortly for updated intelligence."}
            </p>
          </div>
        ) : (
          <div className="grid gap-8 xl:grid-cols-3 xl:gap-12">
            {/* Missed by Pole A (Covered by Pole B) */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex flex-col space-y-8"
            >
              <div className="space-y-2 border-l-2 border-red-500/40 pl-6">
                <h3 className="font-serif text-3xl font-medium text-foreground/90 text-balance">Missed by {poleLabels.pole_a}</h3>
                <p className="text-[10px] text-muted-foreground/40 font-mono uppercase tracking-widest">
                  Reported primarily by {poleLabels.pole_b.toLowerCase()} outlets
                </p>
              </div>

              <div className="flex flex-col space-y-8">
                {(() => {
                  const cards = laneMap.get("pole_b") ?? []
                  const leadCard = cards[0]
                  const listCards = cards.slice(1, 8)
                  
                  if (!leadCard) return <div className="bg-white/[0.01] py-12 text-center rounded-2xl text-xs font-mono text-muted-foreground/20">No significant blindspots detected</div>
                  
                  return (
                    <>
                      <LeadStory card={leadCard} laneId="pole_b" poleLabels={poleLabels} onOpen={setSelectedCard} />
                      <div className="flex flex-col gap-3">
                        {listCards.map((card) => (
                          <StoryRow key={card.cluster_id} card={card} poleLabels={poleLabels} onOpen={setSelectedCard} />
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            </motion.section>

            {/* Balanced / Center Coverage */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
              className="flex flex-col space-y-8"
            >
              <div className="space-y-2 border-l-2 border-zinc-500/40 pl-6">
                <h3 className="font-serif text-3xl font-medium text-foreground/90 text-balance">Balanced & Center</h3>
                <p className="text-[10px] text-muted-foreground/40 font-mono uppercase tracking-widest">
                  Stories with consensus or neutral coverage
                </p>
              </div>

              <div className="flex flex-col space-y-8">
                {(() => {
                  const cards = laneMap.get("shared") ?? []
                  const leadCard = cards[0]
                  const listCards = cards.slice(1, 8)
                  
                  if (!leadCard) return <div className="bg-white/[0.01] py-12 text-center rounded-2xl text-xs font-mono text-muted-foreground/20">No balanced signals detected</div>
                  
                  return (
                    <>
                      <LeadStory card={leadCard} laneId="shared" poleLabels={poleLabels} onOpen={setSelectedCard} />
                      <div className="flex flex-col gap-3">
                        {listCards.map((card) => (
                          <StoryRow key={card.cluster_id} card={card} poleLabels={poleLabels} onOpen={setSelectedCard} />
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            </motion.section>

            {/* Missed by Pole B (Covered by Pole A) */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
              className="flex flex-col space-y-8"
            >
              <div className="space-y-2 border-l-2 border-cyan-500/40 pl-6">
                <h3 className="font-serif text-3xl font-medium text-foreground/90 text-balance">Missed by {poleLabels.pole_b}</h3>
                <p className="text-[10px] text-muted-foreground/40 font-mono uppercase tracking-widest">
                  Reported primarily by {poleLabels.pole_a.toLowerCase()} outlets
                </p>
              </div>

              <div className="flex flex-col space-y-8">
                {(() => {
                  const cards = laneMap.get("pole_a") ?? []
                  const leadCard = cards[0]
                  const listCards = cards.slice(1, 8)
                  
                  if (!leadCard) return <div className="bg-white/[0.01] py-12 text-center rounded-2xl text-xs font-mono text-muted-foreground/20">No significant blindspots detected</div>
                  
                  return (
                    <>
                      <LeadStory card={leadCard} laneId="pole_a" poleLabels={poleLabels} onOpen={setSelectedCard} />
                      <div className="flex flex-col gap-3">
                        {listCards.map((card) => (
                          <StoryRow key={card.cluster_id} card={card} poleLabels={poleLabels} onOpen={setSelectedCard} />
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            </motion.section>
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
