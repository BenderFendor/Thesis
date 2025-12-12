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
}

const FUNDING_TYPE_COLORS: Record<string, string> = {
    "public": "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "commercial": "bg-green-500/20 text-green-400 border-green-500/30",
    "non-profit": "bg-purple-500/20 text-purple-400 border-purple-500/30",
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
    "very-high": "bg-emerald-500/20 text-emerald-400",
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
    showOwnershipChain = true
}: OrganizationPanelProps) {
    const [forceRefresh, setForceRefresh] = useState(false)
    const [showChain, setShowChain] = useState(false)

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
                <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <div className="flex gap-2">
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-6 w-16" />
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

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-primary/10">
                            <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">{org.name}</CardTitle>
                            {org.parent_org && (
                                <p className="text-sm text-muted-foreground">
                                    Owned by {org.parent_org}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh">
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                        {onClose && (
                            <Button variant="ghost" size="icon" onClick={onClose}>
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
                    <div className="text-sm">
                        <span className="text-muted-foreground">Annual Revenue: </span>
                        <span>${Number(org.annual_revenue).toLocaleString()}</span>
                    </div>
                )}

                {/* EIN for non-profits */}
                {org.ein && (
                    <div className="text-sm text-muted-foreground">
                        EIN: {org.ein} (Non-profit)
                    </div>
                )}

                {/* Ownership Chain Toggle */}
                {showOwnershipChain && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setShowChain(!showChain)}
                    >
                        <Users className="h-4 w-4 mr-2" />
                        {showChain ? "Hide" : "Show"} Ownership Chain
                    </Button>
                )}

                {/* Ownership Chain */}
                {showChain && ownershipChain && (
                    <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-2">Ownership Chain</p>
                        {chainLoading ? (
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-3/4" />
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {ownershipChain.chain.map((link, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm">
                                        {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                        <span className={i === 0 ? "font-medium" : ""}>
                                            {link.name}
                                        </span>
                                        {link.funding_type && (
                                            <Badge variant="outline" className="text-xs">
                                                {link.funding_type}
                                            </Badge>
                                        )}
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
                            className="p-2 hover:bg-muted rounded-md transition-colors flex items-center gap-1 text-sm"
                        >
                            <Globe className="h-4 w-4" />
                            Wikipedia
                        </a>
                    )}
                    {website && (
                        <a
                            href={website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-muted rounded-md transition-colors flex items-center gap-1 text-sm"
                        >
                            <ExternalLink className="h-4 w-4" />
                            Website
                        </a>
                    )}
                </div>

                {/* Research Metadata */}
                <div className="text-xs text-muted-foreground flex items-center justify-between pt-2 border-t border-border">
                    <span className="flex items-center gap-1">
                        <ConfidenceIcon className="h-3 w-3" />
                        {org.research_confidence || "unknown"} confidence
                    </span>
                    <span>
                        {org.cached ? "Cached" : "Fresh"} |
                        Sources: {org.research_sources?.join(", ") || "none"}
                    </span>
                </div>
            </CardContent>
        </Card>
    )
}
