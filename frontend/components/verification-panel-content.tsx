import { AlertTriangle, Loader2, Shield } from "lucide-react";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { hasText } from "@/lib/utils";
import { VerificationResults } from "./verification-panel-claims";
import type { VerificationPanelContentProps } from "./verification-panel-types";

const RunVerificationButton = ({
  disabled,
  onRunVerification,
}: Readonly<{ disabled: boolean; onRunVerification: () => void }>) => (
  <Button onClick={onRunVerification} disabled={disabled} size="sm">
    <Shield className="w-4 h-4 mr-2" />
    Run Verification
  </Button>
);

const VerificationEmptyState = ({
  mainAnswer,
  onRunVerification,
}: Readonly<Pick<VerificationPanelContentProps, "mainAnswer" | "onRunVerification">>) => (
  <div className="text-center py-4">
    <p className="text-sm text-muted-foreground mb-3">Verify claims in the research response</p>
    <RunVerificationButton
      onRunVerification={onRunVerification}
      disabled={!mainAnswer || mainAnswer.length < 50}
    />
  </div>
);

const VerificationLoadingState = () => (
  <div className="flex items-center justify-center py-8">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    <span className="ml-2 text-sm text-muted-foreground">Verifying claims...</span>
  </div>
);

const VerificationErrorState = ({ error }: Readonly<{ error: string }>) => (
  <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md text-destructive text-sm">
    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
    <span>{error}</span>
  </div>
);

const VerificationContentFrame = (props: Readonly<VerificationPanelContentProps>) => {
  const hasContent = props.result !== null && props.result.verified_claims.length > 0;
  return (
    <div className="px-4 pb-4 space-y-4">
      {!props.result && !props.isLoading && !hasText(props.error) && (
        <VerificationEmptyState
          mainAnswer={props.mainAnswer}
          onRunVerification={props.onRunVerification}
        />
      )}
      {props.isLoading && <VerificationLoadingState />}
      {hasText(props.error) && <VerificationErrorState error={props.error} />}
      {hasContent && props.result !== null && (
        <VerificationResults
          expandedClaims={props.expandedClaims}
          isLoading={props.isLoading}
          onRunVerification={props.onRunVerification}
          onToggleClaim={props.onToggleClaim}
          result={props.result}
        />
      )}
    </div>
  );
};

const VerificationPanelContent = (props: Readonly<VerificationPanelContentProps>) => (
  <CollapsibleContent>
    <VerificationContentFrame
      error={props.error}
      expandedClaims={props.expandedClaims}
      isLoading={props.isLoading}
      mainAnswer={props.mainAnswer}
      onRunVerification={props.onRunVerification}
      onToggleClaim={props.onToggleClaim}
      result={props.result}
    />
  </CollapsibleContent>
);

export { VerificationPanelContent };
