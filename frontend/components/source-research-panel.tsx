"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { researchSourceProfile, checkSourceProfileCache } from "@/lib/api"

interface SourceResearchPanelProps {
  sourceName: string
  website?: string
  autoRun?: boolean
}

const FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "funding", label: "Funding" },
  { key: "ownership", label: "Ownership" },
  { key: "political_bias", label: "Political Bias" },
  { key: "factual_reporting", label: "Factual Reporting" },
  { key: "editorial_stance", label: "Editorial Stance" },
  { key: "corrections_history", label: "Corrections" },
  { key: "major_controversies", label: "Controversies" },
  { key: "reach_traffic", label: "Reach" },
  { key: "affiliations", label: "Affiliations" },
  { key: "founded", label: "Founded" },
  { key: "headquarters", label: "HQ" },
]

const formatTimestamp = (value?: string) => {
  if (!value) return "Unknown"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const isUrl = (value: string) => /^https?:\/\//i.test(value)

const formatSourceLabel = (value: string) => {
  if (!isUrl(value)) return value
  try {
    const parsed = new URL(value)
    return parsed.hostname.replace("www.", "")
  } catch {
    return value
  }
}

export function SourceResearchPanel({ sourceName, website, autoRun = false }: SourceResearchPanelProps) {
  const [runFullResearch, setRunFullResearch] = useState(autoRun)
  const [refreshCounter, setRefreshCounter] = useState(0)

  const { data: cachedData, isFetching: isCheckingCache } = useQuery({
    queryKey: ["source-research-cache-check", sourceName],
    queryFn: () => checkSourceProfileCache(sourceName, website),
    enabled: sourceName.length > 0 && !runFullResearch,
    retry: false,
    staleTime: 1000 * 60 * 60,
  })

  const { data: researchData, error, isFetching: isResearching } = useQuery({
    queryKey: ["source-research", sourceName, refreshCounter],
    queryFn: () => researchSourceProfile(sourceName, website, refreshCounter > 0),
    enabled: runFullResearch && sourceName.length > 0,
    retry: 1,
    staleTime: 1000 * 60 * 60,
  })

  const data = cachedData || researchData
  const isFetching = isCheckingCache || isResearching
  const hasData = !!data

  const hasResults = useMemo(() => {
    if (!data) return false
    const fieldValues = Object.values(data.fields || {}).some((values) => values && values.length > 0)
    return fieldValues || (data.key_reporters && data.key_reporters.length > 0)
  }, [data])

  const citations = useMemo(() => {
    const map = new Map<string, number>()
    const order: string[] = []
    if (!data) return { map, order }
    Object.values(data.fields || {}).forEach((entries) => {
      entries?.forEach((entry) => {
        entry.sources?.forEach((source) => {
          const normalized = source.trim()
          if (!normalized) return
          if (!map.has(normalized)) {
            map.set(normalized, order.length + 1)
            order.push(normalized)
          }
        })
      })
    })
    return { map, order }
  }, [data])

  const renderCitations = (sources?: string[]) => {
    if (!sources || sources.length === 0 || citations.order.length === 0) return null
    const indices = sources
      .map((source) => citations.map.get(source.trim()))
      .filter((value): value is number => typeof value === "number")
    if (!indices.length) return null
    const label = indices.map((value) => `[${value}]`).join("")
    return <span className="ml-1 align-super text-[9px] text-muted-foreground">{label}</span>
  }

  const handleRun = () => setRunFullResearch(true)
  const handleRefresh = () => {
    setRunFullResearch(true)
    setRefreshCounter((count) => count + 1)
  }

  const showRunButton = !hasData && !runFullResearch && !isCheckingCache

  return (
    <div className="flex flex-col h-full">
      {/* Header - Fixed */}
      <div className="p-4 border-b border-white/10 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Source Research</p>
          <Button
            variant="outline"
            size="sm"
            onClick={hasData ? handleRefresh : handleRun}
            className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2"
          >
            {isFetching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <RefreshCw className="h-3 w-3 mr-1" />
                {hasData ? "Refresh" : "Run"}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {showRunButton && (
            <p className="text-[11px] text-muted-foreground border-l-2 border-primary/30 pl-2">
              Run research to fetch funding, ownership, bias data.
            </p>
          )}

          {isCheckingCache && !hasData && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[10px] font-mono text-muted-foreground animate-pulse">
              Checking cache...
            </div>
          )}

          {runFullResearch && isResearching && !hasData && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[10px] font-mono text-muted-foreground animate-pulse">
              Running research...
            </div>
          )}

          {runFullResearch && error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[10px] font-mono text-red-400">
              Research failed. Retry.
            </div>
          )}

          {hasData && (
            <div className="space-y-3">
              {/* Status Badge */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-white/10 text-[9px] font-mono uppercase text-muted-foreground rounded-sm px-1.5 py-0">
                  {data.cached ? "Cached" : "Live"}
                </Badge>
                <span className="text-[9px] text-muted-foreground">
                  {formatTimestamp(data.fetched_at)}
                </span>
              </div>

              {/* Identity Card */}
              <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 bg-white/5">
                  <div className="font-serif text-sm font-medium text-foreground">{data.name}</div>
                  {data.website && (
                    <div className="text-[10px] font-mono text-muted-foreground truncate">{formatSourceLabel(data.website)}</div>
                  )}
                </div>
              </div>

              {/* Field Cards */}
              {FIELD_LABELS.map((field) => {
                const values = data.fields?.[field.key] || []
                if (values.length === 0) return null

                return (
                  <div key={field.key} className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-primary/70">{field.label}</span>
                      {values.length > 1 && (
                        <span className="text-[8px] font-mono text-amber-500/70 bg-amber-500/10 px-1 rounded">
                          {values.length} sources
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {values.slice(0, 2).map((entry, index) => (
                        <div key={`${field.key}-${index}`} className="text-[11px] text-foreground/90 leading-relaxed">
                          {entry.value}
                          {renderCitations(entry.sources)}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              {/* Key Reporters */}
              {data.key_reporters && data.key_reporters.length > 0 && (
                <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-primary/70 block mb-2">Key Reporters</span>
                  <div className="space-y-1">
                    {data.key_reporters.slice(0, 4).map((reporter) => (
                      <div key={reporter.name} className="flex items-center justify-between text-[11px]">
                        <span className="text-foreground/90 truncate">{reporter.name}</span>
                        <span className="text-[9px] font-mono text-muted-foreground ml-2">{reporter.article_count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Citations */}
              {citations.order.length > 0 && (
                <div className="pt-3 border-t border-white/10">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground block mb-2">Citations</span>
                  <div className="space-y-1">
                    {citations.order.slice(0, 5).map((source, index) => (
                      <div key={source} className="flex gap-2 text-[9px] text-muted-foreground/70">
                        <span className="font-mono text-white/30">[{index + 1}]</span>
                        {isUrl(source) ? (
                          <a className="hover:text-primary truncate" href={source} target="_blank" rel="noreferrer">
                            {formatSourceLabel(source)}
                          </a>
                        ) : (
                          <span className="truncate">{source}</span>
                        )}
                      </div>
                    ))}
                    {citations.order.length > 5 && (
                      <div className="text-[9px] text-muted-foreground/50">
                        +{citations.order.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!hasResults && (
                <div className="py-6 text-center text-[11px] text-muted-foreground italic">
                  Limited public data found.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
