import type { components as OpenApiComponents } from "@/lib/generated/openapi";

type VerificationRequestSchema = OpenApiComponents["schemas"]["VerificationRequest"];
type VerificationResultSchema = OpenApiComponents["schemas"]["VerificationResult"];
type VerifiedClaimSchema = OpenApiComponents["schemas"]["VerifiedClaim"];

type ConfidenceLevel = OpenApiComponents["schemas"]["ConfidenceLevel"];

type SourceInfo = OpenApiComponents["schemas"]["app__models__verification__SourceInfo"];

interface VerifiedClaim extends Omit<
  VerifiedClaimSchema,
  "confidence_level" | "supporting_sources" | "conflicting_sources" | "footnotes"
> {
  confidence_level: ConfidenceLevel;
  supporting_sources: string[];
  conflicting_sources: string[];
  footnotes: number[];
}

interface VerificationResult extends Omit<
  VerificationResultSchema,
  "overall_confidence_level" | "verified_claims" | "sources"
> {
  overall_confidence_level: ConfidenceLevel;
  verified_claims: VerifiedClaim[];
  sources: Record<string, SourceInfo>;
}

interface VerificationRequest extends Omit<
  VerificationRequestSchema,
  "main_answer" | "previous_claims"
> {
  main_answer: string;
  previous_claims?: VerifiedClaim[];
}

export type { ConfidenceLevel, SourceInfo, VerifiedClaim, VerificationResult, VerificationRequest };
