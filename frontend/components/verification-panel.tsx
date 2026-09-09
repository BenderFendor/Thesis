"use client";
import { hasText } from "@/lib/utils";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConfidenceBadge, ConfidenceBar } from "./confidence-badge";
import type { SourceInfo, VerificationResult, VerifiedClaim } from "@/lib/verification";
import { formatConfidence, getConfidenceColor, verifyResearch } from "@/lib/verification";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { logger } from "@/lib/logger";

interface VerificationPanelProps {
  readonly query: string;
  readonly mainAnswer: string;
  readonly onVerificationComplete?: (result: DeepReadonly<VerificationResult>) => void;
  readonly className?: string;
}

type ReadonlySourceInfo = DeepReadonly<SourceInfo>;
type ReadonlyVerifiedClaim = DeepReadonly<VerifiedClaim>;
type ReadonlyVerificationResult = DeepReadonly<VerificationResult>;

const VerificationPanel = ({
  query,
  mainAnswer,
  onVerificationComplete,
  className = "",
}: VerificationPanelProps) => {
  const [isOpen, setIsOpen] = useState(false),
    [isLoading, setIsLoading] = useState(false),
    [result, setResult] = useState<VerificationResult | null>(null),
    [error, setError] = useState<string | null>(null),
    [expandedClaims, setExpandedClaims] = useState<Set<string>>(new Set()),
    handleOpenChange = useCallback((open: boolean) => {
      setIsOpen(open);
    }, []),
    runVerification = useCallback(async () => {
      if (!mainAnswer || mainAnswer.length < 50) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const verificationResult = await verifyResearch({
          main_answer: mainAnswer,
          query,
        });

        setResult(verificationResult);
        onVerificationComplete?.(verificationResult);

        if (hasText(verificationResult.error)) {
          setError(verificationResult.error);
        }
      } catch (verificationError) {
        const message =
          (() => {
  if (verificationError instanceof Error) {
    return verificationError.message;
  }
  return "Verification failed";
})();
        setError(message);
        logger.error("Verification failed", { error: verificationError });
      } finally {
        setIsLoading(false);
      }
    }, [query, mainAnswer, onVerificationComplete]),
    handleRunVerification = useCallback(() => {
      void runVerification();
    }, [runVerification]),
    toggleClaim = useCallback((claimId: string) => {
      setExpandedClaims((prev) => {
        const next = new Set(prev);
        if (next.has(claimId)) {
          next.delete(claimId);
        } else {
          next.add(claimId);
        }
        return next;
      });
    }, [setExpandedClaims]);

  return (
    <div className={`border rounded-lg bg-card ${className}`}>
      <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full flex items-center justify-between p-4 h-auto">
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
              {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            {(() => {
  if (isOpen) {
    return <ChevronUp className="w-4 h-4" />;
  }
  return <ChevronDown className="w-4 h-4" />;
})()}
          </Button>
        </CollapsibleTrigger>
        <VerificationPanelContent
          error={error}
          expandedClaims={expandedClaims}
          isLoading={isLoading}
          mainAnswer={mainAnswer}
          onRunVerification={handleRunVerification}
          onToggleClaim={toggleClaim}
          result={result}
        />
      </Collapsible>
    </div>
  );
};

interface VerificationPanelContentProps {
  readonly error: string | null;
  readonly expandedClaims: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly mainAnswer: string;
  readonly onRunVerification: () => void;
  readonly onToggleClaim: (claimId: string) => void;
  readonly result: ReadonlyVerificationResult | null;
}

