"use client";

import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SourceCoverageResponse } from "@/lib/api";
import { fetchSourceCoverage } from "@/lib/api";
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

const EMPTY_SOURCE_NAMES = Object.freeze<Record<string, string>>({});
const getBarStyle = (width: number) => ({ width: `${width}%` });

interface SourceCoverageComparisonProps {
  readonly sourceIds: readonly string[];
  readonly sourceNames?: Readonly<Record<string, string>>;
  readonly className?: string;
}

type SourceCoverageRecord = Readonly<SourceCoverageResponse["sources"][string]>;
type SourceCoverageEntry = readonly [string, SourceCoverageRecord];
type SourceCoverageMap = Readonly<Record<string, SourceCoverageRecord>>;

const getCoverageErrorMessage = (error: Error | null): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load";
};

const getDiversityLabel = (score: number) => {
  if (score >= 1.2) {
    return {
      color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
      label: "Broad",
    };
  }
  if (score >= 0.8) {
    return { color: "bg-amber-500/15 text-amber-400 border-amber-500/40", label: "Moderate" };
  }
  return { color: "bg-slate-500/15 text-slate-400 border-slate-500/40", label: "Focused" };
};

const useSourceCoverageQuery = (sourceIds: readonly string[]) => {
  const {
    data: coverage,
    isLoading: loading,
    error,
    refetch,
  } = useQuery<SourceCoverageResponse>({
    enabled: sourceIds.length >= 2,
    queryFn: () => fetchSourceCoverage(sourceIds, 100),
    queryKey: ["source-coverage", [...sourceIds].toSorted().join(","), 100],
    retry: 1,
  });
  const loadCoverage = useCallback(() => {
    void refetch();
  }, [refetch]);
  return { coverage, error, loadCoverage, loading };
};

const SourceCoverageHeading = () => (
  <div className="flex items-center gap-2">
    <BarChart3 className="h-4 w-4 text-muted-foreground" />
    <h4 className="text-sm font-medium">Source Coverage Diversity</h4>
  </div>
);

const SourceCoverageHeader = ({ onRetry }: Readonly<{ onRetry: () => void }>) => (
  <div className="mb-4 flex items-center justify-between">
    <SourceCoverageHeading />
    <Button variant="ghost" size="sm" onClick={onRetry}>
      <RefreshCw className="h-3 w-3" />
    </Button>
  </div>
);

const SourceCoverageLoading = ({ className }: Readonly<{ className: string }>) => (
  <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
    <Loader2 className="h-4 w-4 animate-spin" />
    Analyzing source coverage...
  </div>
);

const SourceCoverageError = ({
  className,
  message,
  onRetry,
}: Readonly<{ className: string; message: string; onRetry: () => void }>) => (
  <div className={className}>
    <p className="mb-2 text-sm text-rose-400">{message}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="mr-2 h-3 w-3" />
      Retry
    </Button>
  </div>
);

const SourceCoverageStats = ({
  articleCount,
  color,
  label,
}: Readonly<{ articleCount: number; color: string; label: string }>) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-muted-foreground">{articleCount} articles</span>
    <Badge variant="outline" className={`text-[10px] ${color}`}>
      {label}
    </Badge>
  </div>
);

const SourceCoverageRowHeader = ({
  articleCount,
  color,
  label,
  name,
}: Readonly<{ articleCount: number; color: string; label: string; name: string }>) => (
  <div className="flex items-center justify-between text-sm">
    <span className="max-w-[60%] truncate font-medium">{name}</span>
    <SourceCoverageStats articleCount={articleCount} color={color} label={label} />
  </div>
);

const SourceCoverageBar = ({ width }: Readonly<{ width: number }>) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
    <div
      className="h-full rounded-full bg-primary/60 transition-all duration-500"
      style={getBarStyle(width)}
    />
  </div>
);

const SourceCoverageRow = ({
  maxDiversity,
  name,
  sourceId,
  stats,
}: Readonly<{
  maxDiversity: number;
  name: string;
  sourceId: string;
  stats: SourceCoverageRecord;
}>) => {
  const diversity = stats.diversity_score ?? 0;
  const barWidth = (diversity / maxDiversity) * 100;
  const { label, color } = getDiversityLabel(diversity);

  return (
    <div key={sourceId} className="space-y-1">
      <SourceCoverageRowHeader
        articleCount={stats.article_count}
        color={color}
        label={label}
        name={name}
      />
      <SourceCoverageBar width={barWidth} />
    </div>
  );
};

const SourceCoverageRows = ({
  maxDiversity,
  sourceNames,
  sources,
}: Readonly<{
  maxDiversity: number;
  sourceNames: Readonly<Record<string, string>>;
  sources: readonly SourceCoverageEntry[];
}>) => (
  <div className="space-y-3">
    {sources.map(([sourceId, stats]) => (
      <SourceCoverageRow
        key={sourceId}
        maxDiversity={maxDiversity}
        name={sourceNames[sourceId] ?? sourceId}
        sourceId={sourceId}
        stats={stats}
      />
    ))}
  </div>
);

const SourceCoverageResult = ({
  className,
  onRetry,
  sourceNames,
  sources: coverageSources,
}: Readonly<{
  className: string;
  onRetry: () => void;
  sourceNames: Readonly<Record<string, string>>;
  sources: SourceCoverageMap | undefined;
}>) => {
  if (!coverageSources) {
    return null;
  }
  const sources = Object.entries(coverageSources).toSorted(
    (leftEntry, rightEntry) =>
      (rightEntry[1].diversity_score ?? 0) - (leftEntry[1].diversity_score ?? 0),
  );
  const maxDiversity = Math.max(
    ...sources.map((sourceEntry) => sourceEntry[1].diversity_score ?? 0),
    1,
  );
  return (
    <SourceCoverageContent
      className={className}
      maxDiversity={maxDiversity}
      sourceNames={sourceNames}
      sources={sources}
      onRetry={onRetry}
    />
  );
};

const SourceCoverageContent = ({
  className,
  maxDiversity,
  sourceNames,
  sources,
  onRetry,
}: Readonly<{
  className: string;
  maxDiversity: number;
  sourceNames: Readonly<Record<string, string>>;
  sources: readonly SourceCoverageEntry[];
  onRetry: () => void;
}>) => (
  <div className={className}>
    <SourceCoverageHeader onRetry={onRetry} />
    <SourceCoverageRows maxDiversity={maxDiversity} sourceNames={sourceNames} sources={sources} />
    <p className="mt-4 text-xs text-muted-foreground">
      This compares each selected outlet&apos;s overall topic spread, not how the same story was
      framed across two outlets.
    </p>
  </div>
);

export const SourceCoverageComparison = (props: Readonly<SourceCoverageComparisonProps>) => {
  const { sourceIds, sourceNames = EMPTY_SOURCE_NAMES, className = "" } = props;
  const { coverage, error, loadCoverage, loading } = useSourceCoverageQuery(sourceIds);

  if (sourceIds.length < 2) {
    return (
      <div className={`text-sm text-muted-foreground ${className}`}>
        Select at least 2 sources to compare coverage
      </div>
    );
  }
  if (loading) {
    return <SourceCoverageLoading className={className} />;
  }
  if (error) {
    return (
      <SourceCoverageError
        className={className}
        message={getCoverageErrorMessage(error)}
        onRetry={loadCoverage}
      />
    );
  }
  return (
    <SourceCoverageResult
      className={className}
      sourceNames={sourceNames}
      sources={coverage?.sources}
      onRetry={loadCoverage}
    />
  );
};
