"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
    User,
    Twitter,
    Linkedin,
    ExternalLink,
    RefreshCw,
    AlertTriangle,
    CheckCircle,
    HelpCircle
} from "lucide-react"
import { profileReporter, type ReporterProfile } from "@/lib/api"

interface ReporterProfilePanelProps {
    reporterName: string
    organization?: string
    articleContext?: string
    onClose?: () => void
}

const LEANING_COLORS: Record<string, string> = {
    "left": "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "center-left": "bg-sky-500/20 text-sky-400 border-sky-500/30",
    "center": "bg-gray-500/20 text-gray-400 border-gray-500/30",
    "center-right": "bg-orange-500/20 text-orange-400 border-orange-500/30",
    "right": "bg-red-500/20 text-red-400 border-red-500/30",
}

const CONFIDENCE_ICONS: Record<string, React.ElementType> = {
    "high": CheckCircle,
    "medium": HelpCircle,
    "low": AlertTriangle,
}

export function ReporterProfilePanel({
    reporterName,
    organization,
    articleContext,
    onClose
}: ReporterProfilePanelProps) {
    const [forceRefresh, setForceRefresh] = useState(false)

    const { data: profile, isLoading, error, refetch } = useQuery({
        queryKey: ["reporter-profile", reporterName, organization, forceRefresh],
        queryFn: () => profileReporter(reporterName, organization, articleContext, forceRefresh),
        staleTime: 1000 * 60 * 60, // 1 hour
        retry: 1,
    })

    const handleRefresh = () => {
        setForceRefresh(true)
        refetch()
    }

    if (isLoading) {
        return (
            <Card className="w-full max-w-md">
                <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                    <div className="flex gap-2">
                        <Skeleton className="h-6 w-16" />
                        <Skeleton className="h-6 w-20" />
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (error) {
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

    const ConfidenceIcon = CONFIDENCE_ICONS[profile.research_confidence || "low"] || HelpCircle
    const leaningColor = LEANING_COLORS[profile.political_leaning || ""] || LEANING_COLORS["center"]

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-primary/10">
                            <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">{profile.name}</CardTitle>
                            {organization && (
                                <p className="text-sm text-muted-foreground">{organization}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh profile">
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose}>
                                <span className="sr-only">Close</span>
                                x
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Bio */}
                {profile.bio && (
                    <div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {profile.bio.length > 300 ? `${profile.bio.slice(0, 300)}...` : profile.bio}
                        </p>
                    </div>
                )}

                {/* Topics */}
                {profile.topics && profile.topics.length > 0 && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-2">Areas of Coverage</p>
                        <div className="flex flex-wrap gap-1">
                            {profile.topics.map((topic, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                    {topic}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}

                {/* Political Leaning */}
                {profile.political_leaning && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-2">Political Leaning</p>
                        <div className="flex items-center gap-2">
                            <Badge className={leaningColor}>
                                {profile.political_leaning}
                            </Badge>
                            {profile.leaning_confidence && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <ConfidenceIcon className="h-3 w-3" />
                                    {profile.leaning_confidence} confidence
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Career History */}
                {profile.career_history && profile.career_history.length > 0 && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-2">Career</p>
                        <div className="space-y-1">
                            {profile.career_history.slice(0, 3).map((job, i) => (
                                <p key={i} className="text-sm">
                                    {job.role && <span className="text-muted-foreground">{job.role} at </span>}
                                    {job.organization}
                                </p>
                            ))}
                        </div>
                    </div>
                )}

                {/* Social Links */}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                    {profile.twitter_handle && (
                        <a
                            href={`https://twitter.com/${profile.twitter_handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-muted rounded-md transition-colors"
                        >
                            <Twitter className="h-4 w-4 text-blue-400" />
                        </a>
                    )}
                    {profile.linkedin_url && (
                        <a
                            href={profile.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-muted rounded-md transition-colors"
                        >
                            <Linkedin className="h-4 w-4 text-blue-600" />
                        </a>
                    )}
                    {profile.wikipedia_url && (
                        <a
                            href={profile.wikipedia_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-muted rounded-md transition-colors"
                        >
                            <ExternalLink className="h-4 w-4" />
                            <span className="sr-only">Wikipedia</span>
                        </a>
                    )}
                </div>

                {/* Research Metadata */}
                <div className="text-xs text-muted-foreground flex items-center justify-between pt-2 border-t border-border">
                    <span className="flex items-center gap-1">
                        <ConfidenceIcon className="h-3 w-3" />
                        {profile.research_confidence || "unknown"} confidence
                    </span>
                    <span>
                        {profile.cached ? "Cached" : "Fresh"} |
                        Sources: {profile.research_sources?.join(", ") || "none"}
                    </span>
                </div>
            </CardContent>
        </Card>
    )
}
