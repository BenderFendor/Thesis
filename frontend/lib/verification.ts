/**
 * Verification API client
 * 
 * Handles communication with the verification agent backend.
 */

import { API_BASE_URL } from "./api";
import { logger } from "./logger";

// --- Types ---

export type ConfidenceLevel = "high" | "medium" | "low" | "very_low";

export interface SourceInfo {
  id: string;
  url: string;
  title: string | null;
  domain: string;
  credibility_score: number;
  source_type: string;
  published_at: string | null;
  supports_claim: boolean;
  excerpt: string | null;
}

export interface VerifiedClaim {
  id: string;
  claim_text: string;
  confidence: number;
  confidence_level: ConfidenceLevel;
  supporting_sources: string[];
  conflicting_sources: string[];
  footnotes: number[];
  needs_recheck: boolean;
  recheck_reason: string | null;
}

export interface VerificationResult {
  query: string;
  overall_confidence: number;
  overall_confidence_level: ConfidenceLevel;
  verified_claims: VerifiedClaim[];
  sources: Record<string, SourceInfo>;
  markdown_report: string;
  generated_at: string;
  duration_ms: number;
  error: string | null;
}

export interface VerificationRequest {
  query: string;
  main_answer: string;
  main_findings?: Array<Record<string, unknown>>;
}

export interface VerificationStatus {
  enabled: boolean;
  max_duration_seconds: number;
  max_claims: number;
  max_sources_per_claim: number;
  cache_ttl_hours: number;
  recheck_threshold: number;
  allowed_domains_count: number;
}

export interface VerificationSummary {
  summary: {
    overall_confidence: number;
    overall_level: ConfidenceLevel;
    total_claims: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    total_sources: number;
  };
  claims: Array<{
    id: string;
    text: string;
    confidence: number;
    level: ConfidenceLevel;
    supporting_sources: string[];
    conflicting_sources: string[];
    needs_recheck: boolean;
    recheck_reason: string | null;
  }>;
  sources: Record<string, {
    id: string;
    url: string;
    title: string | null;
    domain: string;
    credibility: number;
    type: string;
    supports_claim: boolean;
    excerpt: string | null;
  }>;
}

// --- SSE Stream Event Types ---

export type VerificationStreamEvent =
  | { type: "started"; query: string }
  | { type: "claim"; claim: VerifiedClaim; progress: number }
  | { type: "complete"; result: VerificationResult }
  | { type: "error"; content: string };

// --- API Functions ---

/**
 * Check if verification is enabled and get configuration.
 */
export async function fetchVerificationStatus(): Promise<VerificationStatus> {
  const response = await fetch(`${API_BASE_URL}/api/verification/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch verification status: ${response.status}`);
  }
  return response.json();
}

/**
 * Verify claims from research output.
 */
export async function verifyResearch(
  request: VerificationRequest,
  signal?: AbortSignal
): Promise<VerificationResult> {
  const response = await fetch(`${API_BASE_URL}/api/verification/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Verification failed: ${error}`);
  }
  
  return response.json();
}

/**
 * Verify claims and get summary JSON response.
 */
export async function verifyResearchJson(
  request: VerificationRequest,
  signal?: AbortSignal
): Promise<VerificationSummary> {
  const response = await fetch(`${API_BASE_URL}/api/verification/verify/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Verification failed: ${error}`);
  }
  
  return response.json();
}

/**
 * Stream verification progress via SSE.
 */
export async function* streamVerification(
  request: VerificationRequest,
  signal?: AbortSignal
): AsyncGenerator<VerificationStreamEvent> {
  const response = await fetch(`${API_BASE_URL}/api/verification/verify/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  
  if (!response.ok) {
    throw new Error(`Verification stream failed: ${response.status}`);
  }
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }
  
  const decoder = new TextDecoder();
  let buffer = "";
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as VerificationStreamEvent;
            yield event;
          } catch (e) {
            logger.warn("Failed to parse SSE event", { line, error: e });
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Helpers ---

/**
 * Get display color class for confidence level.
 */
export function getConfidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "text-green-600 dark:text-green-400";
    case "medium":
      return "text-yellow-600 dark:text-yellow-400";
    case "low":
      return "text-orange-600 dark:text-orange-400";
    case "very_low":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-gray-600 dark:text-gray-400";
  }
}

/**
 * Get background color class for confidence level.
 */
export function getConfidenceBgColor(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "bg-green-500/15 border-green-500/40";
    case "medium":
      return "bg-yellow-500/15 border-yellow-500/40";
    case "low":
      return "bg-orange-500/15 border-orange-500/40";
    case "very_low":
      return "bg-red-500/15 border-red-500/40";
    default:
      return "bg-gray-500/15 border-gray-500/40";
  }
}

/**
 * Get label for confidence level.
 */
export function getConfidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "very_low":
      return "Very Low";
    default:
      return "Unknown";
  }
}

/**
 * Format confidence as percentage string.
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
