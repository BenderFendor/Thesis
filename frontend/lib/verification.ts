/**
 * Verification API client
 * 
 * Handles communication with the verification agent backend.
 */

import { API_BASE_URL } from "./api";
import { logger } from "./logger";
import type {
  ConfidenceLevel,
  VerificationRequest,
  VerificationResult,
  VerificationStatus,
  VerificationSummary,
  VerificationStreamEvent,
} from "@/lib/types/verification";
export type {
  ConfidenceLevel,
  SourceInfo,
  VerifiedClaim,
  VerificationRequest,
  VerificationResult,
  VerificationStatus,
  VerificationSummary,
  VerificationStreamEvent,
} from "@/lib/types/verification";

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
