"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { checkSourceProfileCache, researchSourceProfile } from "@/lib/api"

interface SourceResearchPanelProps {
  sourceName: string
  website?: string
  autoRun?: boolean
}

const statusBadgeClass: Record<string, string> = {
  matched: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  ambiguous: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  none: "border-white/10 bg-muted/20 text-muted-foreground",
}

export function selectSourceResearchData<T>(
  cachedData?: T,
  researchData?: T,
): T | undefined {
  return researchData ?? cachedData
}

export function SourceResearchPanel({ sourceName, website, autoRun = false }: SourceResearchPanelProps) {
  const [runFullResearch, setRunFullResearch] = useState(autoRun)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const sourceWikiHref = `/wiki/source/${encodeURIComponent(sourceName)}`
  const sourceSearchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(`${sourceName} media outlet`)}`

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

  const data = selectSourceResearchData(cachedData, researchData)
  const isFetching = isCheckingCache || isResearching
  const hasData = !!data

  const handleRun = () => setRunFullResearch(true)
  const handleRefresh = () => {
    setRunFullResearch(true)
    setRefreshCounter((count) => count + 1)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 p-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Source Wiki Preview</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Deterministic public-source facts and record links.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2">
              <Link href={sourceWikiHref}>
                <ExternalLink className="mr-1 h-3 w-3" />
                Full wiki
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={hasData ? handleRefresh : handleRun}
              className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2"
            >
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RefreshCw className="mr-1 h-3 w-3" />{hasData ? "Refresh" : "Run"}</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!hasData && !isFetching && !error && (
          <p className="border-l-2 border-primary/30 pl-2 text-[11px] text-muted-foreground">
            Run research to fetch verified ownership, funding, and public records.
          </p>
        )}

        {isFetching && !hasData && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[10px] font-mono text-muted-foreground animate-pulse">
            Running source dossier lookup...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[10px] font-mono text-red-400">
            Research failed. Retry.
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={statusBadgeClass[data.match_status || "none"]}>
                {data.match_status === "matched" ? "verified" : data.match_status === "ambiguous" ? "ambiguous" : "no match"}
              </Badge>
              <Badge variant="outline" className="border-white/10 text-[9px] font-mono uppercase text-muted-foreground rounded-sm px-1.5 py-0">
                {data.cached ? "Cached" : "Live"}
              </Badge>
            </div>

            {data.overview && (
              <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Overview</p>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90">{data.overview}</p>
              </div>
            )}

            {data.match_explanation && (
              <div className="rounded-lg border border-white/10 bg-muted/10 px-3 py-2">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Method</p>
                <p className="mt-1 text-xs text-muted-foreground">{data.match_explanation}</p>
              </div>
            )}

            {(data.dossier_sections || []).map((section) => (
              <div key={section.id} className={`rounded-lg border p-3 ${section.items.length > 0 ? "border-white/10 bg-[var(--news-bg-primary)]" : "border-white/10 bg-muted/20 opacity-70 grayscale"}`}>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{section.title}</p>
                {section.items.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {section.items.slice(0, 4).map((item, index) => (
                      <div key={`${section.id}-${index}`}>
                        <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{item.label || "Fact"}</p>
                        <p className="mt-1 text-sm text-foreground/90 break-words">{item.value}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No public record found.</p>
                )}
              </div>
            ))}

            {data.citations && data.citations.length > 0 && (
              <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Sources</p>
                <div className="mt-2 space-y-1">
                  {data.citations.slice(0, 5).map((citation, index) => (
                    <div key={`${citation.label}-${index}`} className="text-xs text-muted-foreground">
                      {citation.url ? (
                        <a href={citation.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                          {citation.label}
                        </a>
                      ) : citation.label}
                      {citation.note ? ` · ${citation.note}` : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.match_status !== "matched" && (
              <div className="rounded-lg border border-white/10 bg-muted/20 px-4 py-5 text-center opacity-70 grayscale">
                <p className="text-sm font-medium text-foreground">No verified source overview yet</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  We did not find enough structured public data to build a full source wiki.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
              {data.wikipedia_url && (
                <a
                  href={data.wikipedia_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                  Wikipedia
                </a>
              )}
              {data.wikidata_url && (
                <a
                  href={data.wikidata_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                  Wikidata
                </a>
              )}
              <Button variant="outline" size="sm" asChild>
                <a href={data.search_links?.source_search || sourceSearchUrl} target="_blank" rel="noreferrer">
                  <Search className="mr-2 h-3.5 w-3.5" />
                  Search public web
                </a>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
