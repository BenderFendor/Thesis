"use client";

import { Loader2, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchArticleTopics } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

interface SemanticTagsProps {
  readonly articleId: number;
  readonly className?: string;
  readonly maxTags?: number;
}

interface SemanticTag {
  readonly cluster_id: number;
  readonly keywords?: readonly string[];
  readonly label: string;
  readonly similarity: number | null;
}

interface SemanticTagsListProps {
  readonly className: string;
  readonly topics: readonly SemanticTag[];
}

const DEFAULT_MAX_TAGS = 3,
 EMPTY_TAG_COUNT = 0,
 EMPTY_TOPICS: readonly SemanticTag[] = [],
 FIRST_TAG_INDEX = 0,

 SemanticTags = ({
  articleId,
  className = "",
  maxTags = DEFAULT_MAX_TAGS,
}: Readonly<SemanticTagsProps>) => {
  const { data, isLoading: loading, error } = useQuery({
    queryFn: () => fetchArticleTopics(articleId),
    queryKey: buildSemanticTagsQueryKey(articleId),
    retry: 1,
  }),
   topics: readonly SemanticTag[] = data?.topics.slice(FIRST_TAG_INDEX, maxTags) ?? EMPTY_TOPICS;

  if (loading) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || topics.length === EMPTY_TAG_COUNT) {
    return false;
  }

  return <SemanticTagsList className={className} topics={topics} />;
},

 SemanticTagsList = ({ className, topics }: Readonly<SemanticTagsListProps>) => (
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
),

 buildSemanticTagsQueryKey = (articleId: number): readonly [string, number] => [
  "article-topics",
  articleId,
];

export { SemanticTags };
