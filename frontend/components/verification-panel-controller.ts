import { useCallback, useState } from "react";
import { hasText } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { verifyResearch } from "@/lib/verification";
import type {
  ReadonlyVerificationResult,
  VerificationPanelProps,
} from "./verification-panel-types";

const applyVerificationResult = (
  verificationResult: ReadonlyVerificationResult,
  setResult: (value: ReadonlyVerificationResult) => void,
  setError: (value: string) => void,
  onVerificationComplete: VerificationPanelProps["onVerificationComplete"],
): void => {
  setResult(verificationResult);
  onVerificationComplete?.(verificationResult);
  if (hasText(verificationResult.error)) {
    setError(verificationResult.error);
  }
};

const setVerificationFailure = (message: string, setError: (value: string) => void): void => {
  setError(message);
};

const useVerificationRunner = (
  query: string,
  mainAnswer: string,
  onVerificationComplete: VerificationPanelProps["onVerificationComplete"],
) => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReadonlyVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const executeVerification = useCallback(async () => {
    try {
      const verificationResult = await verifyResearch({
        main_answer: mainAnswer,
        query,
      });
      applyVerificationResult(verificationResult, setResult, setError, onVerificationComplete);
    } catch (verificationError) {
      if (verificationError instanceof Error) {
        setVerificationFailure(verificationError.message, setError);
      } else {
        setVerificationFailure("Verification failed", setError);
      }
      logger.error("Verification failed", { error: verificationError });
    } finally {
      setIsLoading(false);
    }
  }, [mainAnswer, onVerificationComplete, query]);
  const runVerification = useCallback(() => {
    if (!mainAnswer || mainAnswer.length < 50) {
      return;
    }
    setIsLoading(true);
    setError(null);
    void executeVerification();
  }, [executeVerification, mainAnswer]);
  const handleRunVerification = useCallback(() => {
    runVerification();
  }, [runVerification]);
  return { error, handleRunVerification, isLoading, result };
};

const useVerificationClaimState = () => {
  const [expandedClaims, setExpandedClaims] = useState<Set<string>>(new Set());
  const handleToggleClaim = useCallback((claimId: string) => {
    setExpandedClaims((previousClaims) => {
      const nextClaims = new Set(previousClaims);
      if (nextClaims.has(claimId)) {
        nextClaims.delete(claimId);
      } else {
        nextClaims.add(claimId);
      }
      return nextClaims;
    });
  }, []);
  return { expandedClaims, handleToggleClaim };
};

const useVerificationController = (props: Readonly<VerificationPanelProps>) => {
  const [isOpen, setIsOpen] = useState(false);
  const runner = useVerificationRunner(props.query, props.mainAnswer, props.onVerificationComplete);
  const claims = useVerificationClaimState();
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);
  return { ...claims, ...runner, handleOpenChange, isOpen };
};

export { useVerificationController };
