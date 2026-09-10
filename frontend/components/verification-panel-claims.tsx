import { useCallback } from "react";
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfidenceBar } from "./confidence-badge";
import { formatConfidence, getConfidenceColor } from "@/lib/verification";
import type {
  ClaimCardProps,
  ReadonlySourceInfo,
  ReadonlyVerificationResult,
  SourceCardProps,
} from "./verification-panel-types";

const getPluralSuffix = (count: number): string => {
  if (count === 1) {
    return "";
  }
  return "s";
};

const VerificationRefreshButton = ({
  isLoading,
  onRunVerification,
}: Readonly<{ isLoading: boolean; onRunVerification: () => void }>) => (
  <Button variant="ghost" size="sm" onClick={onRunVerification} disabled={isLoading}>
    <RefreshCw className={getRefreshClassName(isLoading)} />
    Refresh
  </Button>
);

const getRefreshClassName = (isLoading: boolean): string => {
  if (isLoading) {
    return "w-3 h-3 mr-1 animate-spin";
  }
  return "w-3 h-3 mr-1";
};

const VerificationSummaryHeader = ({
  isLoading,
  onRunVerification,
}: Readonly<{ isLoading: boolean; onRunVerification: () => void }>) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium">Overall Confidence</span>
    <VerificationRefreshButton isLoading={isLoading} onRunVerification={onRunVerification} />
  </div>
);

const VerificationSummary = ({
  isLoading,
  onRunVerification,
  result,
}: Readonly<{
  readonly isLoading: boolean;
  readonly onRunVerification: () => void;
  readonly result: ReadonlyVerificationResult;
}>) => {
  const claimCount = result.verified_claims.length;
  const sourceCount = Object.keys(result.sources).length;
  return (
    <div className="space-y-2">
      <VerificationSummaryHeader isLoading={isLoading} onRunVerification={onRunVerification} />
      <ConfidenceBar
        confidence={result.overall_confidence}
        level={result.overall_confidence_level}
      />
      <p className="text-xs text-muted-foreground">
        {claimCount} claim{getPluralSuffix(claimCount)} verified from {sourceCount} source
        {getPluralSuffix(sourceCount)} in {result.duration_ms}ms
      </p>
    </div>
  );
};

const VerificationClaimListItems = ({
  expandedClaims,
  onToggleClaim,
  result,
}: Readonly<{
  readonly expandedClaims: ReadonlySet<string>;
  readonly onToggleClaim: (claimId: string) => void;
  readonly result: ReadonlyVerificationResult;
}>) => (
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
);

const VerificationClaimList = ({
  expandedClaims,
  onToggleClaim,
  result,
}: Readonly<{
  readonly expandedClaims: ReadonlySet<string>;
  readonly onToggleClaim: (claimId: string) => void;
  readonly result: ReadonlyVerificationResult;
}>) => (
  <ScrollArea className="max-h-[400px]">
    <VerificationClaimListItems
      expandedClaims={expandedClaims}
      onToggleClaim={onToggleClaim}
      result={result}
    />
  </ScrollArea>
);

const VerificationResults = ({
  expandedClaims,
  isLoading,
  onRunVerification,
  onToggleClaim,
  result,
}: Readonly<{
  readonly expandedClaims: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly onRunVerification: () => void;
  readonly onToggleClaim: (claimId: string) => void;
  readonly result: ReadonlyVerificationResult;
}>) => (
  <>
    <VerificationSummary
      isLoading={isLoading}
      onRunVerification={onRunVerification}
      result={result}
    />
    <VerificationClaimList
      expandedClaims={expandedClaims}
      onToggleClaim={onToggleClaim}
      result={result}
    />
  </>
);

const ClaimExpansionIcon = ({ isExpanded }: Readonly<{ isExpanded: boolean }>) => {
  if (isExpanded) {
    return <ChevronUp className="w-4 h-4 text-muted-foreground" />;
  }
  return <ChevronDown className="w-4 h-4 text-muted-foreground" />;
};

const ClaimHeaderText = ({ claim }: Readonly<Pick<ClaimCardProps, "claim">>) => (
  <div className="flex-1 min-w-0">
    <p className="text-sm line-clamp-2">{claim.claim_text}</p>
  </div>
);

