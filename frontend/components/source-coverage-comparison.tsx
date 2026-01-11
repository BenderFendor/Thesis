"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchSourceCoverage,
  SourceCoverageResponse,
  SourceCoverageStats,
} from "@/lib/api";

interface SourceCoverageComparisonProps {
  sourceIds: string[];
  sourceNames?: Record<string, string>;
  className?: string;
}

export function SourceCoverageComparison({
  sourceIds,
  sourceNames = {},
  className = "",
}: SourceCoverageComparisonProps) {
  const [coverage, setCoverage] = useState<SourceCoverageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCoverage = useCallback(async () => {
    if (sourceIds.length < 2) {
      setError("Select at least 2 sources to compare");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchSourceCoverage(sourceIds, 100);
      setCoverage(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [sourceIds]);

  useEffect(() => {
    if (sourceIds.length >= 2) {
      loadCoverage();
    }
  }, [sourceIds, loadCoverage]);

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
      <div className={`${className}`}>
        <p className="text-sm text-rose-400 mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={loadCoverage}>
          <RefreshCw className="w-3 h-3 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!coverage || !coverage.sources) {
    return null;
  }

  const sources = Object.entries(coverage.sources).sort(
    ([, a], [, b]) => (b.diversity_score || 0) - (a.diversity_score || 0)
  );

  const maxDiversity = Math.max(
    ...sources.map(([, s]) => s.diversity_score || 0),
    1
  );

  const getDiversityLabel = (score: number) => {
    if (score >= 1.2) return { label: "Broad", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" };
    if (score >= 0.8) return { label: "Moderate", color: "bg-amber-500/15 text-amber-400 border-amber-500/40" };
    return { label: "Focused", color: "bg-slate-500/15 text-slate-400 border-slate-500/40" };
  };

  return (
    <div className={`${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Topic Coverage Comparison</h4>
        </div>
        <Button variant="ghost" size="sm" onClick={loadCoverage}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      <div className="space-y-3">
        {sources.map(([sourceId, stats]) => {
          const name = sourceNames[sourceId] || sourceId;
          const diversity = stats.diversity_score || 0;
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
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Coverage diversity measures how broadly each source covers different topics.
        Higher diversity means more varied content.
      </p>
    </div>
  );
}
