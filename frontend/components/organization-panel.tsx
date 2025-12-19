"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
    Building2,
    DollarSign,
    Users,
    ExternalLink,
    RefreshCw,
    AlertTriangle,
    CheckCircle,
    HelpCircle,
    ChevronRight,
    Globe
} from "lucide-react"
import { researchOrganization, getOwnershipChain, type OrganizationProfile, type OwnershipChain } from "@/lib/api"

interface OrganizationPanelProps {
    organizationName: string
    website?: string
    onClose?: () => void
    showOwnershipChain?: boolean
    compact?: boolean
}

const FUNDING_TYPE_COLORS: Record<string, string> = {
    "public": "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "commercial": "bg-green-500/20 text-green-400 border-green-500/30",
    "non-profit": "bg-primary/15 text-primary border-primary/30",
    "state-funded": "bg-red-500/20 text-red-400 border-red-500/30",
    "independent": "bg-gray-500/20 text-gray-400 border-gray-500/30",
}

const BIAS_COLORS: Record<string, string> = {
    "left": "bg-blue-500/20 text-blue-400",
    "center-left": "bg-sky-500/20 text-sky-400",
    "center": "bg-gray-500/20 text-gray-400",
    "center-right": "bg-orange-500/20 text-orange-400",
    "right": "bg-red-500/20 text-red-400",
}

const FACTUAL_COLORS: Record<string, string> = {
    "very-high": "bg-primary/15 text-primary",
    "high": "bg-green-500/20 text-green-400",
    "mixed": "bg-yellow-500/20 text-yellow-400",
    "low": "bg-orange-500/20 text-orange-400",
    "very-low": "bg-red-500/20 text-red-400",
}

const CONFIDENCE_ICONS: Record<string, React.ElementType> = {
    "high": CheckCircle,
    "medium": HelpCircle,
    "low": AlertTriangle,
}

export function OrganizationPanel({
    organizationName,
    website,
    onClose,
    showOwnershipChain = true,
    compact = false
}: OrganizationPanelProps) {
    const [forceRefresh, setForceRefresh] = useState(false)
    const [showChain, setShowChain] = useState(false)
    const [expanded, setExpanded] = useState(!compact)
    const [localCompact, setLocalCompact] = useState(compact)

    const { data: org, isLoading, error, refetch } = useQuery({
        queryKey: ["organization-research", organizationName, forceRefresh],
        queryFn: () => researchOrganization(organizationName, website, forceRefresh),
        staleTime: 1000 * 60 * 60, // 1 hour
        retry: 1,
    })

    const { data: ownershipChain, isLoading: chainLoading } = useQuery({
        queryKey: ["ownership-chain", organizationName],
        queryFn: () => getOwnershipChain(organizationName),
        enabled: showChain && showOwnershipChain,
        staleTime: 1000 * 60 * 60,
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
                {!compact && (
                    <CardContent className="space-y-4">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                    </CardContent>
                )}
            </Card>
        )
    }

    if (error) {
        if (compact) return null // Don't show error card in sidebar to save space
        return (
            <Card className="w-full max-w-md border-red-500/30">
                <CardContent className="pt-6">
                    <div className="flex items-center gap-2 text-red-400">
                        <AlertTriangle className="h-5 w-5" />
                        <p>Failed to load organization data</p>
                    </div>
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                        Retry
                    </Button>
                </CardContent>
            </Card>
        )
    }

    if (!org) return null

    const ConfidenceIcon = CONFIDENCE_ICONS[org.research_confidence || "low"] || HelpCircle
    const fundingColor = FUNDING_TYPE_COLORS[org.funding_type || ""] || "bg-muted"
    const biasColor = BIAS_COLORS[org.media_bias_rating || ""] || ""
    const factualColor = FACTUAL_COLORS[org.factual_reporting || ""] || ""

    // Compact mode - just show a summary bar that expands
    if (compact && !expanded) {
        return (
            <div
                className="flex items-center gap-2 p-2 rounded-lg cursor-pointer bg-muted/50 hover:bg-muted transition-colors"
                onClick={() => setExpanded(true)}
            >
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium truncate flex-1">{org.name}</span>
                {org.funding_type && (
                    <Badge variant="outline" className="text-[10px] px-1 h-5">
                        {org.funding_type}
                    </Badge>
                )}
                {org.media_bias_rating && (
                    <Badge variant="outline" className={`text-[10px] px-1 h-5 ${biasColor.replace('bg-', 'text-').split(' ')[0]}`}>
                        {org.media_bias_rating}
                    </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
        )
    }

    return (
        <Card className="w-full">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-primary/10">
                            <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-lg leading-tight">{org.name}</CardTitle>
                            {org.parent_org && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Owned by: {org.parent_org}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh" className="h-8 w-8">
                            <RefreshCw className="h-3 w-3" />
                        </Button>
                        {compact && (
                            <Button variant="ghost" size="icon" onClick={() => setExpanded(false)} className="h-8 w-8">
                                <span className="sr-only">Collapse</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m18 15-6-6-6 6" /></svg>
                            </Button>
                        )}
                        {onClose && !compact && (
                            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                                x
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Funding Type */}
                {org.funding_type && (
                    <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Funding:</span>
                        <Badge className={fundingColor}>
                            {org.funding_type}
                        </Badge>
                    </div>
                )}

                {/* Bias and Factual Reporting */}
                <div className="flex flex-wrap gap-2">
                    {org.media_bias_rating && (
                        <Badge className={biasColor}>
                            Bias: {org.media_bias_rating}
                        </Badge>
                    )}
                    {org.factual_reporting && (
                        <Badge className={factualColor}>
                            Factual: {org.factual_reporting}
                        </Badge>
                    )}
                </div>

                {/* Financial Info */}
                {org.annual_revenue && (
                    <div className="text-sm border-t border-border pt-2">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Revenue:</span>
                            <span className="font-medium">${Number(org.annual_revenue).toLocaleString()}</span>
                        </div>
                        {org.ein && (
                            <div className="flex justify-between mt-1">
                                <span className="text-muted-foreground">EIN:</span>
                                <span className="font-mono text-xs">{org.ein}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Ownership Chain Toggle */}
                {showOwnershipChain && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-8"
                        onClick={() => setShowChain(!showChain)}
                    >
                        <Users className="h-3 w-3 mr-2" />
                        {showChain ? "Hide" : "Show"} Ownership Chain
                    </Button>
                )}

                {/* Ownership Chain */}
                {showChain && ownershipChain && (
                    <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-2">Ownership Structure</p>
                        {chainLoading ? (
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-3/4" />
                            </div>
                        ) : (
                            <div className="space-y-1 pl-1 border-l-2 border-primary/20">
                                {ownershipChain.chain.map((link, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm">
                                        {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                        <span className={i === 0 ? "font-semibold text-primary" : ""}>
                                            {link.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* External Links */}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                    {org.wikipedia_url && (
                        <a
                            href={org.wikipedia_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 px-2 hover:bg-muted rounded-md transition-colors flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                            <Globe className="h-3 w-3" />
                            Wikipedia
                        </a>
                    )}
                    {website && (
                        <a
                            href={website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 px-2 hover:bg-muted rounded-md transition-colors flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Website
                        </a>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
