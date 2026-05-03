"use client"

import { useState, useEffect, useCallback } from "react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  fetchSourceCredibility,
  type SourceCredibilityProfile,
} from "@/lib/api"

interface SourceCredibilityPanelProps {
  domain: string
  autoRun?: boolean
}

const DIMENSION_LABELS: Record<string, string> = {
  funding_transparency: "Funding Transparency",
  source_network_diversity: "Source Network Diversity",
  political_orientation_disclosure: "Political Orientation",
  correction_record: "Correction Record",
  methodology_transparency: "Methodology Transparency",
  cross_verification_alignment: "Cross-Verification Alignment",
}

function scoreToColor(score: number | null | undefined): string {
  if (score == null) return "bg-muted/30"
  if (score >= 70) return "bg-emerald-500"
  if (score >= 40) return "bg-amber-500"
  return "bg-red-500"
}

function scoreToTextColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground"
  if (score >= 70) return "text-emerald-400"
  if (score >= 40) return "text-amber-400"
  return "text-red-400"
}

export function SourceCredibilityPanel({ domain, autoRun = false }: SourceCredibilityPanelProps) {
  const [profile, setProfile] = useState<SourceCredibilityProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedDim, setExpandedDim] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    if (!domain) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSourceCredibility(domain)
      setProfile(data)
    } catch {
      setError("Failed to load credibility data")
    } finally {
      setLoading(false)
    }
  }, [domain])

  useEffect(() => {
    if (autoRun) {
      void loadProfile()
    }
  }, [autoRun, loadProfile])

  const dims = profile?.dimensions ?? {}
  const dimEntries = Object.entries(dims)

  if (!autoRun && !profile) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadProfile()}
          disabled={loading}
          className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2"
        >
          {loading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Load Credibility Data
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={`skeleton-${i}`} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 bg-muted/30 rounded animate-pulse" />
              <div className="h-3 w-8 bg-muted/20 rounded animate-pulse" />
            </div>
            <div className="h-2 w-full bg-muted/20 rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-3 text-center">
        <p className="text-xs text-muted-foreground mb-2">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadProfile()}
          className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2"
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      </div>
    )
  }

  if (!profile || dimEntries.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-muted-foreground">
        No credibility data available for this source.
      </div>
    )
  }

  const dq = profile.data_quality

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Credibility
          </span>
          <span className="font-mono text-[10px] text-foreground/80">
            {dq.dimensions_available}/{dq.dimensions_total} dimensions
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadProfile()}
          disabled={loading}
          className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-5 px-1.5"
        >
          <RefreshCw className="h-2.5 w-2.5" />
        </Button>
      </div>

      <div className="space-y-2.5">
        {dimEntries.map(([key, dim]) => {
          const score = dim.score
          const isNil = score == null
          const isExpanded = expandedDim === key
          return (
            <div key={key}>
              <div
                className="flex items-center gap-2 group cursor-pointer"
                onClick={() => setExpandedDim(isExpanded ? null : key)}
              >
                <span className="flex-1 text-[11px] font-mono text-foreground/70 capitalize truncate">
                  {DIMENSION_LABELS[key] ?? key.replace(/_/g, " ")}
                </span>
                <span className={`text-[10px] font-mono ${scoreToTextColor(score)}`}>
                  {isNil ? "-" : `${Math.round(score as number)}`}
                </span>
              </div>
              <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden mt-1">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${scoreToColor(score)}`}
                  style={{ width: isNil ? "0%" : `${Math.min(100, score as number)}%` }}
                />
              </div>
              {isExpanded && !isNil && (
                <div className="mt-2 pl-1 space-y-1.5 border-l border-white/5 ml-1 pl-2">
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                    {dim.explanation ?? ""}
                  </p>
                  {dim.provenance && dim.provenance.length > 0 && (
                    <div className="space-y-0.5">
                      {dim.provenance.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-1 text-[9px] text-muted-foreground/50">
                          {p.url ? (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-foreground/60 flex items-center gap-0.5"
                            >
                              {p.source}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ) : (
                            <span>{p.source}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {dq.last_updated && (
        <div className="text-[9px] text-muted-foreground/40 font-mono pt-1 border-t border-white/5">
          Last updated: {new Date(dq.last_updated).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}
