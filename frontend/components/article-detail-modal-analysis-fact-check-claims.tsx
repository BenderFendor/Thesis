"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  LinkIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { FactCheckResult } from "../lib/article-detail-modal-data";
import {
  VERIFICATION_LABEL_MAP,
  VERIFICATION_STYLE_MAP,
  getConfidenceColor,
} from "./article-detail-modal-analysis-fact-check-data";
import { useCallback } from "react";

const copyFactCheckClaim = async (clipboard: Readonly<Clipboard>, text: string): Promise<void> => {
  try {
    await clipboard.writeText(text);
  } catch {
    // Clipboard access is best effort and may be denied by the browser.
  }
};

const FactCheckResearchLink = ({ claim }: Readonly<{ claim: string }>) => (
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
);

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
      <FactCheckResearchLink claim={claim} />
    </div>
  );
};

type FactCheckHistoryEntry = Readonly<{
  claim: string;
  answer: string;
  timestamp: number;
}>;

const FactCheckLiveResearchTitle = () => (
  <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
    <Search className="h-4 w-4" /> Live Research
  </h4>
);

const FactCheckHistoryBadge = ({ entry }: Readonly<{ entry: FactCheckHistoryEntry }>) => (
  <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-1 text-xs uppercase tracking-wide text-foreground/80">
    Last run{" "}
    {new Date(entry.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}
  </div>
);

const FactCheckLiveResearchHeader = ({
  latestHistoryEntry,
}: Readonly<{ latestHistoryEntry: FactCheckHistoryEntry | undefined }>) => (
  <div className="mb-3 flex items-start justify-between gap-3">
    <div>
      <FactCheckLiveResearchTitle />
      <p className="text-xs text-muted-foreground">
        Query the current research backend with this claim and article context.
      </p>
    </div>
    {latestHistoryEntry !== undefined && <FactCheckHistoryBadge entry={latestHistoryEntry} />}
  </div>
);

const FactCheckResearchButtonLabel = ({ loading }: Readonly<{ loading: boolean }>) => {
  if (loading) {
    return (
      <>
        <Loader2 className="h-4 w-4 animate-spin" />
        Researching
      </>
    );
  }
  return (
    <>
      <Sparkles className="h-4 w-4" />
      Live Research
    </>
  );
};

const FactCheckResearchControls = ({
  loading,
  onRunSearch,
}: Readonly<{ loading: boolean; onRunSearch: () => void }>) => (
  <div className="flex flex-wrap items-center gap-2">
    <Button onClick={onRunSearch} disabled={loading} className="inline-flex items-center gap-2">
      <FactCheckResearchButtonLabel loading={loading} />
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="inline-flex items-center gap-2 text-foreground/80 hover:text-foreground"
      onClick={onRunSearch}
      disabled={loading}
    >
      <RefreshCw className="h-3.5 w-3.5" />
      Retry
    </Button>
  </div>
);

const FactCheckResearchError = ({ error }: Readonly<{ error: string | undefined }>) => {
  if (error === undefined || error === "") {
    return null;
  }
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
      <XCircle className="mt-0.5 h-4 w-4" />
      <span>{error}</span>
    </div>
  );
};

const FactCheckResearchAnswer = ({ answer }: Readonly<{ answer: string | undefined }>) => {
  if (answer === undefined || answer === "") {
    return null;
  }
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm text-foreground">
      <div className="flex items-start gap-2 text-xs uppercase tracking-widest text-foreground/70">
        <CheckCircle2 className="mt-0.5 h-4 w-4" />
        Research answer
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{answer}</p>
    </div>
  );
};

