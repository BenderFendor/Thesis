"use client"

import { useState } from "react"
import { BarChart3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SourceCredibilityProfile } from "@/lib/api"

interface CredibilityBadgeProps {
  domain: string
  className?: string
  size?: "sm" | "md" | "lg"
}

export function CredibilityBadge({ domain, className = "", size = "md" }: CredibilityBadgeProps) {
  const [showPanel, setShowPanel] = useState(false),
   [profile, setProfile] = useState<SourceCredibilityProfile | null>(undefined),
   [loading, setLoading] = useState(false),
   [error, setError] = useState<string | null>(undefined),

   dimensionalData = profile?.data_quality,
   available = dimensionalData?.dimensions_available ?? 0,
   total = dimensionalData?.dimensions_total ?? 6,

   iconSizes = { lg: "w-4 h-4", md: "w-3.5 h-3.5", sm: "w-3 h-3" },
   textSizes = { lg: "text-xs", md: "text-[11px]", sm: "text-[10px]" },
   iconSize = iconSizes[size],
   textSize = textSizes[size],

   handleClick = async () => {
    if (showPanel) {
      setShowPanel(false)
      return
    }
    if (profile && !error) {
      setShowPanel(true)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const { fetchSourceCredibility } = await import("@/lib/api"),
       data = await fetchSourceCredibility(domain)
      setProfile(data)
      setShowPanel(true)
    } catch {
      setError("Failed to load credibility data")
      setShowPanel(true)
    } finally {
      setLoading(false)
    }
  },

   dims = profile?.dimensions ?? {},
   dimensionEntries = Object.entries(dims) as [string, {
    score?: number | null
    confidence?: number
    explanation?: string
    provenance?: { source: string; url: string }[]
    status?: string
    dimension?: string
  }][],

   scoreToColor = (score: number | null | undefined): string => {
    if (score == null) {return "bg-muted"}
    if (score >= 70) {return "bg-emerald-500"}
    if (score >= 40) {return "bg-amber-500"}
    return "bg-red-500"
  },

   scoreToLabel = (score: number | null | undefined): string => {
    if (score == null) {return "No data"}
    if (score >= 70) {return "Strong"}
    if (score >= 40) {return "Moderate"}
    return "Weak"
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`cursor-pointer border-white/10 bg-muted/20 hover:bg-muted/30 ${className}`}
              onClick={handleClick}
            >
              <BarChart3 className={`${iconSize} mr-1 text-muted-foreground`} />
              <span className={`${textSize} text-muted-foreground`}>
                {available}/{total}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-xs space-y-1">
              <div className="font-medium">Credibility Data</div>
              <div>{available} of {total} dimensions have data</div>
              <div className="text-muted-foreground">Click to expand</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() =>{  setShowPanel(false); }}
          />
          <div className="relative z-10 w-full max-w-md max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-[var(--news-bg-secondary)] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-base font-semibold text-foreground">
                Source Credibility
              </h3>
              <button
                type="button"
                onClick={() =>{  setShowPanel(false); }}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                Close
              </button>
            </div>

            {loading && (
              <div className="space-y-3 py-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-3 w-32 bg-muted/30 rounded animate-pulse" />
                    <div className="h-2 w-full bg-muted/20 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            )}

            {error && !loading && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                {error}
              </div>
            )}

            {!loading && !error && dimensionEntries.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No credibility data available for this source.
              </div>
            )}

            {!loading && !error && dimensionEntries.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="rounded border border-white/5 bg-muted/10 p-2 text-center">
                    <span className="block text-[10px] font-mono text-muted-foreground/60 uppercase">
                      Domain
                    </span>
                    <span className="text-xs font-medium text-foreground truncate block">
                      {profile?.domain ?? domain}
                    </span>
                  </div>
                  <div className="rounded border border-white/5 bg-muted/10 p-2 text-center">
                    <span className="block text-[10px] font-mono text-muted-foreground/60 uppercase">
                      Available
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {available}/{total}
                    </span>
                  </div>
                  <div className="rounded border border-white/5 bg-muted/10 p-2 text-center">
                    <span className="block text-[10px] font-mono text-muted-foreground/60 uppercase">
                      Status
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {profile?.status ?? "Unknown"}
                    </span>
                  </div>
                </div>

                {dimensionEntries.map(([key, dim]) => {
                  const {score} = dim,
                   isNil = score == null
                  return (
                    <details key={key} className="group border border-white/5 rounded-lg p-3">
                      <summary className="cursor-pointer flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-foreground/80 capitalize">
                          {key.replaceAll('_', " ")}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {isNil ? "No data" : scoreToLabel(score)}
                        </span>
                      </summary>
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${scoreToColor(score)}`}
                              style={{ width: isNil ? "0%" : `${Math.min(100, score)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground min-w-[3ch]">
                            {isNil ? "-" : `${Math.round(score)}`}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/70">
                          {dim.explanation ?? ""}
                        </p>
                        {dim.provenance && dim.provenance.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[9px] font-mono uppercase text-muted-foreground/50">
                              Data Sources
                            </span>
                            {dim.provenance.map((p, pi) => (
                              <div key={pi} className="text-[10px] text-muted-foreground">
                                {p.url ? (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline hover:text-foreground"
                                  >
                                    {p.source}
                                  </a>
                                ) : (
                                  <span>{p.source}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
