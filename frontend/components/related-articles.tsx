"use client";

import { useState, useEffect } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchRelatedArticles, RelatedArticle } from "@/lib/api";

interface RelatedArticlesProps {
  articleId: number;
  onArticleClick?: (article: RelatedArticle) => void;
  limit?: number;
  className?: string;
}

export function RelatedArticles({
  articleId,
  onArticleClick,
  limit = 5,
  className = "",
}: RelatedArticlesProps) {
  const [related, setRelated] = useState<RelatedArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRelated() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchRelatedArticles(articleId, limit, true);
        if (!cancelled) {
          setRelated(response.related);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadRelated();
    return () => {
      cancelled = true;
    };
  }, [articleId, limit]);

  if (loading) {
    return (
      <div className={`${className}`}>
        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Finding related articles...
        </h4>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${className}`}>
        <h4 className="text-sm font-medium text-muted-foreground mb-2">
          Related Articles
        </h4>
        <p className="text-xs text-muted-foreground/70">{error}</p>
      </div>
    );
  }

  if (related.length === 0) {
    return (
      <div className={`${className}`}>
        <h4 className="text-sm font-medium text-muted-foreground mb-2">
          Related Articles
        </h4>
        <p className="text-xs text-muted-foreground/70">
          No similar articles found
        </p>
      </div>
    );
  }

  const formatScore = (score: number) => `${Math.round(score * 100)}%`;

  return (
    <div className={`${className}`}>
      <h4 className="text-sm font-medium text-muted-foreground mb-3">
        Related Articles
      </h4>
      <div className="space-y-3">
        {related.map((article) => (
          <button
            key={article.id}
            type="button"
            onClick={() => onArticleClick?.(article)}
            className="w-full text-left group"
          >
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10 hover:border-white/20">
              <div className="flex items-start gap-3">
                {article.image && (
                  <img
                    src={article.image}
                    alt=""
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
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {formatScore(article.similarity_score)} match
                    </Badge>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
