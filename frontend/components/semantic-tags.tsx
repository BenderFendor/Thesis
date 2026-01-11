"use client";

import { useState, useEffect } from "react";
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
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTopics() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchArticleTopics(articleId);
        if (!cancelled) {
          setTopics(response.topics.slice(0, maxTags));
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

    loadTopics();
    return () => {
      cancelled = true;
    };
  }, [articleId, maxTags]);

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