const FactCheckLiveResearch = ({
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
  agenticHistory: readonly FactCheckHistoryEntry[];
  onRunAgenticSearch: (claim: FactCheckResult) => void;
}>) => {
  const [latestHistoryEntry] = agenticHistory;
  const handleRunSearch = useCallback((): void => {
    onRunAgenticSearch(selectedClaim);
  }, [onRunAgenticSearch, selectedClaim]);
  return (
    <div className="rounded-2xl border border-border/60 bg-slate-950/90 p-5">
      <FactCheckLiveResearchHeader latestHistoryEntry={latestHistoryEntry} />
      <FactCheckResearchControls loading={agenticLoading} onRunSearch={handleRunSearch} />
      <FactCheckResearchError error={agenticError} />
      <FactCheckResearchAnswer answer={agenticAnswer} />
    </div>
  );
};

const FactCheckSelectedClaimDetails = ({
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
}>) => (
  <div className="space-y-4">
    <FactCheckClaimEvidence selectedClaim={selectedClaim} />
    <FactCheckLiveResearch
      selectedClaim={selectedClaim}
      agenticLoading={agenticLoading}
      agenticError={agenticError}
      agenticAnswer={agenticAnswer}
      agenticHistory={agenticHistory}
      onRunAgenticSearch={onRunAgenticSearch}
    />
  </div>
);

const FactCheckEmptySelection = () => (
  <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
    <Sparkles className="h-6 w-6 text-primary/80" />
    <p>Select a claim from the list to view its evidence and run deeper research.</p>
  </div>
);

const FactCheckClaimDetailContent = ({
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
}>) => {
  if (selectedClaim !== undefined) {
    return (
      <FactCheckSelectedClaimDetails
        selectedClaim={selectedClaim}
        agenticLoading={agenticLoading}
        agenticError={agenticError}
        agenticAnswer={agenticAnswer}
        agenticHistory={agenticHistory}
        onRunAgenticSearch={onRunAgenticSearch}
      />
    );
  }
  return <FactCheckEmptySelection />;
};

const FactCheckClaimDetails = ({
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
    <FactCheckClaimDetailContent
      selectedClaim={selectedClaim}
      agenticLoading={agenticLoading}
      agenticError={agenticError}
      agenticAnswer={agenticAnswer}
      agenticHistory={agenticHistory}
      onRunAgenticSearch={onRunAgenticSearch}
    />
  </div>
);

const FactCheckStatusBadges = ({ claim }: Readonly<{ claim: FactCheckResult }>) => (
  <div className="flex flex-wrap gap-2">
    <Badge
      className={`${VERIFICATION_STYLE_MAP[claim.verification_status]} text-xs uppercase tracking-wide`}
    >
      {VERIFICATION_LABEL_MAP[claim.verification_status]}
    </Badge>
    <Badge className={`${getConfidenceColor(claim.confidence)} text-xs uppercase tracking-wide`}>
      confidence: {claim.confidence}
    </Badge>
  </div>
);

const FactCheckEvidenceContent = ({ claim }: Readonly<{ claim: FactCheckResult }>) => (
  <div className="mt-4 space-y-2">
    <h5 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      Evidence
    </h5>
    <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-sm leading-relaxed text-foreground/85">
      {claim.evidence || "Evidence details not provided."}
    </div>
    <FactCheckClaimSources sources={claim.sources} />
  </div>
);

const FactCheckClaimEvidence = ({
  selectedClaim,
}: Readonly<{ selectedClaim: FactCheckResult }>) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <FactCheckStatusBadges claim={selectedClaim} />
    </div>
    <p className="text-base font-medium leading-relaxed text-foreground">
      &quot;{selectedClaim.claim}&quot;
    </p>
    {selectedClaim.notes !== undefined && selectedClaim.notes !== "" && (
      <p className="mt-3 text-sm text-muted-foreground">{selectedClaim.notes}</p>
    )}
    <FactCheckEvidenceContent claim={selectedClaim} />
    <FactCheckClaimActions claim={selectedClaim.claim} evidence={selectedClaim.evidence} />
  </div>
);

const FactCheckClaimSources = ({ sources }: Readonly<{ sources: FactCheckResult["sources"] }>) => (
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
);

export { FactCheckClaimDetails };
export type { FactCheckHistoryEntry };
