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

export const SourceCoverageComparison = ({
  sourceIds,
  sourceNames = EMPTY_SOURCE_NAMES,
  className = "",
}: Readonly<SourceCoverageComparisonProps>) => {
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
  const errorMessage = (() => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load";
})();

  if (sourceIds.length < 2) {
    return (
      <div className={`text-sm text-muted-foreground ${className}`}>
        Select at least 2 sources to compare coverage
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Analyzing source coverage...
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <p className="text-sm text-rose-400 mb-2">{errorMessage}</p>
        <Button variant="outline" size="sm" onClick={loadCoverage}>
          <RefreshCw className="w-3 h-3 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!coverage?.sources) {
    return null;
  }

  const sources = Object.entries(coverage.sources).toSorted(
      ([, a], [, b]) => (b.diversity_score ?? 0) - (a.diversity_score ?? 0),
    );
  const maxDiversity = Math.max(...sources.map(([, s]) => s.diversity_score ?? 0), 1);
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

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Source Coverage Diversity</h4>
        </div>
        <Button variant="ghost" size="sm" onClick={loadCoverage}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      <div className="space-y-3">
        {sources.map(([sourceId, stats]) => {
          const name = sourceNames[sourceId] ?? sourceId;
          const diversity = stats.diversity_score ?? 0;
          const barWidth = (diversity / maxDiversity) * 100;
          const { label, color } = getDiversityLabel(diversity);

          return (
            <div key={sourceId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate max-w-[60%]">{name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {stats.article_count} articles
                  </span>
                  <Badge variant="outline" className={`text-[10px] ${color}`}>
                    {label}
                  </Badge>
                </div>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary/60 rounded-full transition-all duration-500"
                  style={getBarStyle(barWidth)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        This compares each selected outlet&apos;s overall topic spread, not how the same story was
        framed across two outlets.
      </p>
    </div>
  );
};
