import type { components as OpenApiComponents } from "@/lib/generated/openapi"

type VerificationRequestSchema = OpenApiComponents["schemas"]["VerificationRequest"]
type VerificationResultSchema = OpenApiComponents["schemas"]["VerificationResult"]
type VerifiedClaimSchema = OpenApiComponents["schemas"]["VerifiedClaim"]

type ConfidenceLevel = OpenApiComponents["schemas"]["ConfidenceLevel"]
type SourceType = OpenApiComponents["schemas"]["SourceType"]
type SourceInfo =
  OpenApiComponents["schemas"]["app__models__verification__SourceInfo"]

interface VerifiedClaim
  extends Omit<
    VerifiedClaimSchema,
    "confidence_level" | "supporting_sources" | "conflicting_sources" | "footnotes"
  > {
  confidence_level: ConfidenceLevel
  supporting_sources: string[]
  conflicting_sources: string[]
  footnotes: number[]
}

interface VerificationResult
  extends Omit<
    VerificationResultSchema,
    "overall_confidence_level" | "verified_claims" | "sources"
  > {
  overall_confidence_level: ConfidenceLevel
  verified_claims: VerifiedClaim[]
  sources: Record<string, SourceInfo>
}

interface VerificationRequest
  extends Omit<VerificationRequestSchema, "main_answer" | "previous_claims"> {
  main_answer: string
  previous_claims?: VerifiedClaim[]
}

interface VerificationStatus {
  enabled: boolean
  max_duration_seconds: number
  max_claims: number
  max_sources_per_claim: number
  cache_ttl_hours: number
  recheck_threshold: number
  allowed_domains_count: number
}

interface VerificationSummary {
  summary: {
    overall_confidence: number
    overall_level: ConfidenceLevel
    total_claims: number
    high_confidence: number
    medium_confidence: number
    low_confidence: number
    total_sources: number
  }
  claims: {
    id: string
    text: string
    confidence: number
    level: ConfidenceLevel
    supporting_sources: string[]
    conflicting_sources: string[]
    needs_recheck: boolean
    recheck_reason: string | null
  }[]
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

type VerificationStreamEvent =
  | { type: "started"; query: string }
  | { type: "claim"; claim: VerifiedClaim; progress: number }
  | { type: "complete"; result: VerificationResult }
   | { type: "error"; content: string }

export {
  ConfidenceLevel,
  SourceType,
  SourceInfo,
  VerifiedClaim,
  VerificationResult,
  VerificationRequest,
  VerificationStatus,
  VerificationSummary,
  VerificationStreamEvent,
}
