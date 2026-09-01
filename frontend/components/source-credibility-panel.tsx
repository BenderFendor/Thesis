"use client"

import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import type { SourceCredibilityProfile } from "@/lib/api"
import { fetchSourceCredibility } from "@/lib/api"

interface SourceCredibilityPanelProps {
  domain: string
  autoRun?: boolean
}

interface CredibilityDimensionProps {
  dimension: SourceCredibilityProfile["dimensions"][string]
  expanded: boolean
  label: string
  onToggle: () => void
}

const useCredibilityController = (domain: string, autoRun: boolean) => {
  const [profile, setProfile] = useState<SourceCredibilityProfile | null>(null),
   [loading, setLoading] = useState(false),
   [error, setError] = useState<string | null>(null),
   [expandedDim, setExpandedDim] = useState<string | null>(null),

   loadProfile = useCallback(async () => {
    if (!domain) {return}
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

  return {
    dimEntries: Object.entries(profile?.dimensions ?? {}),
    error,
    expandedDim,
    loadProfile,
    loading,
    profile,
    setExpandedDim,
  }
},

 scoreToColor = (score: number | null | undefined): string => {
  if (score == null) {return "bg-muted/30"}
  if (score >= 70) {return "bg-emerald-500"}
  if (score >= 40) {return "bg-amber-500"}
  return "bg-red-500"
},

 scoreToTextColor = (score: number | null | undefined): string => {
  if (score == null) {return "text-muted-foreground"}
  if (score >= 70) {return "text-emerald-400"}
  if (score >= 40) {return "text-amber-400"}
  return "text-red-400"
},

 DIMENSION_LABELS = new Map(Object.entries({
  correction_record: "Correction Record",
  cross_verification_alignment: "Cross-Verification Alignment",
  funding_transparency: "Funding Transparency",
  methodology_transparency: "Methodology Transparency",
  political_orientation_disclosure: "Political Orientation",
  source_network_diversity: "Source Network Diversity",
})),

CredibilityDimension = ({
  dimension,
  expanded,
  label,
  onToggle,
}: CredibilityDimensionProps) => {
  const { score } = dimension,
   isNil = score == null
  return (
    <div>
      <div
        className="flex items-center gap-2 group cursor-pointer"
        onClick={onToggle}
      >
        <span className="flex-1 text-[11px] font-mono text-foreground/70 capitalize truncate">
          {label}
        </span>
        <span className={`text-[10px] font-mono ${scoreToTextColor(score)}`}>
          {isNil ? "-" : `${Math.round(score)}`}
        </span>
      </div>
      <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden mt-1">
        <div
          className={`h-full rounded-full transition-all duration-500 ${scoreToColor(score)}`}
          style={{ width: isNil ? "0%" : `${Math.min(100, score)}%` }}
        />
      </div>
      {expanded && !isNil && (
        <div className="mt-2 pl-1 space-y-1.5 border-l border-white/5 ml-1 pl-2">
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
            {dimension.explanation ?? ""}
          </p>
          {dimension.provenance && dimension.provenance.length > 0 && (
            <div className="space-y-0.5">
              {dimension.provenance.map((provenance) => (
                <div key={`${provenance.source}-${provenance.url}`} className="flex items-center gap-1 text-[9px] text-muted-foreground/50">
                  {provenance.url ? (
                    <a
                      href={provenance.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground/60 flex items-center gap-0.5"
                    >
                      {provenance.source}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ) : (
                    <span>{provenance.source}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
},

SourceCredibilityPanel = ({
  domain,
  autoRun = false,
}: SourceCredibilityPanelProps) => {
  const {
    dimEntries,
    error,
    expandedDim,
    loadProfile,
    loading,
    profile,
    setExpandedDim,
  } = useCredibilityController(domain, autoRun)

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Credibility
          </span>
          <span className="font-mono text-[10px] text-foreground/80">
            {profile.data_quality.dimensions_available}/{profile.data_quality.dimensions_total} dimensions
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
        {dimEntries.map(([key, dimension]) => (
          <CredibilityDimension
            key={key}
            dimension={dimension}
            expanded={expandedDim === key}
            label={DIMENSION_LABELS.get(key) ?? key.replaceAll('_', " ")}
            onToggle={() =>{  setExpandedDim(expandedDim === key ? null : key); }}
          />
        ))}
      </div>

      {profile.data_quality.last_updated && (
        <div className="text-[9px] text-muted-foreground/40 font-mono pt-1 border-t border-white/5">
          Last updated: {new Date(profile.data_quality.last_updated).toLocaleDateString()}
        </div>
      )}
    </div>
  )
};

export { SourceCredibilityPanel }