const ClaimHeaderConfidence = ({
  claim,
  isExpanded,
}: Readonly<Pick<ClaimCardProps, "claim" | "isExpanded">>) => (
  <div className="flex items-center gap-2 flex-shrink-0">
    <span className={`text-xs font-medium ${getConfidenceColor(claim.confidence_level)}`}>
      {formatConfidence(claim.confidence)}
    </span>
    <ClaimExpansionIcon isExpanded={isExpanded} />
  </div>
);

const ClaimCardButton = ({
  claim,
  isExpanded,
  onToggle,
}: Readonly<Pick<ClaimCardProps, "claim" | "isExpanded" | "onToggle">>) => {
  const handleToggle = useCallback(() => {
    onToggle(claim.id);
  }, [claim.id, onToggle]);
  return (
    <button
      onClick={handleToggle}
      className="w-full p-3 text-left hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-2">
        <ClaimHeaderText claim={claim} />
        <ClaimHeaderConfidence claim={claim} isExpanded={isExpanded} />
      </div>
      <ClaimRecheckMessage claim={claim} />
    </button>
  );
};

const ClaimRecheckMessage = ({ claim }: Readonly<Pick<ClaimCardProps, "claim">>) => {
  if (!claim.needs_recheck || claim.recheck_reason === null || claim.recheck_reason === "") {
    return null;
  }
  return (
    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">{claim.recheck_reason}</p>
  );
};

const SourceCardMetadata = ({ source }: Readonly<Pick<SourceCardProps, "source">>) => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <span>{source.domain}</span>
    <span>|</span>
    <span className={getSupportColor(source.supports_claim)}>
      {getSupportText(source.supports_claim)}
    </span>
    <span>|</span>
    <span>{formatConfidence(source.credibility_score)} credibility</span>
  </div>
);

const getSupportColor = (supportsClaim: boolean): string => {
  if (supportsClaim) {
    return "text-green-600 dark:text-green-400";
  }
  return "text-red-600 dark:text-red-400";
};

const getSupportText = (supportsClaim: boolean): string => {
  if (supportsClaim) {
    return "Supports";
  }
  return "Contradicts";
};

const SourceCardSummary = ({ source }: Readonly<Pick<SourceCardProps, "source">>) => {
  if (source.excerpt === null || source.excerpt === "") {
    return null;
  }
  return <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{source.excerpt}</p>;
};

const SourceCardBody = ({ source }: Readonly<Pick<SourceCardProps, "source">>) => (
  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium line-clamp-1">{source.title ?? source.domain}</p>
    <SourceCardMetadata source={source} />
    <SourceCardSummary source={source} />
  </div>
);

const SourceCard = ({ source }: Readonly<SourceCardProps>) => (
  <a
    href={source.url}
    target="_blank"
    rel="noopener noreferrer"
    className="block p-2 rounded bg-background hover:bg-muted/50 transition-colors"
  >
    <SourceCardBody source={source} />
    <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
  </a>
);

const ClaimSources = ({ claim, sources }: Readonly<Pick<ClaimCardProps, "claim" | "sources">>) => {
  const sourceIds = [...claim.supporting_sources, ...claim.conflicting_sources];
  const claimSources = sourceIds
    .map((sourceId) => sources[sourceId])
    .filter((source): source is ReadonlySourceInfo => source !== undefined);
  if (claimSources.length === 0) {
    return null;
  }
  return (
    <div className="border-t bg-muted/30 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Sources ({claimSources.length})
      </p>
      {claimSources.map((source) => (
        <SourceCard key={source.id} source={source} />
      ))}
    </div>
  );
};

const ClaimCardDetails = (props: Readonly<Pick<ClaimCardProps, "claim" | "sources">>) => (
  <ClaimSources claim={props.claim} sources={props.sources} />
);

const ClaimCard = ({ claim, sources, isExpanded, onToggle }: Readonly<ClaimCardProps>) => (
  <div className="border rounded-md overflow-hidden">
    <ClaimCardButton claim={claim} isExpanded={isExpanded} onToggle={onToggle} />
    {isExpanded && <ClaimCardDetails claim={claim} sources={sources} />}
  </div>
);

export { VerificationResults };
