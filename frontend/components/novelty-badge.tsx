"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchNoveltyScore, NoveltyScoreResponse } from "@/lib/api";

interface NoveltyBadgeProps {
  articleId: number;
  readingHistory: number[];
  className?: string;
}

export function NoveltyBadge({
  articleId,
  readingHistory,
  className = "",
}: NoveltyBadgeProps) {
  const [novelty, setNovelty] = useState<NoveltyScoreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readingHistory.length === 0) {
      return;
    }

    let cancelled = false;

    async function loadNovelty() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchNoveltyScore(articleId, readingHistory);
        if (!cancelled) {
          setNovelty(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadNovelty();
    return () => {
      cancelled = true;
    };
  }, [articleId, readingHistory]);

  if (readingHistory.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <Badge variant="outline" className={`${className}`}>
        <Loader2 className="w-3 h-3 animate-spin mr-1" />
        <span className="text-[10px]">Checking...</span>
      </Badge>
    );
  }

  if (error || !novelty) {
    return null;
  }

  const score = novelty.novelty_score;
  const label = score >= 0.7 ? "New topic" : score >= 0.4 ? "Related" : "Similar";
  const color =
    score >= 0.7
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
      : score >= 0.4
      ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
      : "bg-slate-500/15 text-slate-400 border-slate-500/40";

  return (
    <Badge
      variant="outline"
      className={`${color} ${className}`}
      title={`${Math.round(score * 100)}% novel compared to ${novelty.history_size} articles you've read`}
    >
      <Sparkles className="w-3 h-3 mr-1" />
      <span className="text-[10px]">{label}</span>
    </Badge>
  );
}
