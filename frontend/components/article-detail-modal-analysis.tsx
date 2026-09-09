"use client";

import {
  AlertTriangle,
  BookOpen,
  Bug,
  CheckCircle2,
  Copy,
  DollarSign,
  ExternalLink,
  LinkIcon,
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import type {
  ArticleAnalysis,
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
  NewsArticle,
  NewsSource,
  SourceDebugData,
} from "../lib/article-detail-modal-data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatArticleDate } from "@/lib/date-formatters";
import { useCallback } from "react";

type DataClickEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ claim?: string; status?: string }>;
  }>;
}>;

type PropagationClickEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ action?: string }>;
  }>;
  stopPropagation: () => void;
}>;

const copyFactCheckClaim = async (clipboard: Readonly<Clipboard>, text: string): Promise<void> => {
  try {
    await clipboard.writeText(text);
  } catch {
    // Clipboard access is best effort and may be denied by the browser.
  }
};

const FactCheckClaimActions = ({
    claim,
    evidence,
  }: Readonly<{ claim: string; evidence: FactCheckResult["evidence"] }>) => {
    const handleCopy = useCallback((): void => {
      const clipboard = globalThis.navigator?.clipboard;
      if (clipboard === undefined) {
        return;
      }
      void copyFactCheckClaim(clipboard, `${claim}\n\nEvidence: ${evidence ?? "N/A"}`);
    }, [claim, evidence]);
    return (
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1 transition hover:border-primary/40 hover:text-foreground"
          onClick={handleCopy}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy claim
        </button>
        <Button variant="outline" size="sm" asChild>
          <a
            href={`/search?query=${encodeURIComponent(claim)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Search className="mr-1 h-3.5 w-3.5" />
            Open research workspace
          </a>
        </Button>
      </div>
    );
  },
  FactCheckClaimDetails = ({
    selectedClaim,
    agenticLoading,
    agenticError,
    agenticAnswer,
    agenticHistory,
    onRunAgenticSearch,
  }: Readonly<{
    selectedClaim: FactCheckResult | undefined;
    agenticLoading: boolean;
    agenticError: string | undefined;
    agenticAnswer: string | undefined;
    agenticHistory: readonly {
      readonly claim: string;
      readonly answer: string;
      readonly timestamp: number;
    }[];
    onRunAgenticSearch: (claim: FactCheckResult) => void;
  }>) => (
    <div className="space-y-5 overflow-y-auto p-6 md:col-span-8 lg:col-span-9">
      {(() => {
  if (selectedClaim) {
    return <div className="space-y-4">
          <FactCheckClaimEvidence selectedClaim={selectedClaim} />
          <FactCheckLiveResearch selectedClaim={selectedClaim} agenticLoading={agenticLoading} agenticError={agenticError} agenticAnswer={agenticAnswer} agenticHistory={agenticHistory} onRunAgenticSearch={onRunAgenticSearch} />
        </div>;
  }
  return <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
          <Sparkles className="h-6 w-6 text-primary/80" />
          <p>Select a claim from the list to view its evidence and run deeper research.</p>
        </div>;
})()}
    </div>
  ),
  FactCheckClaimEvidence = ({ selectedClaim }: Readonly<{ selectedClaim: FactCheckResult }>) => (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge
            className={`${VERIFICATION_STYLE_MAP[selectedClaim.verification_status]} text-xs uppercase tracking-wide`}
          >
            {VERIFICATION_LABEL_MAP[selectedClaim.verification_status]}
          </Badge>
          <Badge
            className={`${getConfidenceColor(selectedClaim.confidence)} text-xs uppercase tracking-wide`}
          >
            confidence: {selectedClaim.confidence}
          </Badge>
        </div>
      </div>
      <p className="text-base font-medium leading-relaxed text-foreground">
        &quot;{selectedClaim.claim}&quot;
      </p>
      {selectedClaim.notes !== undefined && selectedClaim.notes !== "" && (
        <p className="mt-3 text-sm text-muted-foreground">{selectedClaim.notes}</p>
      )}
      <div className="mt-4 space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Evidence
        </h5>
        <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-sm leading-relaxed text-foreground/85">
          {selectedClaim.evidence || "Evidence details not provided."}
        </div>
        <FactCheckClaimSources sources={selectedClaim.sources} />
      </div>
      <FactCheckClaimActions claim={selectedClaim.claim} evidence={selectedClaim.evidence} />
    </div>
  ),
  FactCheckClaimSidebar = ({
    factCheckResults,
    statusCounts,
    activeStatusFilter,
    onFilterChange,
    filteredClaims,
    selectedClaim,
    onSelectClaim,
  }: Readonly<{
    factCheckResults: readonly FactCheckResult[];
    statusCounts: Record<FactCheckStatus, number>;
    activeStatusFilter: FactCheckStatusFilter;
    onFilterChange: (filter: FactCheckStatusFilter) => void;
    filteredClaims: readonly FactCheckResult[];
    selectedClaim: FactCheckResult | undefined;
    onSelectClaim: (claim: FactCheckResult) => void;
  }>) => {
    const handleSidebarClick = useCallback(
      (event: DataClickEvent): void => {
        const status = STATUS_FILTERS.find(
          (candidate) => candidate === event.currentTarget.dataset.status,
        );
        if (status !== undefined) {
          if (status !== "all" && statusCounts[status] === 0) {
            return;
          }
          onFilterChange(status);
          return;
        }
        const claim = filteredClaims.find(
          (candidate) => candidate.claim === event.currentTarget.dataset.claim,
        );
        if (claim !== undefined) {
          onSelectClaim(claim);
        }
      },
      [filteredClaims, onFilterChange, onSelectClaim, statusCounts],
    );
    return (
      <div className="border-b border-border/60 bg-card/40 p-5 md:col-span-4 md:border-b-0 md:border-r lg:col-span-3">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Claim Filters
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => {
            const isAll = status === "all";
            const count = (() => {
  if (isAll) {
    return factCheckResults.length;
  }
  return statusCounts[status];
})();
            const isDisabled = !isAll && count === 0;
            const isActive = activeStatusFilter === status;

            return (
              <button
                key={status}
                type="button"
                data-status={status}
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all ${(() => {
  if (isActive) {
    return "border-primary/50 bg-primary/10 text-foreground";
  }
  return "border-border/60 bg-background/40 text-foreground/75 hover:border-primary/40 hover:text-foreground";
})()} ${(() => {
  if (isDisabled) {
    return "cursor-not-allowed opacity-40 hover:border-border/60 hover:text-foreground/75";
  }
  return "cursor-pointer";
})()}`}
                onClick={handleSidebarClick}
              >
                {(() => {
  if (status === "all") {
    return "All";
  }
  return VERIFICATION_LABEL_MAP[status];
})()}
                <span className="ml-2 rounded-full bg-background/70 px-2 py-0.5 text-xs font-bold text-foreground/80">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Claims
          </h4>
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 md:max-h-full">
            {filteredClaims.map((claim) => {
              const isActive = selectedClaim?.claim === claim.claim;
              return (
                <button
                  key={claim.claim}
                  type="button"
                  data-claim={claim.claim}
                  className={`w-full rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 ${(() => {
  if (isActive) {
    return "border-primary/50 bg-primary/10 shadow-lg shadow-black/20";
  }
  return "border-border/60 bg-background/45";
})()}`}
                  onClick={handleSidebarClick}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Badge
                      className={`${VERIFICATION_STYLE_MAP[claim.verification_status]} text-xs uppercase tracking-wide`}
                    >
                      {VERIFICATION_LABEL_MAP[claim.verification_status]}
                    </Badge>
                  </div>
                  <span className="line-clamp-3 text-sm text-foreground/85">{claim.claim}</span>
                </button>
              );
            })}
            {filteredClaims.length === 0 && (
              <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-xs text-muted-foreground">
                No claims in this category yet. Try another filter.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  FactCheckClaimSources = ({ sources }: Readonly<{ sources: FactCheckResult["sources"] }>) => (
    <div className="flex flex-wrap gap-2 text-xs text-foreground/75">
      {sources?.slice(0, 4).map((source) => (
        <a
          key={source}
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          className="group/link inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-3 py-1 transition hover:border-primary/40 hover:text-foreground"
        >
          <LinkIcon className="h-3 w-3" />
          <span className="max-w-48 truncate">{source}</span>
          <ExternalLink className="h-3 w-3 transition group-hover/link:translate-x-0.5" />
        </a>
      ))}
      {sources.length === 0 && (
        <span className="rounded-full border border-border/60 px-3 py-1">No sources provided</span>
      )}
    </div>
  ),
  FactCheckLaunchCard = ({
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary/80 transition-transform duration-300 group-hover:rotate-3" />
            <h3 className="text-lg font-semibold text-foreground">Fact Check Results</h3>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground/85">
            {factCheckResults.length} claims
          </span>
        </div>
        <p className="mb-4 max-w-xl text-sm text-muted-foreground">
          Review each claim, inspect the model’s evidence summary, and run live research without
          leaving the article.
        </p>
        <div className="space-y-3">
          {factCheckResults.slice(0, 3).map((result) => (
            <div
              key={result.claim}
              className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3 transition-all duration-300 group-hover:border-primary/30"
            >
              <Badge
                className={`${VERIFICATION_STYLE_MAP[result.verification_status]} text-xs uppercase tracking-wide`}
              >
                {VERIFICATION_LABEL_MAP[result.verification_status]}
              </Badge>
              <p className="line-clamp-2 text-sm text-foreground/80">&quot;{result.claim}&quot;</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between text-xs text-foreground/70">
          <span>Open the verification workspace</span>
          <div className="flex items-center gap-2 font-semibold">
            <span>Open</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </div>
        </div>
      </button>
    );
  },
  FactCheckLiveResearch = ({
    selectedClaim,
    agenticLoading,
    agenticError,
    agenticAnswer,
    agenticHistory,
    onRunAgenticSearch,
  }: Readonly<{
    selectedClaim: FactCheckResult;
    agenticLoading: boolean;
    agenticError: string | undefined;
    agenticAnswer: string | undefined;
    agenticHistory: readonly {
      readonly claim: string;
      readonly answer: string;
      readonly timestamp: number;
    }[];
    onRunAgenticSearch: (claim: FactCheckResult) => void;
  }>) => {
    const [latestHistoryEntry] = agenticHistory;
    const handleRunSearch = useCallback((): void => {
      onRunAgenticSearch(selectedClaim);
    }, [onRunAgenticSearch, selectedClaim]);
    return (
      <div className="rounded-2xl border border-border/60 bg-slate-950/90 p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Search className="h-4 w-4" /> Live Research
            </h4>
            <p className="text-xs text-muted-foreground">
              Query the current research backend with this claim and article context.
            </p>
          </div>
          {latestHistoryEntry !== undefined && (
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-1 text-xs uppercase tracking-wide text-foreground/80">
              Last run{" "}
              {new Date(latestHistoryEntry.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleRunSearch}
            disabled={agenticLoading}
            className="inline-flex items-center gap-2"
          >
            {(() => {
  if (agenticLoading) {
    return <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Researching
              </>;
  }
  return <>
                <Sparkles className="h-4 w-4" />
                Live Research
              </>;
})()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="inline-flex items-center gap-2 text-foreground/80 hover:text-foreground"
            onClick={handleRunSearch}
            disabled={agenticLoading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
        {agenticError !== undefined && agenticError !== "" && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            <XCircle className="mt-0.5 h-4 w-4" />
            <span>{agenticError}</span>
          </div>
        )}
        {agenticAnswer !== undefined && agenticAnswer !== "" && (
          <div className="mt-4 space-y-2 rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm text-foreground">
            <div className="flex items-start gap-2 text-xs uppercase tracking-widest text-foreground/70">
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
              Research answer
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {agenticAnswer}
            </p>
          </div>
        )}
      </div>
    );
  },
  ModalAiAnalysisBlock = ({
    aiAnalysis,
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
  }: Readonly<{
    aiAnalysis: Readonly<
      Pick<
        ArticleAnalysis,
        "bias_analysis" | "fact_check_suggestions" | "source_analysis" | "summary"
      >
    >;
    factCheckResults: readonly Readonly<FactCheckResult>[];
    claimsOpen: boolean;
    onOpenChange: (open: boolean) => void;
    statusCounts: Record<FactCheckStatus, number>;
    activeStatusFilter: FactCheckStatusFilter;
    onFilterChange: (filter: FactCheckStatusFilter) => void;
    filteredClaims: readonly Readonly<FactCheckResult>[];
    selectedClaim: Readonly<FactCheckResult> | undefined;
    onSelectClaim: (claim: Readonly<FactCheckResult>) => void;
    agenticLoading: boolean;
    agenticError: string | undefined;
    agenticAnswer: string | undefined;
    agenticHistory: readonly {
      readonly claim: string;
      readonly answer: string;
      readonly timestamp: number;
    }[];
    onRunAgenticSearch: (claim: Readonly<FactCheckResult>) => void;
  }>) => (
    <div className="sticky top-6 space-y-6">
      <ModalAiSummary summary={aiAnalysis.summary} />
      {aiAnalysis.bias_analysis && <ModalAiBiasAnalysis analysis={aiAnalysis.bias_analysis} />}
      {aiAnalysis.source_analysis && (
        <ModalAiSourceAnalysis analysis={aiAnalysis.source_analysis} />
      )}
      {factCheckResults.length > 0 && (
        <ModalFactCheckDialog
          factCheckResults={factCheckResults}
          claimsOpen={claimsOpen}
          onOpenChange={onOpenChange}
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
      )}
      <ModalFactCheckSuggestions suggestions={aiAnalysis.fact_check_suggestions} />
    </div>
  ),
  ModalAiBiasAnalysis = ({
    analysis,
  }: Readonly<{ analysis: NonNullable<ArticleAnalysis["bias_analysis"]> }>) => (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
        <AlertTriangle className="h-5 w-5 text-yellow-400" />
        Bias Analysis
      </h3>
      {analysis.overall_bias_score && (
        <div className="mb-3">
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            Score: {analysis.overall_bias_score}/10
          </Badge>
        </div>
      )}
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">Tone:</span>
          <p className="mt-1 text-foreground">{analysis.tone_bias}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Framing:</span>
          <p className="mt-1 text-foreground">{analysis.framing_bias}</p>
        </div>
      </div>
    </div>
  ),
  ModalAiProgressNotice = ({ visible }: Readonly<{ visible: boolean }>) => {
    if (!visible) {
      return null;
    }
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-slate-950/85 p-4">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        <p className="text-sm text-muted-foreground">
          AI is analyzing the article in the background.
        </p>
      </div>
    );
  },
  ModalAiSourceAnalysis = ({
    analysis,
  }: Readonly<{ analysis: NonNullable<ArticleAnalysis["source_analysis"]> }>) => (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
      <h3 className="mb-4 text-lg font-semibold text-foreground">Source Info</h3>
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">Credibility:</span>
          <p className="mt-1 text-foreground">{analysis.credibility_assessment}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Political Leaning:</span>
          <p className="mt-1 text-foreground">{analysis.political_leaning}</p>
        </div>
      </div>
    </div>
  ),
  getAiAnalysisError = (
    aiAnalysisRequested: boolean,
    aiAnalysis: Readonly<Pick<ArticleAnalysis, "error">> | undefined,
  ): string | undefined => {
    if (!aiAnalysisRequested) {
      return void 0;
    }
    return aiAnalysis?.error;
  },
  ModalAiStatusBlocks = ({
    aiAnalysisRequested,
    aiAnalysisLoading,
    aiAnalysis,
  }: Readonly<{
    aiAnalysisRequested: boolean;
    aiAnalysisLoading: boolean;
    aiAnalysis: Readonly<Pick<ArticleAnalysis, "error">> | undefined;
  }>) => {
    const error = getAiAnalysisError(aiAnalysisRequested, aiAnalysis);
    return (
      <>
        {!aiAnalysisRequested && (
          <div className="rounded-sm border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              AI Analysis
            </p>
            <p className="mt-2 text-foreground/80 font-serif">
              AI analysis is off by default. Use the “Run Analysis” button when you need it.
            </p>
          </div>
        )}
        {aiAnalysisRequested && aiAnalysisLoading && (
          <div className="rounded-lg border border-border/60 bg-secondary/70 p-5 text-sm text-muted-foreground">
            Running AI analysis…
          </div>
        )}
        {error !== undefined && error !== "" && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-200">
            {error}
          </div>
        )}
      </>
    );
  },
  ModalAiSummary = ({ summary }: Readonly<{ summary?: string }>) =>
    (() => {
  if (summary !== undefined && summary !== "") {
    return <div className="rounded-2xl border border-border/60 bg-slate-950/85 p-6 shadow-2xl shadow-black/40">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">AI Summary</h3>
        </div>
        <p className="text-sm leading-relaxed text-foreground/85">{summary}</p>
      </div>;
  }
  return void 0;
})(),
  ModalAiSummaryCard = ({
    visible,
    summary,
    factCheckCount,
    onExpand,
  }: Readonly<{
    visible: boolean;
    summary: string | undefined;
    factCheckCount: number;
    onExpand: () => void;
  }>) => {
    if (!visible || summary === undefined || summary === "") {
      return null;
    }
    return (
      <div className="rounded-2xl border border-border/60 bg-slate-950/85 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">AI Summary</h3>
        </div>
        <p className="text-sm leading-relaxed text-foreground/85">{summary}</p>
        {factCheckCount > 0 && (
          <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">
            {getFactCheckReadyLabel(factCheckCount)}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onExpand}
          className="mt-3 w-full border-border/60 bg-background/50"
        >
          <Maximize2 className="h-4 w-4 mr-2" />
          Expand for Full AI Analysis
        </Button>
      </div>
    );
  },
  ModalCompactAiSection = ({
    isExpanded,
    aiAnalysisLoading,
    aiAnalysis,
    factCheckCount,
    onExpand,
  }: Readonly<{
    isExpanded: boolean;
    aiAnalysisLoading: boolean;
    aiAnalysis: Readonly<Pick<ArticleAnalysis, "summary">> | undefined;
    factCheckCount: number;
    onExpand: () => void;
  }>) => (
    <>
      <ModalAiProgressNotice visible={!isExpanded && aiAnalysisLoading} />
      <ModalAiSummaryCard
        visible={!isExpanded}
        summary={aiAnalysis?.summary}
        factCheckCount={factCheckCount}
        onExpand={onExpand}
      />
    </>
  ),
  ModalFactCheckDialog = ({
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
  }: Readonly<{
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
    agenticHistory: readonly {
      readonly claim: string;
      readonly answer: string;
      readonly timestamp: number;
    }[];
    onRunAgenticSearch: (claim: FactCheckResult) => void;
  }>) => (
    <Dialog open={claimsOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <FactCheckLaunchCard
          factCheckResults={factCheckResults}
          selectedClaim={selectedClaim}
          onSelectClaim={onSelectClaim}
        />
      </DialogTrigger>
      <DialogContent className="max-h-screen overflow-hidden border border-border/60 bg-background/95 p-0 text-foreground shadow-2xl shadow-black/60 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Sparkles className="h-5 w-5 text-primary/80" />
            Verification Report
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Review claims, inspect evidence, and run live research against the same article context.
          </p>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  ),
  ModalFactCheckSuggestions = ({
    suggestions,
  }: Readonly<{ suggestions?: NonNullable<ArticleAnalysis["fact_check_suggestions"]> }>) =>
    (() => {
  if (suggestions !== undefined && suggestions.length > 0) {
    return <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-3">Fact Check</h3>
        <ul className="space-y-2 text-sm">
          {suggestions.slice(0, 3).map(suggestion => <li key={suggestion} className="flex items-start gap-2">
              <span className="text-cyan-400 mt-1">•</span>
              <span className="text-gray-300">{suggestion}</span>
            </li>)}
        </ul>
      </div>;
  }
  return void 0;
})(),
  ModalSourceContent = ({
    sourceLoading,
    source,
    article,
    reporterName,
    showSourceDetails,
    onOpenSourceWiki,
    onOpenReporterWiki,
    onClose,
  }: Readonly<{
    sourceLoading: boolean;
    source: Readonly<Pick<NewsSource, "country" | "funding" | "name">> | undefined;
    article: Readonly<Pick<NewsArticle, "publishedAt">>;
    reporterName: string;
    showSourceDetails: boolean;
    onOpenSourceWiki: () => void;
    onOpenReporterWiki: () => void;
    onClose: () => void;
  }>) => {
    if (sourceLoading) {
      return (
        <div className="flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      );
    }
    if (source === undefined) {
      return <p className="text-gray-400 text-sm">Source info unavailable</p>;
    }
    return (
      <SourceTransparencyDetails
        source={source}
        article={article}
        reporterName={reporterName}
        showSourceDetails={showSourceDetails}
        onOpenSourceWiki={onOpenSourceWiki}
        onOpenReporterWiki={onOpenReporterWiki}
        onClose={onClose}
      />
    );
  },
  ModalSourceDebug = ({
    debugMode,
    debugOpen,
    debugLoading,
    debugData,
    matchedEntryIndex,
    onToggleDebug,
  }: Readonly<{
    debugMode: boolean;
    debugOpen: boolean;
    debugLoading: boolean;
    debugData: Readonly<Pick<SourceDebugData, "feed_status" | "image_analysis">> | undefined;
    matchedEntryIndex: number | undefined;
    onToggleDebug: () => void;
  }>) => {
    if (!debugMode) {
      return null;
    }
    return (
      <>
        <Button variant="outline" size="sm" onClick={onToggleDebug} className="w-full mt-4">
          <Bug className="h-4 w-4 mr-1" /> {(() => {
  if (debugOpen) {
    return "Hide";
  }
  return "Show";
})()} Debug
        </Button>
        {debugOpen && (
          <SourceDebugPanel
            loading={debugLoading}
            data={debugData}
            matchedEntryIndex={matchedEntryIndex}
          />
        )}
      </>
    );
  },
  ModalSourceTransparency = ({
    sourceLoading,
    source,
    article,
    reporterName,
    showSourceDetails,
    onToggleDetails,
    debugMode,
    debugOpen,
    debugLoading,
    debugData,
    matchedEntryIndex,
    onToggleDebug,
    onOpenSourceWiki,
    onOpenReporterWiki,
    onClose,
  }: Readonly<{
    sourceLoading: boolean;
    source: Readonly<Pick<NewsSource, "country" | "funding" | "name">> | undefined;
    article: Readonly<Pick<NewsArticle, "publishedAt">>;
    reporterName: string;
    showSourceDetails: boolean;
    onToggleDetails: () => void;
    debugMode: boolean;
    debugOpen: boolean;
    debugLoading: boolean;
    debugData: Readonly<Pick<SourceDebugData, "feed_status" | "image_analysis">> | undefined;
    matchedEntryIndex: number | undefined;
    onToggleDebug: () => void;
    onOpenSourceWiki: () => void;
    onOpenReporterWiki: () => void;
    onClose: () => void;
  }>) => (
    <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
          Source
        </h3>
        <Button variant="outline" size="sm" onClick={onToggleDetails}>
          {(() => {
  if (showSourceDetails) {
    return "Hide";
  }
  return "Show";
})()}
        </Button>
      </div>

      <ModalSourceContent
        sourceLoading={sourceLoading}
        source={source}
        article={article}
        reporterName={reporterName}
        showSourceDetails={showSourceDetails}
        onOpenSourceWiki={onOpenSourceWiki}
        onOpenReporterWiki={onOpenReporterWiki}
        onClose={onClose}
      />
      <ModalSourceDebug
        debugMode={debugMode}
        debugOpen={debugOpen}
        debugLoading={debugLoading}
        debugData={debugData}
        matchedEntryIndex={matchedEntryIndex}
        onToggleDebug={onToggleDebug}
      />
    </div>
  ),
  STATUS_FILTERS: FactCheckStatusFilter[] = [
    "all",
    "verified",
    "partially-verified",
    "unverified",
    "false",
  ],
  SourceDebugPanel = ({
    loading,
    data,
    matchedEntryIndex,
  }: Readonly<{
    loading: boolean;
    data: Readonly<Pick<SourceDebugData, "feed_status" | "image_analysis">> | undefined;
    matchedEntryIndex: number | undefined;
  }>) => {
    let content = <div className="text-gray-400 text-xs">No debug data</div>;
    if (loading) {
      content = (
        <div className="flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      );
    } else if (data !== undefined) {
      content = (
        <div className="space-y-2 text-xs">
          <div className="text-gray-400">Entries: {data.feed_status?.entries_count}</div>
          <div className="text-gray-400">
            Has Images: {data.image_analysis?.entries_with_images}
            {data.image_analysis?.total_entries}
          </div>
          {matchedEntryIndex !== undefined && (
            <div className="text-primary">Matched at index: {matchedEntryIndex}</div>
          )}
        </div>
      );
    }
    return <div className="mt-4 p-4 bg-black/40 rounded border border-gray-800">{content}</div>;
  },
  SourceTransparencyDetails = ({
    source,
    article,
    reporterName,
    showSourceDetails,
    onOpenSourceWiki,
    onOpenReporterWiki,
    onClose,
  }: Readonly<{
    source: Readonly<Pick<NewsSource, "country" | "funding" | "name">>;
    article: Readonly<Pick<NewsArticle, "publishedAt">>;
    reporterName: string;
    showSourceDetails: boolean;
    onOpenSourceWiki: () => void;
    onOpenReporterWiki: () => void;
    onClose: () => void;
  }>) => {
    const handleSourceAction = useCallback(
      (event: PropagationClickEvent): void => {
        event.stopPropagation();
        const action = event.currentTarget.dataset.action;
        if (action === "reporter") {
          onOpenReporterWiki();
          return;
        }
        if (action === "source") {
          onOpenSourceWiki();
          return;
        }
        if (action === "reporter-link" || action === "source-link") {
          onClose();
        }
      },
      [onClose, onOpenReporterWiki, onOpenSourceWiki],
    );
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <DollarSign className="h-4 w-4 text-green-400" />
          <span className="text-gray-400">Funding:</span>
          <span className="text-white text-xs">{source.funding?.join(", ") || "N/A"}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Published:</span>
          <span className="text-white text-xs">{formatArticleDate(article.publishedAt)}</span>
        </div>
        {reporterName !== "" && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Reporter:</span>
            <button
              type="button"
              className="text-white text-xs hover:text-primary hover:underline transition-colors"
              onClick={handleSourceAction}
              data-action="reporter"
            >
              {reporterName}
            </button>
            <Link
              href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
              className="text-muted-foreground hover:text-primary transition-colors"
              onClick={handleSourceAction}
              data-action="reporter-link"
              title="Open reporter wiki page"
            >
              <BookOpen className="h-3 w-3" />
            </Link>
          </div>
        )}
        {showSourceDetails && (
          <div className="space-y-3 pt-3 border-t border-gray-700 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Publisher:</span>
              <button
                type="button"
                className="text-white hover:text-primary hover:underline transition-colors"
                onClick={handleSourceAction}
                data-action="source"
              >
                {source.name}
              </button>
              <Link
                href={`/wiki/source/${encodeURIComponent(source.name)}`}
                className="text-muted-foreground hover:text-primary transition-colors"
                onClick={handleSourceAction}
                data-action="source-link"
                title="View wiki profile"
              >
                <BookOpen className="h-3 w-3" />
              </Link>
            </div>
            <div>
              <span className="text-gray-400">Country:</span>
              <span className="text-white ml-2">{source.country}</span>
            </div>
          </div>
        )}
      </div>
    );
  },
  VERIFICATION_LABEL_MAP = {
    false: "false",
    "partially-verified": "partially verified",
    unverified: "unverified",
    verified: "verified",
  } satisfies Record<FactCheckStatus, string>,
  VERIFICATION_STYLE_MAP = {
    false: "bg-rose-500/15 text-rose-200 border border-rose-500/40",
    "partially-verified": "bg-amber-500/15 text-amber-200 border border-amber-500/40",
    unverified: "bg-slate-600/20 text-slate-200 border border-slate-500/40",
    verified: "bg-primary/15 text-primary border border-primary/40",
  } satisfies Record<FactCheckStatus, string>,
  getConfidenceColor = (confidence: FactCheckResult["confidence"]) => {
    switch (confidence) {
      case "high": {
        return "bg-primary/15 text-primary border border-primary/40";
      }
      case "medium": {
        return "bg-amber-500/15 text-amber-200 border border-amber-500/40";
      }
      case "low": {
        return "bg-rose-500/15 text-rose-200 border border-rose-500/40";
      }
      default: {
        return "bg-slate-600/20 text-slate-200 border border-slate-500/40";
      }
    }
  },
  getFactCheckReadyLabel = (factCheckCount: number): string => {
    if (factCheckCount === 1) {
      return "1 claim ready for verification review";
    }
    return `${factCheckCount} claims ready for verification review`;
  };

export {
  ModalAiAnalysisBlock,
  ModalAiStatusBlocks,
  ModalCompactAiSection,
  ModalSourceTransparency,
};
