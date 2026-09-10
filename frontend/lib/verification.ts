/**
 * Verification API client
 *
 * Handles communication with the verification agent backend.
 */

import type {
  ConfidenceLevel,
  VerificationRequest,
  VerificationResult,
} from "@/lib/types/verification";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { api } from "./api";
import { z } from "zod";

// --- API Functions ---

const VerificationSourceSchema = z
  .object({
    credibility_score: z.number(),
    domain: z.string(),
    excerpt: z.string().nullable().optional(),
    id: z.string(),
    published_at: z.string().nullable().optional(),
    source_type: z.enum([
      "wire",
      "newspaper",
      "magazine",
      "broadcast",
      "nonprofit",
      "fact_checker",
      "government",
      "academic",
      "blog",
      "social",
      "unknown",
    ]),
    supports_claim: z.boolean(),
    title: z.string().nullable().optional(),
    url: z.string(),
  })
  .passthrough();

const VerifiedClaimSchema = z
  .object({
    claim_text: z.string(),
    confidence: z.number(),
    confidence_level: z.enum(["high", "medium", "low", "very_low"]),
    conflicting_sources: z.array(z.string()).default([]),
    footnotes: z.array(z.number()).default([]),
    id: z.string(),
    needs_recheck: z.boolean(),
    recheck_reason: z.string().nullable().optional(),
    supporting_sources: z.array(z.string()).default([]),
  })
  .passthrough();

const VerificationResultSchema = z
  .object({
    duration_ms: z.number(),
    error: z.string().nullable().optional(),
    generated_at: z.string().optional(),
    markdown_report: z.string(),
    overall_confidence: z.number(),
    overall_confidence_level: z.enum(["high", "medium", "low", "very_low"]),
    query: z.string(),
    sources: z.record(z.string(), VerificationSourceSchema).default({}),
    verified_claims: z.array(VerifiedClaimSchema).default([]),
  })
  .passthrough();

/**
 * Verify claims from research output.
 * @param {DeepReadonly<VerificationRequest>} request Research output to verify.
 * @param {AbortSignal} [signal] Optional cancellation signal.
 * @returns {Promise<VerificationResult>} The verification result.
 */
const verifyResearch = async (
  request: DeepReadonly<VerificationRequest>,
  signal?: AbortSignal,
): Promise<VerificationResult> =>
  api("/api/verification/verify", VerificationResultSchema, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });

// --- Helpers ---

/**
 * @param {ConfidenceLevel} level Confidence level.
 * @returns {string} Display color class.
 */
const getConfidenceColor = (level: ConfidenceLevel): string => {
  switch (level) {
    case "high": {
      return "text-green-600 dark:text-green-400";
    }
    case "medium": {
      return "text-yellow-600 dark:text-yellow-400";
    }
    case "low": {
      return "text-orange-600 dark:text-orange-400";
    }
    case "very_low": {
      return "text-red-600 dark:text-red-400";
    }
    default: {
      return "text-gray-600 dark:text-gray-400";
    }
  }
};

/**
 * @param {ConfidenceLevel} level Confidence level.
 * @returns {string} Display background class.
 */
const getConfidenceBgColor = (level: ConfidenceLevel): string => {
  switch (level) {
    case "high": {
      return "bg-green-500/15 border-green-500/40";
    }
    case "medium": {
      return "bg-yellow-500/15 border-yellow-500/40";
    }
    case "low": {
      return "bg-orange-500/15 border-orange-500/40";
    }
    case "very_low": {
      return "bg-red-500/15 border-red-500/40";
    }
    default: {
      return "bg-gray-500/15 border-gray-500/40";
    }
  }
};

/**
 * @param {ConfidenceLevel} level Confidence level.
 * @returns {string} Display label.
 */
const getConfidenceLabel = (level: ConfidenceLevel): string => {
  switch (level) {
    case "high": {
      return "High";
    }
    case "medium": {
      return "Medium";
    }
    case "low": {
      return "Low";
    }
    case "very_low": {
      return "Very Low";
    }
    default: {
      return "Unknown";
    }
  }
};

/**
 * @param {number} confidence Confidence from zero to one.
 * @returns {string} Percentage text.
 */
const formatConfidence = (confidence: number): string => `${Math.round(confidence * 100)}%`;

export {
  verifyResearch,
  getConfidenceColor,
  getConfidenceBgColor,
  getConfidenceLabel,
  formatConfidence,
};
export type {
  ConfidenceLevel,
  SourceInfo,
  VerifiedClaim,
  VerificationResult,
} from "@/lib/types/verification";
