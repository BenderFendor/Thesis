"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ExternalLink, RefreshCw, Search, User } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { profileReporter, type ReporterProfile } from "@/lib/api"

interface ReporterProfilePanelProps {
  reporterName: string
  organization?: string
  articleContext?: string
  onClose?: () => void
  compact?: boolean
}

const statusBadgeClass: Record<string, string> = {
  matched: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  ambiguous: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  none: "border-white/10 bg-muted/20 text-muted-foreground",
}

const normalizeStatusLabel = (status?: string) => {
  if (status === "matched") return "verified"
  if (status === "ambiguous") return "ambiguous"
  return "no match"
}

const hasUsefulData = (profile: ReporterProfile) => {
  if (profile.match_status === "matched") return true
  return Boolean(profile.overview || profile.dossier_sections?.some((section) => section.items.length > 0))
}

const renderSection = (profile: ReporterProfile, sectionId: string) => {
  const section = profile.dossier_sections?.find((entry) => entry.id === sectionId)
  if (!section) return null
  if (section.items.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-muted/20 px-3 py-3 opacity-70 grayscale">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{section.title}</p>
        <p className="mt-2 text-xs text-muted-foreground">No public record found.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">{section.title}</p>
      <div className="mt-2 space-y-2">
        {section.items.slice(0, 4).map((item, index) => (
          <div key={`${section.id}-${index}`}>
            <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{item.label || "Fact"}</p>
            <p className="mt-1 text-sm text-foreground/90 break-words">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReporterProfilePanel({
  reporterName,
  organization,
  articleContext,
  onClose,
  compact = false,
}: ReporterProfilePanelProps) {
  const [forceRefresh, setForceRefresh] = useState(false)

  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ["reporter-profile", reporterName, organization, forceRefresh],
    queryFn: () => profileReporter(reporterName, organization, articleContext, forceRefresh),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  })

  const handleRefresh = () => {
    setForceRefresh(true)
    refetch()
  }

  if (isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    if (compact) return null
    return (
      <Card className="w-full max-w-md border-red-500/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <p>Failed to load reporter profile</p>
          </div>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!profile) return null

  const searchUrl =
    profile.search_links?.wikipedia ||
    `https://duckduckgo.com/?q=${encodeURIComponent(`${profile.name} journalist`)}`

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{profile.canonical_name || profile.name}</CardTitle>
              {organization && (
                <p className="text-sm text-muted-foreground">{organization}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={statusBadgeClass[profile.match_status || "none"]}>
              {normalizeStatusLabel(profile.match_status)}
            </Badge>
            <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh profile">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {onClose && !compact && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <span className="sr-only">Close</span>
                x
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {profile.overview && (
          <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Overview</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">{profile.overview}</p>
          </div>
        )}

        {profile.match_explanation && (
          <div className="rounded-lg border border-white/10 bg-muted/10 px-3 py-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Match</p>
            <p className="mt-1 text-xs text-muted-foreground">{profile.match_explanation}</p>
          </div>
        )}

        {renderSection(profile, "identity")}
        {renderSection(profile, "occupations")}
        {renderSection(profile, "education")}
        {renderSection(profile, "links")}

        {!hasUsefulData(profile) && (
          <div className="rounded-lg border border-white/10 bg-muted/20 px-4 py-5 text-center opacity-70 grayscale">
            <User className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">No verified public profile found</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              We did not find a confident public match for this byline.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          {profile.wikipedia_url && (
            <a
              href={profile.wikipedia_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              Wikipedia
            </a>
          )}
          {profile.wikidata_url && (
            <a
              href={profile.wikidata_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              Wikidata
            </a>
          )}
          {profile.id && profile.match_status === "matched" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/wiki/reporter/${profile.id}`}>
                Open full wiki
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={searchUrl} target="_blank" rel="noreferrer">
              <Search className="mr-2 h-3.5 w-3.5" />
              Search public web
            </a>
          </Button>
        </div>

        {profile.citations && profile.citations.length > 0 && (
          <div className="pt-2 border-t border-border">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Sources</p>
            <div className="mt-2 space-y-1">
              {profile.citations.slice(0, 4).map((citation, index) => (
                <div key={`${citation.label}-${index}`} className="text-xs text-muted-foreground">
                  {citation.url ? (
                    <a href={citation.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                      {citation.label}
                    </a>
                  ) : (
                    citation.label
                  )}
                  {citation.note ? ` · ${citation.note}` : ""}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
