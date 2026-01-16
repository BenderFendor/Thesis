"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfidenceBadge, ConfidenceBar } from "./confidence-badge";
import {
  VerificationResult,
  VerifiedClaim,
  SourceInfo,
  verifyResearch,
  getConfidenceColor,
  getConfidenceLabel,
  formatConfidence,
} from "@/lib/verification";
import { logger } from "@/lib/logger";

interface VerificationPanelProps {
  query: string;
  mainAnswer: string;
  onVerificationComplete?: (result: VerificationResult) => void;
  autoVerify?: boolean;
  className?: string;
}

export function VerificationPanel({
  query,
  mainAnswer,
  onVerificationComplete,
  autoVerify = false,
  className = "",
}: VerificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedClaims, setExpandedClaims] = useState<Set<string>>(new Set());

  const runVerification = useCallback(async () => {
    if (!mainAnswer || mainAnswer.length < 50) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const verificationResult = await verifyResearch({
        query,
        main_answer: mainAnswer,
      });

      setResult(verificationResult);
      onVerificationComplete?.(verificationResult);

      if (verificationResult.error) {
        setError(verificationResult.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      setError(message);
      logger.error("Verification failed", { error: err });
    } finally {
      setIsLoading(false);
    }
  }, [query, mainAnswer, onVerificationComplete]);

  useEffect(() => {
    if (autoVerify && mainAnswer && mainAnswer.length >= 50 && !result && !isLoading) {
      runVerification();
    }
  }, [autoVerify, mainAnswer, result, isLoading, runVerification]);

  const toggleClaim = (claimId: string) => {
    setExpandedClaims((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) {
        next.delete(claimId);
      } else {
        next.add(claimId);
      }
      return next;
    });
  };

  const hasContent = result && result.verified_claims.length > 0;

  return (
    <div className={`border rounded-lg bg-card ${className}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 h-auto"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <span className="font-medium">Verification</span>
              {result && (
                <ConfidenceBadge
                  confidence={result.overall_confidence}
                  level={result.overall_confidence_level}
                  claimCount={result.verified_claims.length}
                  sourceCount={Object.keys(result.sources).length}
                  size="sm"
                />
              )}
              {isLoading && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {isOpen ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            {!result && !isLoading && !error && (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-3">
                  Verify claims in the research response
                </p>
                <Button
                  onClick={runVerification}
                  disabled={!mainAnswer || mainAnswer.length < 50}
                  size="sm"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Run Verification
                </Button>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Verifying claims...
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md text-destructive text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {hasContent && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Overall Confidence</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={runVerification}
                      disabled={isLoading}
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  </div>
                  <ConfidenceBar
                    confidence={result.overall_confidence}
                    level={result.overall_confidence_level}
                  />
                  <p className="text-xs text-muted-foreground">
                    {result.verified_claims.length} claim
                    {result.verified_claims.length !== 1 ? "s" : ""} verified from{" "}
                    {Object.keys(result.sources).length} source
                    {Object.keys(result.sources).length !== 1 ? "s" : ""} in{" "}
                    {result.duration_ms}ms
                  </p>
                </div>

                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2">
                    {result.verified_claims.map((claim) => (
                      <ClaimCard
                        key={claim.id}
                        claim={claim}
                        sources={result.sources}
                        isExpanded={expandedClaims.has(claim.id)}
                        onToggle={() => toggleClaim(claim.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface ClaimCardProps {
  claim: VerifiedClaim;
  sources: Record<string, SourceInfo>;
  isExpanded: boolean;
  onToggle: () => void;
}

function ClaimCard({ claim, sources, isExpanded, onToggle }: ClaimCardProps) {
  const colorClass = getConfidenceColor(claim.confidence_level);
  const allSourceIds = [...claim.supporting_sources, ...claim.conflicting_sources];
  const claimSources = allSourceIds
    .map((id) => sources[id])
    .filter(Boolean);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm line-clamp-2">{claim.claim_text}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs font-medium ${colorClass}`}>
              {formatConfidence(claim.confidence)}
            </span>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
        {claim.needs_recheck && claim.recheck_reason && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
            {claim.recheck_reason}
          </p>
        )}
      </button>

      {isExpanded && claimSources.length > 0 && (
        <div className="border-t bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Sources ({claimSources.length})
          </p>
          {claimSources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SourceCardProps {
  source: SourceInfo;
}

function SourceCard({ source }: SourceCardProps) {
  const supportText = source.supports_claim ? "Supports" : "Contradicts";
  const supportColor = source.supports_claim
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2 rounded bg-background hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-1">
            {source.title || source.domain}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{source.domain}</span>
            <span>|</span>
            <span className={supportColor}>{supportText}</span>
            <span>|</span>
            <span>{formatConfidence(source.credibility_score)} credibility</span>
          </div>
          {source.excerpt && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {source.excerpt}
            </p>
          )}
        </div>
        <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      </div>
    </a>
  );
}

// Simple toggle button for triggering verification
interface VerificationToggleProps {
  onClick: () => void;
  isLoading: boolean;
  hasResult: boolean;
  confidence?: number;
  className?: string;
}

export function VerificationToggle({
  onClick,
  isLoading,
  hasResult,
  confidence,
  className = "",
}: VerificationToggleProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isLoading}
      className={className}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Verifying...
        </>
      ) : hasResult && confidence !== undefined ? (
        <>
          <Shield className="w-3 h-3 mr-1" />
          {formatConfidence(confidence)}
        </>
      ) : (
        <>
          <Shield className="w-3 h-3 mr-1" />
          Verify
        </>
      )}
    </Button>
  );
}