const VerificationPanelContent = ({
  error,
  expandedClaims,
  isLoading,
  mainAnswer,
  onRunVerification,
  onToggleClaim,
  result,
}: Readonly<VerificationPanelContentProps>) => {
  const hasContent = result !== null && result.verified_claims.length > 0;
  return (
    <CollapsibleContent>
      <div className="px-4 pb-4 space-y-4">
        {!result && !isLoading && !hasText(error) && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              Verify claims in the research response
            </p>
            <Button
              onClick={onRunVerification}
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
            <span className="ml-2 text-sm text-muted-foreground">Verifying claims...</span>
          </div>
        )}
        {hasText(error) && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md text-destructive text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {hasContent && result !== null && (
          <VerificationResults
            expandedClaims={expandedClaims}
            isLoading={isLoading}
            onRunVerification={onRunVerification}
            onToggleClaim={onToggleClaim}
            result={result}
          />
        )}
      </div>
    </CollapsibleContent>
  );
};

const VerificationResults = ({
  expandedClaims,
  isLoading,
  onRunVerification,
  onToggleClaim,
  result,
}: {
  readonly expandedClaims: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly onRunVerification: () => void;
  readonly onToggleClaim: (claimId: string) => void;
  readonly result: ReadonlyVerificationResult;
}) => {
  const claimCount = result.verified_claims.length,
    sourceCount = Object.keys(result.sources).length;
  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Overall Confidence</span>
          <Button variant="ghost" size="sm" onClick={onRunVerification} disabled={isLoading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${(() => {
  if (isLoading) {
    return "animate-spin";
  }
  return "";
})()}`} />
            Refresh
          </Button>
        </div>
        <ConfidenceBar
          confidence={result.overall_confidence}
          level={result.overall_confidence_level}
        />
        <p className="text-xs text-muted-foreground">
          {claimCount} claim{(() => {
  if (claimCount === 1) {
    return "";
  }
  return "s";
})()} verified from {sourceCount} source
          {(() => {
  if (sourceCount === 1) {
    return "";
  }
  return "s";
})()} in {result.duration_ms}ms
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
              onToggle={onToggleClaim}
            />
          ))}
        </div>
      </ScrollArea>
    </>
  );
};

interface ClaimCardProps {
  readonly claim: ReadonlyVerifiedClaim;
  readonly sources: Readonly<Record<string, ReadonlySourceInfo>>;
  readonly isExpanded: boolean;
  readonly onToggle: (claimId: string) => void;
}

const ClaimCard = ({ claim, sources, isExpanded, onToggle }: Readonly<ClaimCardProps>) => {
  const colorClass = getConfidenceColor(claim.confidence_level);
  const allSourceIds = [...claim.supporting_sources, ...claim.conflicting_sources];
  const claimSources = allSourceIds
      .map((id) => sources[id])
      .filter((source): source is ReadonlySourceInfo => source !== undefined);
  const handleToggle = useCallback(() => {
      onToggle(claim.id);
    }, [claim.id, onToggle]);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={handleToggle}
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
            {(() => {
  if (isExpanded) {
    return <ChevronUp className="w-4 h-4 text-muted-foreground" />;
  }
  return <ChevronDown className="w-4 h-4 text-muted-foreground" />;
})()}
          </div>
        </div>
        {claim.needs_recheck && hasText(claim.recheck_reason) && (
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
};

interface SourceCardProps {
  readonly source: ReadonlySourceInfo;
}

const SourceCard = ({ source }: Readonly<SourceCardProps>) => {
  const supportColor = (() => {
  if (source.supports_claim) {
    return "text-green-600 dark:text-green-400";
  }
  return "text-red-600 dark:text-red-400";
})(),
    supportText = (() => {
  if (source.supports_claim) {
    return "Supports";
  }
  return "Contradicts";
})();

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2 rounded bg-background hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-1">{source.title ?? source.domain}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{source.domain}</span>
            <span>|</span>
            <span className={supportColor}>{supportText}</span>
            <span>|</span>
            <span>{formatConfidence(source.credibility_score)} credibility</span>
          </div>
          {hasText(source.excerpt) && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{source.excerpt}</p>
          )}
        </div>
        <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      </div>
    </a>
  );
};

// Simple toggle button for triggering verification

export { VerificationPanel };
