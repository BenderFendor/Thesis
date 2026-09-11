"use client";

import { Clock, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatArticleDateTime } from "@/lib/date-formatters";

const getArticleMatchLabel = (similarity: number | null | undefined): string => {
  if (similarity === null || similarity === undefined) {
    return "Match unavailable";
  }
  return `${Math.round(similarity * 100)}% match`;
};

const ArticleMatchBadge = ({ similarity }: Readonly<{ similarity: number | null | undefined }>) => (
  <Badge variant="outline" className="text-[9px]">
    {getArticleMatchLabel(similarity)}
  </Badge>
);

const ArticleDate = ({ publishedAt }: Readonly<{ publishedAt?: string | null }>) => (
  <span className="flex items-center gap-1">
    <Clock className="w-3 h-3" />
    {formatArticleDateTime(publishedAt)}
  </span>
);

const ArticleOriginalAnchor = ({ url }: Readonly<{ url: string }>) => (
  <a href={url} target="_blank" rel="noopener noreferrer">
    <ExternalLink className="h-4 w-4 mr-2" />
    Read Original
  </a>
);

export { ArticleDate, ArticleMatchBadge, ArticleOriginalAnchor };
