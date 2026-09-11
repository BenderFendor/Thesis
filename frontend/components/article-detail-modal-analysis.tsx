"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Maximize2, Sparkles } from "lucide-react";
import type {
  ArticleAnalysis,
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
} from "../lib/article-detail-modal-data";
import {
  ModalFactCheckDialog,
  ModalFactCheckSuggestions,
  getFactCheckReadyLabel,
} from "./article-detail-modal-analysis-fact-check";

const ModalAiBiasHeader = () => (
  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
    <AlertTriangle className="h-5 w-5 text-yellow-400" />
    Bias Analysis
  </h3>
);

const ModalAiBiasFields = ({ tone, framing }: Readonly<{ tone: string; framing: string }>) => (
  <div className="space-y-3 text-sm">
    <div>
      <span className="text-muted-foreground">Tone:</span>
      <p className="mt-1 text-foreground">{tone}</p>
    </div>
    <div>
      <span className="text-muted-foreground">Framing:</span>
      <p className="mt-1 text-foreground">{framing}</p>
    </div>
  </div>
);

type ModalAiAnalysisBlockProps = Readonly<{
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
}>;

const ModalAiAnalysisBlock = ({
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
}: ModalAiAnalysisBlockProps) => (
  <div className="sticky top-6 space-y-6">
    <ModalAiSummary summary={aiAnalysis.summary} />
    {aiAnalysis.bias_analysis && <ModalAiBiasAnalysis analysis={aiAnalysis.bias_analysis} />}
    {aiAnalysis.source_analysis && <ModalAiSourceAnalysis analysis={aiAnalysis.source_analysis} />}
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
);

const ModalAiBiasAnalysis = ({
  analysis,
}: Readonly<{ analysis: NonNullable<ArticleAnalysis["bias_analysis"]> }>) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
    <ModalAiBiasHeader />
    {analysis.overall_bias_score && (
      <div className="mb-3">
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          Score: {analysis.overall_bias_score}/10
        </Badge>
      </div>
    )}
    <ModalAiBiasFields tone={analysis.tone_bias} framing={analysis.framing_bias} />
  </div>
);

const ModalAiSourceFields = ({
  credibility,
  leaning,
}: Readonly<{ credibility: string; leaning: string }>) => (
  <div className="space-y-3 text-sm">
    <div>
      <span className="text-muted-foreground">Credibility:</span>
      <p className="mt-1 text-foreground">{credibility}</p>
    </div>
    <div>
      <span className="text-muted-foreground">Political Leaning:</span>
      <p className="mt-1 text-foreground">{leaning}</p>
    </div>
  </div>
);

const ModalAiProgressNotice = ({ visible }: Readonly<{ visible: boolean }>) => {
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
};

const ModalAiSourceAnalysis = ({
  analysis,
}: Readonly<{ analysis: NonNullable<ArticleAnalysis["source_analysis"]> }>) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
    <h3 className="mb-4 text-lg font-semibold text-foreground">Source Info</h3>
    <ModalAiSourceFields
      credibility={analysis.credibility_assessment}
      leaning={analysis.political_leaning}
    />
  </div>
);

const getAiAnalysisError = (
  aiAnalysisRequested: boolean,
  aiAnalysis: Readonly<Pick<ArticleAnalysis, "error">> | undefined,
): string | undefined => {
  if (!aiAnalysisRequested) {
    return void 0;
  }
  return aiAnalysis?.error;
};

const ModalAiStatusBlocks = ({
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
};

const ModalAiSummary = ({ summary }: Readonly<{ summary?: string }>) =>
  (() => {
    if (summary !== undefined && summary !== "") {
      return (
        <div className="rounded-2xl border border-border/60 bg-slate-950/85 p-6 shadow-2xl shadow-black/40">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">AI Summary</h3>
          </div>
          <p className="text-sm leading-relaxed text-foreground/85">{summary}</p>
        </div>
      );
    }
    return void 0;
  })();

const ModalAiSummaryCard = ({
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
};

const ModalCompactAiSection = ({
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
);

export { ModalAiAnalysisBlock, ModalAiStatusBlocks, ModalCompactAiSection };
export { ModalSourceTransparency } from "./article-detail-modal-analysis-source";
