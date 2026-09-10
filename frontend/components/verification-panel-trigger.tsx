import { ChevronDown, ChevronUp, Loader2, Shield } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge } from "./confidence-badge";
import type { ReadonlyVerificationResult } from "./verification-panel-types";

interface VerificationPanelTriggerProps {
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly result: ReadonlyVerificationResult | null;
}

const VerificationResultBadge = ({ result }: Readonly<{ result: ReadonlyVerificationResult }>) => (
  <ConfidenceBadge
    confidence={result.overall_confidence}
    level={result.overall_confidence_level}
    claimCount={result.verified_claims.length}
    sourceCount={Object.keys(result.sources).length}
    size="sm"
  />
);

const VerificationTriggerStatus = ({
  isLoading,
  result,
}: Readonly<Pick<VerificationPanelTriggerProps, "isLoading" | "result">>) => (
  <div className="flex items-center gap-2">
    <Shield className="w-4 h-4" />
    <span className="font-medium">Verification</span>
    {result !== null && <VerificationResultBadge result={result} />}
    {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
  </div>
);

const VerificationChevron = ({ isOpen }: Readonly<{ isOpen: boolean }>) => {
  if (isOpen) {
    return <ChevronUp className="w-4 h-4" />;
  }
  return <ChevronDown className="w-4 h-4" />;
};

const VerificationTriggerButton = (props: Readonly<VerificationPanelTriggerProps>) => (
  <Button variant="ghost" className="w-full flex items-center justify-between p-4 h-auto">
    <VerificationTriggerStatus isLoading={props.isLoading} result={props.result} />
    <VerificationChevron isOpen={props.isOpen} />
  </Button>
);

const VerificationPanelTrigger = (props: Readonly<VerificationPanelTriggerProps>) => (
  <CollapsibleTrigger asChild>
    <VerificationTriggerButton
      isLoading={props.isLoading}
      isOpen={props.isOpen}
      result={props.result}
    />
  </CollapsibleTrigger>
);

export { VerificationPanelTrigger };
