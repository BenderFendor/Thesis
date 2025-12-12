"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
    TrendingUp,
    AlertTriangle,
    DollarSign,
    Globe,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Building2,
    AlertCircle
} from "lucide-react"
import { analyzeMaterialContext, type MaterialContext } from "@/lib/api"

interface MaterialContextPanelProps {
    source: string
    sourceCountry: string
    mentionedCountries: string[]
    topics?: string[]
    articleText?: string
    compact?: boolean
    onClose?: () => void
}

const CONFIDENCE_COLORS: Record<string, string> = {
    "high": "text-green-400",
    "medium": "text-yellow-400",
    "low": "text-orange-400",
}

export function MaterialContextPanel({
    source,
    sourceCountry,
    mentionedCountries,
    topics,
    articleText,
    compact = false,
    onClose
}: MaterialContextPanelProps) {
    const [expanded, setExpanded] = useState(!compact)

    const { data: context, isLoading, error, refetch } = useQuery({
        queryKey: ["material-context", source, sourceCountry, mentionedCountries.join(",")],
        queryFn: () => analyzeMaterialContext(source, sourceCountry, mentionedCountries, topics, articleText),
        staleTime: 1000 * 60 * 60, // 1 hour
        retry: 1,
        enabled: mentionedCountries.length > 0,
    })

    if (isLoading) {
        return (
            <Card className="w-full">
                <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <Skeleton className="h-5 w-32" />
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </CardContent>
            </Card>
        )
    }

    if (error || !context) {
        return (
            <Card className="w-full border-orange-500/30">
                <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-orange-400 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        <p>Material context unavailable</p>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const hasConflicts = context.potential_conflicts && context.potential_conflicts.length > 0
    const hasWarnings = context.reader_warnings && context.reader_warnings.length > 0
    const hasKnownInterests = Object.keys(context.known_interests || {}).length > 0

    // Compact mode - just show a warning badge if conflicts exist
    if (compact && !expanded) {
        return (
            <div
                className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${hasConflicts ? "bg-orange-500/10 hover:bg-orange-500/20" : "bg-muted/50 hover:bg-muted"
                    }`}
                onClick={() => setExpanded(true)}
            >
                <TrendingUp className={`h-4 w-4 ${hasConflicts ? "text-orange-400" : "text-muted-foreground"}`} />
                <span className="text-sm">
                    {hasConflicts ? "Potential conflicts detected" : "Material context"}
                </span>
                {hasConflicts && (
                    <Badge variant="outline" className="text-orange-400 border-orange-500/30 text-xs">
                        {context.potential_conflicts.length}
                    </Badge>
                )}
                <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
            </div>
        )
    }

    return (
        <Card className={`w-full ${hasConflicts ? "border-orange-500/30" : ""}`}>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <TrendingUp className={`h-4 w-4 ${hasConflicts ? "text-orange-400" : "text-primary"}`} />
                        <CardTitle className="text-base">Material Context</CardTitle>
                        {context.confidence && (
                            <span className={`text-xs ${CONFIDENCE_COLORS[context.confidence]}`}>
                                {context.confidence} confidence
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => refetch()} className="h-8 w-8">
                            <RefreshCw className="h-3 w-3" />
                        </Button>
                        {compact && (
                            <Button variant="ghost" size="icon" onClick={() => setExpanded(false)} className="h-8 w-8">
                                <ChevronUp className="h-3 w-3" />
                            </Button>
                        )}
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                                x
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Analysis Summary */}
                {context.analysis_summary && (
                    <p className="text-sm text-muted-foreground">
                        {context.analysis_summary}
                    </p>
                )}

                {/* Known Source Interests */}
                {hasKnownInterests && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span>Source Interests</span>
                        </div>
                        <div className="pl-6 space-y-1 text-sm">
                            {context.known_interests.parent_company && (
                                <p className="text-muted-foreground">
                                    Owner: <span className="text-foreground">{context.known_interests.parent_company}</span>
                                </p>
                            )}
                            {context.known_interests.owner && (
                                <p className="text-muted-foreground">
                                    Controlled by: <span className="text-foreground">{context.known_interests.owner}</span>
                                </p>
                            )}
                            {context.known_interests.owner_interests && (
                                <p className="text-muted-foreground">
                                    Interests: <span className="text-foreground">
                                        {context.known_interests.owner_interests.slice(0, 3).join(", ")}
                                    </span>
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Trade Relationships */}
                {context.trade_relationships && context.trade_relationships.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span>Trade Relationships</span>
                        </div>
                        <div className="space-y-2">
                            {context.trade_relationships.slice(0, 3).map((trade, i) => (
                                <div key={i} className="p-2 rounded bg-muted/50 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium">{trade.country_pair}</span>
                                        {trade.relationship && (
                                            <Badge variant="outline" className="text-xs">
                                                {trade.relationship}
                                            </Badge>
                                        )}
                                    </div>
                                    {trade.key_sectors && trade.key_sectors.length > 0 && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Sectors: {trade.key_sectors.join(", ")}
                                        </p>
                                    )}
                                    {trade.tension_areas && trade.tension_areas.length > 0 && (
                                        <p className="text-xs text-orange-400 mt-1">
                                            Tensions: {trade.tension_areas.join(", ")}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Potential Conflicts */}
                {hasConflicts && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-orange-400">
                            <AlertTriangle className="h-4 w-4" />
                            <span>Potential Conflicts of Interest</span>
                        </div>
                        <ul className="space-y-1 pl-6">
                            {context.potential_conflicts.map((conflict, i) => (
                                <li key={i} className="text-sm text-muted-foreground list-disc">
                                    {conflict}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Reader Warnings */}
                {hasWarnings && (
                    <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                        <div className="flex items-center gap-2 text-sm font-medium text-orange-400 mb-2">
                            <AlertCircle className="h-4 w-4" />
                            <span>Reader Advisory</span>
                        </div>
                        <ul className="space-y-1">
                            {(context.reader_warnings ?? []).map((warning, i) => (
                                <li key={i} className="text-sm text-muted-foreground">
                                    {warning}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* No issues found */}
                {!hasConflicts && !hasWarnings && !hasKnownInterests && !context.trade_relationships?.length && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                        No significant material interests identified
                    </p>
                )}
            </CardContent>
        </Card>
    )
}
