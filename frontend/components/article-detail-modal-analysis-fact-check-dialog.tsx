"use client";

import { Badge } from "@/components/ui/badge";
import { ExternalLink, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  ArticleAnalysis,
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
} from "../lib/article-detail-modal-data";
import { FactCheckClaimDetails } from "./article-detail-modal-analysis-fact-check-claims";
import type { FactCheckHistoryEntry } from "./article-detail-modal-analysis-fact-check-claims";
import { FactCheckClaimSidebar } from "./article-detail-modal-analysis-fact-check-sidebar";
import {
  VERIFICATION_LABEL_MAP,
  VERIFICATION_STYLE_MAP,
} from "./article-detail-modal-analysis-fact-check-data";
import { useCallback } from "react";

const FactCheckLaunchHeader = ({ count }: Readonly<{ count: number }>) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <Sparkles className="h-5 w-5 text-primary/80 transition-transform duration-300 group-hover:rotate-3" />
      <h3 className="text-lg font-semibold text-foreground">Fact Check Results</h3>
    </div>
    <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground/85">
      {count} claims
    </span>
  </div>
);

const FactCheckPreviewItem = ({ result }: Readonly<{ result: FactCheckResult }>) => (
  <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition-all duration-300 group-hover:border-primary/30">
    <Badge
      className={`${VERIFICATION_STYLE_MAP[result.verification_status]} text-xs uppercase tracking-wide`}
    >
      {VERIFICATION_LABEL_MAP[result.verification_status]}
    </Badge>
    <p className="line-clamp-2 text-sm text-foreground/80">&quot;{result.claim}&quot;</p>
  </div>
);

const FactCheckPreviewList = ({ results }: Readonly<{ results: readonly FactCheckResult[] }>) => (
  <div className="space-y-3">
    {results.slice(0, 3).map((result) => (
      <FactCheckPreviewItem key={result.claim} result={result} />
    ))}
  </div>
);

const FactCheckLaunchFooter = () => (
  <div className="mt-5 flex items-center justify-between text-xs text-foreground/70">
    <span>Open the verification workspace</span>
    <div className="flex items-center gap-2 font-semibold">
      <span>Open</span>
      <ExternalLink className="h-3.5 w-3.5" />
    </div>
  </div>
);

const FactCheckLaunchCard = ({
  factCheckResults,
  selectedClaim,
  onSelectClaim,
}: Readonly<{
  factCheckResults: readonly FactCheckResult[];
  selectedClaim: FactCheckResult | undefined;
  onSelectClaim: (claim: FactCheckResult) => void;
}>) => {
  const handleLaunchClick = useCallback((): void => {
    const firstResult = factCheckResults[0];
    if (selectedClaim === undefined && firstResult !== undefined) {
      onSelectClaim(firstResult);
    }
  }, [factCheckResults, onSelectClaim, selectedClaim]);
  return (
    <button
      type="button"
      onClick={handleLaunchClick}
      className="group relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card/70 p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:bg-card/90 hover:shadow-xl hover:shadow-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label="Open verified claims report"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-80" />
      <FactCheckLaunchHeader count={factCheckResults.length} />
      <p className="mb-4 max-w-xl text-sm text-muted-foreground">
        Review each claim, inspect the model’s evidence summary, and run live research without
        leaving the article.
      </p>
      <FactCheckPreviewList results={factCheckResults} />
      <FactCheckLaunchFooter />
    </button>
  );
};

const FactCheckDialogHeader = () => (
  <DialogHeader className="border-b border-border/60 px-6 py-5">
    <DialogTitle className="flex items-center gap-2 text-foreground">
      <Sparkles className="h-5 w-5 text-primary/80" />
      Verification Report
    </DialogTitle>
    <p className="text-sm text-muted-foreground">
      Review claims, inspect evidence, and run live research against the same article context.
    </p>
  </DialogHeader>
);

