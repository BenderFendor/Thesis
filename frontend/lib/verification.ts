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
import { API_BASE_URL } from "./api";

export type { ConfidenceLevel, SourceInfo, VerifiedClaim, VerificationResult } from "@/lib/types/verification";

/**
 * Verify claims from research output.
 */
const verifyResearch = async (
  request: VerificationRequest,
  signal?: AbortSignal
): Promise<VerificationResult> => {
  const response = await fetch(`${API_BASE_URL}/api/verification/verify`, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Verification failed: ${error}`);
  }
  
  return response.json();
}

// --- Helpers ---

/**
 * Get display color class for confidence level.
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
}

/**
 * Get background color class for confidence level.
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
}

/**
 * Get label for confidence level.
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
}

/**
 * Format confidence as percentage string.
 */
const formatConfidence = (confidence: number): string => 
  `${Math.round(confidence * 100)}%`

export { verifyResearch, getConfidenceColor, getConfidenceBgColor, getConfidenceLabel, formatConfidence };
