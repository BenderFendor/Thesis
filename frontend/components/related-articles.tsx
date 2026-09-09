"use client";
import { hasText } from "@/lib/utils";

import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RelatedArticle } from "@/lib/api";
import { SafeImage } from "@/components/safe-image";
import { fetchRelatedArticles } from "@/lib/api";
import { isUsableImage } from "@/lib/article-image";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

interface RelatedArticlesProps {
  readonly articleId: number;
  readonly onArticleClick?: (article: RelatedArticle) => void;
  readonly limit?: number;
  readonly className?: string;
}

const EMPTY_RELATED_ARTICLES: readonly RelatedArticle[] = [];

export const RelatedArticles = ({
  articleId,
  onArticleClick,
  limit = 5,
  className = "",
}: RelatedArticlesProps) => {
  const {
      data,
      isLoading: loading,
      error,
    } = useQuery({
      queryFn: () => fetchRelatedArticles(articleId, limit, true),
      queryKey: ["related-articles", articleId, limit],
      retry: 1,
    });
  const related: readonly RelatedArticle[] = data?.related ?? EMPTY_RELATED_ARTICLES;
  const errorMessage = (() => {
  if (error instanceof Error) {
    return error.message;
  }
  return null;
})();
  const articleHandlers = useMemo(
      () =>
        new Map(
          related.map((article) => [
            `${article.id}-${article.url}`,
            () => onArticleClick?.(article),
          ]),
        ),
      [onArticleClick, related],
    );

  if (loading) {
    return (
      <div className={className}>
        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Finding related articles...
        </h4>
      </div>
    );
  }

  if (hasText(errorMessage)) {
    return (
      <div className={className}>
        <h4 className="text-sm font-medium text-muted-foreground mb-2">Related Articles</h4>
        <p className="text-xs text-muted-foreground/70">{errorMessage}</p>
      </div>
    );
  }

  if (related.length === 0) {
    return (
      <div className={className}>
        <h4 className="text-sm font-medium text-muted-foreground mb-2">Related Articles</h4>
        <p className="text-xs text-muted-foreground/70">No similar articles found</p>
      </div>
    );
  }

  const formatScore = (score: number) => `${Math.round(score * 100)}%`;

  return (
    <div className={className}>
      <h4 className="text-sm font-medium text-muted-foreground mb-3">Related Articles</h4>
      <div className="space-y-3">
        {related.map((article) => {
          const articleKey = `${article.id}-${article.url}`;
          return (
            <button
              key={articleKey}
              type="button"
              onClick={articleHandlers.get(articleKey)}
              aria-label={`Open related article: ${article.title}`}
              className="w-full text-left group"
            >
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10 hover:border-white/20">
                <div className="flex items-start gap-3">
                  {isUsableImage(article.image) && (
                    <SafeImage
                      src={article.image}
                      alt=""
                      width={64}
                      height={48}
                      className="w-16 h-12 object-cover rounded flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h5 className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </h5>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{article.source}</span>
                      <span>-</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {formatScore(article.similarity_score)} match
                      </Badge>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
