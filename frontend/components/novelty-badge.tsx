"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { NoveltyScoreResponse } from "@/lib/api";
import { fetchNoveltyScore } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

interface NoveltyBadgeProps {
  readonly articleId: number;
  readonly className?: string;
  readonly readingHistory: readonly number[];
}

interface NoveltyPresentation {
  readonly color: string;
  readonly label: string;
}

interface NoveltyScoreBadgeProps {
  readonly className: string;
  readonly novelty: Readonly<NoveltyScoreResponse>;
}

const NOVELTY_HIGH_THRESHOLD = 0.7,
 NOVELTY_RELATED_THRESHOLD = 0.4,
 NO_HISTORY_COUNT = 0,
 NoveltyBadge = ({
  articleId,
  readingHistory,
  className = "",
}: Readonly<NoveltyBadgeProps>) => {
  const { data: novelty, isLoading: loading, error } = useQuery<NoveltyScoreResponse>({
    enabled: readingHistory.length > NO_HISTORY_COUNT,
    queryFn: () => fetchNoveltyScore(articleId, readingHistory),
    queryKey: ["novelty-score", articleId, readingHistory],
    retry: 1,
  });

  if (readingHistory.length === NO_HISTORY_COUNT) {
    return false;
  }

  if (loading) {
    return (
      <Badge variant="outline" className={className}>
        <Loader2 className="w-3 h-3 animate-spin mr-1" />
        <span className="text-[10px]">Checking...</span>
      </Badge>
    );
  }

  if (error || novelty === undefined) {
    return false;
  }

  return <NoveltyScoreBadge className={className} novelty={novelty} />;
},

 NoveltyScoreBadge = ({ className, novelty }: Readonly<NoveltyScoreBadgeProps>) => {
  const { color, label } = getNoveltyPresentation(novelty.novelty_score),
   percentage = Math.round(novelty.novelty_score * PERCENTAGE_SCALE);

  return (
    <Badge
      variant="outline"
      className={`${color} ${className}`}
      title={`${percentage}% novel compared to ${novelty.history_size} articles you've read`}
    >
      <Sparkles className="w-3 h-3 mr-1" />
      <span className="text-[10px]">{label}</span>
    </Badge>
  );
},

 PERCENTAGE_SCALE = 100,
 getNoveltyPresentation = (score: number): NoveltyPresentation => {
  if (score >= NOVELTY_HIGH_THRESHOLD) {
    return {
      color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
      label: "New topic",
    };
  }

  if (score >= NOVELTY_RELATED_THRESHOLD) {
    return {
      color: "bg-amber-500/15 text-amber-400 border-amber-500/40",
      label: "Related",
    };
  }

  return {
    color: "bg-slate-500/15 text-slate-400 border-slate-500/40",
    label: "Similar",
  };
};

export { NoveltyBadge };
