"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { researchSourceProfile } from "@/lib/api"

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
  { key: "corrections_history", label: "Corrections History" },
  { key: "major_controversies", label: "Major Controversies" },
  { key: "reach_traffic", label: "Reach / Traffic" },
  { key: "affiliations", label: "Affiliations" },
  { key: "founded", label: "Founded" },
  { key: "headquarters", label: "Headquarters" },
  { key: "official_website", label: "Official Website" },
  { key: "nonprofit_filings", label: "Nonprofit Filings" },
]

const formatTimestamp = (value?: string) => {
  if (!value) return "Unknown"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

const isUrl = (value: string) => /^https?:\/\//i.test(value)

const formatSourceLabel = (value: string) => {
  if (!isUrl(value)) return value
  try {
    const parsed = new URL(value)
    const path = parsed.pathname.replace(/\/$/, "")
    return `${parsed.hostname}${path}`
  } catch {
    return value
  }
}

export function SourceResearchPanel({ sourceName, website, autoRun = false }: SourceResearchPanelProps) {
  const [requested, setRequested] = useState(autoRun)
  const [refreshCounter, setRefreshCounter] = useState(0)

  useEffect(() => {
    if (autoRun) {
      setRequested(true)
    }
  }, [autoRun])

  const { data, error, isFetching } = useQuery({
    queryKey: ["source-research", sourceName, refreshCounter],
    queryFn: () => researchSourceProfile(sourceName, website, refreshCounter > 0),
    enabled: requested && sourceName.length > 0,
    retry: 1,
    staleTime: 1000 * 60 * 60,
  })

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
    return <span className="ml-1 align-super text-[10px] text-muted-foreground">{label}</span>
  }

  const infoboxRows = useMemo(() => {
    if (!data) return []
    const fallbackWebsite = data.website || website
    return [
      { key: "official_website", label: "Website", fallback: fallbackWebsite },
      { key: "founded", label: "Founded" },
      { key: "headquarters", label: "Headquarters" },
      { key: "ownership", label: "Ownership" },
      { key: "funding", label: "Funding" },
      { key: "political_bias", label: "Bias" },
      { key: "factual_reporting", label: "Factual" },
      { key: "nonprofit_filings", label: "Nonprofit Filings" },
    ]
  }, [data, website])

  const handleRun = () => {
    setRequested(true)
  }

  const handleRefresh = () => {
    setRequested(true)
    setRefreshCounter((count) => count + 1)
  }

  return (
    <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)]/70 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Source Research</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Funding, ownership, bias, corrections history, and source metadata.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={requested ? handleRefresh : handleRun}
          className="border-border/60"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {requested ? "Update" : "Run Source Research"}
        </Button>
      </div>

      {!requested && (
        <p className="mt-3 text-xs text-muted-foreground">
          Run source research to fetch a source profile with citations and metadata.
        </p>
      )}

      {requested && isFetching && (
        <div className="mt-4 rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/60 p-4 text-xs text-muted-foreground">
          Running source research in the background...
        </div>
      )}

      {requested && error && (
        <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-200">
          Failed to run source research. Try again.
        </div>
      )}

      {requested && data && (
        <div className="mt-4 space-y-4 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.2em]">
              {data.cached ? "Cached" : "Fresh"}
            </Badge>
            <span>Fetched: {formatTimestamp(data.fetched_at)}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/70">
              <div className="border-b border-border/60 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                Source
              </div>
              <div className="px-3 py-3">
                <div className="text-sm font-semibold text-foreground">{data.name}</div>
                {data.website && (
                  <div className="mt-1 text-[11px] text-muted-foreground">{formatSourceLabel(data.website)}</div>
                )}
              </div>
              <div className="divide-y divide-border/60 border-t border-border/60">
                {infoboxRows.map((row) => {
                  const entries = data.fields?.[row.key] || []
                  const displayed = entries.slice(0, 2)
                  const fallback = row.fallback ? [{ value: row.fallback, sources: [] }] : []
                  const values = displayed.length > 0 ? displayed : fallback
                  const sourceList = values.flatMap((entry) => entry.sources || [])
                  return (
                    <div key={row.key} className="px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{row.label}</div>
                      <div className="mt-1 space-y-1 text-foreground">
                        {values.length > 0 ? (
                          values.map((entry, index) => (
                            <div key={`${row.key}-${index}`}>
                              {isUrl(entry.value) ? (
                                <a
                                  className="text-foreground hover:underline"
                                  href={entry.value}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {formatSourceLabel(entry.value)}
                                </a>
                              ) : (
                                <span>{entry.value}</span>
                              )}
                              {renderCitations(entry.sources)}
                            </div>
                          ))
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </div>
                      {sourceList.length === 0 && row.key === "official_website" && data.website && (
                        <div className="mt-1 text-[10px] text-muted-foreground">No citations yet</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-3">
              {FIELD_LABELS.map((field) => {
                const values = data.fields?.[field.key] || []
                const hasValues = values.length > 0
                return (
                  <div key={field.key} className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/70 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{field.label}</span>
                      {values.length > 1 && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.2em]">
                          Conflicting
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 space-y-2">
                      {hasValues ? (
                        values.map((entry, index) => (
                          <div key={`${field.key}-${index}`} className="space-y-1">
                            <div className="text-foreground">
                              {entry.value}
                              {renderCitations(entry.sources)}
                            </div>
                            {entry.notes && (
                              <div className="text-[10px] text-muted-foreground">{entry.notes}</div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-muted-foreground">N/A</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/70 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Key Reporters</span>
              {data.key_reporters && data.key_reporters.length === 0 && (
                <AlertTriangle className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
            <div className="mt-2 space-y-2">
              {data.key_reporters && data.key_reporters.length > 0 ? (
                data.key_reporters.map((reporter) => (
                  <div key={reporter.name} className="flex items-center justify-between text-foreground">
                    <span>{reporter.name}</span>
                    <span className="text-[10px] text-muted-foreground">{reporter.article_count} articles</span>
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground">N/A</div>
              )}
            </div>
          </div>

          {citations.order.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/70 p-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">References</div>
              <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
                {citations.order.map((source, index) => (
                  <div key={source} className="flex gap-2">
                    <span className="text-foreground">[{index + 1}]</span>
                    {isUrl(source) ? (
                      <a className="hover:underline" href={source} target="_blank" rel="noreferrer">
                        {formatSourceLabel(source)}
                      </a>
                    ) : (
                      <span>{source}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasResults && (
            <div className="rounded-lg border border-border/60 bg-[var(--news-bg-primary)]/70 p-3 text-muted-foreground">
              No source research data found yet.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
