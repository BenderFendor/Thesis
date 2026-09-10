"use client";

import { Collapsible } from "@/components/ui/collapsible";
import { VerificationPanelContent } from "./verification-panel-content";
import { useVerificationController } from "./verification-panel-controller";
import { VerificationPanelTrigger } from "./verification-panel-trigger";
import type {
  VerificationPanelContentProps,
  VerificationPanelProps,
} from "./verification-panel-types";

type VerificationPanelFrameProps = Readonly<
  VerificationPanelContentProps & {
    readonly isOpen: boolean;
    readonly onOpenChange: (open: boolean) => void;
  }
>;

const VerificationPanelFrame = (props: VerificationPanelFrameProps) => {
  const handleOpenChange = props.onOpenChange;
  const handleRunVerification = props.onRunVerification;
  const handleToggleClaim = props.onToggleClaim;
  return (
    <Collapsible open={props.isOpen} onOpenChange={handleOpenChange}>
      <VerificationPanelTrigger
        isLoading={props.isLoading}
        isOpen={props.isOpen}
        result={props.result}
      />
      <VerificationPanelContent
        error={props.error}
        expandedClaims={props.expandedClaims}
        isLoading={props.isLoading}
        mainAnswer={props.mainAnswer}
        onRunVerification={handleRunVerification}
        onToggleClaim={handleToggleClaim}
        result={props.result}
      />
    </Collapsible>
  );
};

const VerificationPanel = (props: Readonly<VerificationPanelProps>) => {
  const controller = useVerificationController(props);
  return (
    <div className={`border rounded-lg bg-card ${props.className ?? ""}`}>
      <VerificationPanelFrame
        error={controller.error}
        expandedClaims={controller.expandedClaims}
        isLoading={controller.isLoading}
        isOpen={controller.isOpen}
        mainAnswer={props.mainAnswer}
        onOpenChange={controller.handleOpenChange}
        onRunVerification={controller.handleRunVerification}
        onToggleClaim={controller.handleToggleClaim}
        result={controller.result}
      />
    </div>
  );
};

export { VerificationPanel };
