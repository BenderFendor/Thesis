"use client";

import { useQuery } from "@tanstack/react-query";
import { Tag, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchArticleTopics, ArticleTopic } from "@/lib/api";

interface SemanticTagsProps {
  articleId: number;
  className?: string;
  maxTags?: number;
}

export function SemanticTags({
  articleId,
  className = "",
  maxTags = 3,
}: SemanticTagsProps) {
  const { data, isLoading: loading, error } = useQuery({
    queryKey: ["article-topics", articleId],
    queryFn: () => fetchArticleTopics(articleId),
    retry: 1,
  });
  const topics: ArticleTopic[] = data?.topics.slice(0, maxTags) ?? [];

  if (loading) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || topics.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <Tag className="w-3 h-3 text-muted-foreground" />
      {topics.map((topic) => (
        <Badge
          key={topic.cluster_id}
          variant="outline"
          className="text-[10px] px-1.5 py-0 bg-primary/5 border-primary/20 text-primary/80"
        >
          {topic.label}
        </Badge>
      ))}
    </div>
  );
}
