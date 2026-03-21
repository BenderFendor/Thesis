"use client";

import { useQuery } from "@tanstack/react-query";
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
  const { data: novelty, isLoading: loading, error } = useQuery<NoveltyScoreResponse>({
    queryKey: ["novelty-score", articleId, readingHistory],
    queryFn: () => fetchNoveltyScore(articleId, readingHistory),
    enabled: readingHistory.length > 0,
    retry: 1,
  });

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
