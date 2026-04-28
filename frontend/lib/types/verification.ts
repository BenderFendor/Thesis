import type { components as OpenApiComponents } from "@/lib/generated/openapi"

type VerificationRequestSchema = OpenApiComponents["schemas"]["VerificationRequest"]
type VerificationResultSchema = OpenApiComponents["schemas"]["VerificationResult"]
type VerifiedClaimSchema = OpenApiComponents["schemas"]["VerifiedClaim"]

export type ConfidenceLevel = OpenApiComponents["schemas"]["ConfidenceLevel"]
export type SourceType = OpenApiComponents["schemas"]["SourceType"]
export type SourceInfo =
  OpenApiComponents["schemas"]["app__models__verification__SourceInfo"]

export interface VerifiedClaim
  extends Omit<
    VerifiedClaimSchema,
    "confidence_level" | "supporting_sources" | "conflicting_sources" | "footnotes"
  > {
  confidence_level: ConfidenceLevel
  supporting_sources: string[]
  conflicting_sources: string[]
  footnotes: number[]
}

export interface VerificationResult
  extends Omit<
    VerificationResultSchema,
    "overall_confidence_level" | "verified_claims" | "sources"
  > {
  overall_confidence_level: ConfidenceLevel
  verified_claims: VerifiedClaim[]
  sources: Record<string, SourceInfo>
}

export interface VerificationRequest
  extends Omit<VerificationRequestSchema, "main_answer" | "previous_claims"> {
  main_answer: string
  previous_claims?: VerifiedClaim[]
}

export interface VerificationStatus {
  enabled: boolean
  max_duration_seconds: number
  max_claims: number
  max_sources_per_claim: number
  cache_ttl_hours: number
  recheck_threshold: number
  allowed_domains_count: number
}

export interface VerificationSummary {
  summary: {
    overall_confidence: number
    overall_level: ConfidenceLevel
    total_claims: number
    high_confidence: number
    medium_confidence: number
    low_confidence: number
    total_sources: number
  }
  claims: Array<{
    id: string
    text: string
    confidence: number
    level: ConfidenceLevel
    supporting_sources: string[]
    conflicting_sources: string[]
    needs_recheck: boolean
    recheck_reason: string | null
  }>
  sources: Record<
    string,
    {
      id: string
      url: string
      title: string | null
      domain: string
      credibility: number
      type: string
      supports_claim: boolean
      excerpt: string | null
    }
  >
}

export type VerificationStreamEvent =
  | { type: "started"; query: string }
  | { type: "claim"; claim: VerifiedClaim; progress: number }
  | { type: "complete"; result: VerificationResult }
  | { type: "error"; content: string }
