import type { VerificationResult, SourceInfo, VerifiedClaim } from "@/lib/verification";
import type { DeepReadonly } from "@/lib/deep-readonly";

type ReadonlySourceInfo = DeepReadonly<SourceInfo>;
type ReadonlyVerifiedClaim = DeepReadonly<VerifiedClaim>;
type ReadonlyVerificationResult = DeepReadonly<VerificationResult>;

interface VerificationPanelProps {
  readonly query: string;
  readonly mainAnswer: string;
  readonly onVerificationComplete?: (result: ReadonlyVerificationResult) => void;
  readonly className?: string;
}

interface VerificationPanelContentProps {
  readonly error: string | null;
  readonly expandedClaims: ReadonlySet<string>;
  readonly isLoading: boolean;
  readonly mainAnswer: string;
  readonly onRunVerification: () => void;
  readonly onToggleClaim: (claimId: string) => void;
  readonly result: ReadonlyVerificationResult | null;
}

interface ClaimCardProps {
  readonly claim: ReadonlyVerifiedClaim;
  readonly sources: Readonly<Record<string, ReadonlySourceInfo>>;
  readonly isExpanded: boolean;
  readonly onToggle: (claimId: string) => void;
}

interface SourceCardProps {
  readonly source: ReadonlySourceInfo;
}

export type {
  ClaimCardProps,
  ReadonlySourceInfo,
  ReadonlyVerificationResult,
  ReadonlyVerifiedClaim,
  SourceCardProps,
  VerificationPanelContentProps,
  VerificationPanelProps,
};