const FactCheckDialogBody = ({
  factCheckResults,
  statusCounts,
  activeStatusFilter,
  onFilterChange,
  filteredClaims,
  selectedClaim,
  onSelectClaim,
  agenticLoading,
  agenticError,
  agenticAnswer,
  agenticHistory,
  onRunAgenticSearch,
}: Readonly<{
  factCheckResults: readonly FactCheckResult[];
  statusCounts: Record<FactCheckStatus, number>;
  activeStatusFilter: FactCheckStatusFilter;
  onFilterChange: (filter: FactCheckStatusFilter) => void;
  filteredClaims: readonly FactCheckResult[];
  selectedClaim: FactCheckResult | undefined;
  onSelectClaim: (claim: FactCheckResult) => void;
  agenticLoading: boolean;
  agenticError: string | undefined;
  agenticAnswer: string | undefined;
  agenticHistory: readonly FactCheckHistoryEntry[];
  onRunAgenticSearch: (claim: FactCheckResult) => void;
}>) => (
  <div className="grid max-h-screen md:grid-cols-12">
    <FactCheckClaimSidebar
      factCheckResults={factCheckResults}
      statusCounts={statusCounts}
      activeStatusFilter={activeStatusFilter}
      onFilterChange={onFilterChange}
      filteredClaims={filteredClaims}
      selectedClaim={selectedClaim}
      onSelectClaim={onSelectClaim}
    />
    <FactCheckClaimDetails
      selectedClaim={selectedClaim}
      agenticLoading={agenticLoading}
      agenticError={agenticError}
      agenticAnswer={agenticAnswer}
      agenticHistory={agenticHistory}
      onRunAgenticSearch={onRunAgenticSearch}
    />
  </div>
);

type ModalFactCheckDialogProps = Readonly<{
  factCheckResults: readonly FactCheckResult[];
  claimsOpen: boolean;
  onOpenChange: (open: boolean) => void;
  statusCounts: Record<FactCheckStatus, number>;
  activeStatusFilter: FactCheckStatusFilter;
  onFilterChange: (filter: FactCheckStatusFilter) => void;
  filteredClaims: readonly FactCheckResult[];
  selectedClaim: FactCheckResult | undefined;
  onSelectClaim: (claim: FactCheckResult) => void;
  agenticLoading: boolean;
  agenticError: string | undefined;
  agenticAnswer: string | undefined;
  agenticHistory: readonly FactCheckHistoryEntry[];
  onRunAgenticSearch: (claim: FactCheckResult) => void;
}>;

const ModalFactCheckDialog = ({
  factCheckResults,
  claimsOpen,
  onOpenChange,
  statusCounts,
  activeStatusFilter,
  onFilterChange,
  filteredClaims,
  selectedClaim,
  onSelectClaim,
  agenticLoading,
  agenticError,
  agenticAnswer,
  agenticHistory,
  onRunAgenticSearch,
}: ModalFactCheckDialogProps) => (
  <Dialog open={claimsOpen} onOpenChange={onOpenChange}>
    <DialogTrigger asChild>
      <FactCheckLaunchCard
        factCheckResults={factCheckResults}
        selectedClaim={selectedClaim}
        onSelectClaim={onSelectClaim}
      />
    </DialogTrigger>
    <DialogContent className="max-h-screen overflow-hidden border border-border/60 bg-background/95 p-0 text-foreground shadow-2xl shadow-black/60 sm:max-w-5xl">
      <DialogTitle className="sr-only">Verification Report</DialogTitle>
      <FactCheckDialogHeader />
      <FactCheckDialogBody
        factCheckResults={factCheckResults}
        statusCounts={statusCounts}
        activeStatusFilter={activeStatusFilter}
        onFilterChange={onFilterChange}
        filteredClaims={filteredClaims}
        selectedClaim={selectedClaim}
        onSelectClaim={onSelectClaim}
        agenticLoading={agenticLoading}
        agenticError={agenticError}
        agenticAnswer={agenticAnswer}
        agenticHistory={agenticHistory}
        onRunAgenticSearch={onRunAgenticSearch}
      />
    </DialogContent>
  </Dialog>
);

const FactCheckSuggestionItem = ({ suggestion }: Readonly<{ suggestion: string }>) => (
  <li className="flex items-start gap-2">
    <span className="text-cyan-400 mt-1">•</span>
    <span className="text-gray-300">{suggestion}</span>
  </li>
);

const FactCheckSuggestionList = ({ suggestions }: Readonly<{ suggestions: readonly string[] }>) => (
  <ul className="space-y-2 text-sm">
    {suggestions.slice(0, 3).map((suggestion) => (
      <FactCheckSuggestionItem key={suggestion} suggestion={suggestion} />
    ))}
  </ul>
);

const ModalFactCheckSuggestions = ({
  suggestions,
}: Readonly<{ suggestions?: NonNullable<ArticleAnalysis["fact_check_suggestions"]> }>) => {
  if (suggestions === undefined || suggestions.length === 0) {
    return null;
  }
  return (
    <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-white mb-3">Fact Check</h3>
      <FactCheckSuggestionList suggestions={suggestions} />
    </div>
  );
};

const getFactCheckReadyLabel = (factCheckCount: number): string => {
  if (factCheckCount === 1) {
    return "1 claim ready for verification review";
  }
  return `${factCheckCount} claims ready for verification review`;
};

export { ModalFactCheckDialog, ModalFactCheckSuggestions, getFactCheckReadyLabel };
