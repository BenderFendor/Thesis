"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/safe-image";
import { fetchRelatedArticles } from "@/lib/api";
import type { RelatedArticle } from "@/lib/api";
import { isUsableImage } from "@/lib/article-image";
import { hasText } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

interface RelatedArticlesProps {
  readonly articleId: number;
  readonly onArticleClick?: (article: RelatedArticle) => void;
  readonly limit?: number;
  readonly className?: string;
}

interface RelatedArticleCardProps {
  readonly article: RelatedArticle;
  readonly onArticleClick?: (article: RelatedArticle) => void;
}

interface RelatedArticlesContentProps {
  readonly className: string;
  readonly errorMessage: string | null;
  readonly onArticleClick?: (article: RelatedArticle) => void;
  readonly related: readonly RelatedArticle[];
}

const EMPTY_RELATED_ARTICLES: readonly RelatedArticle[] = [];

const formatScore = (score: number): string => `${Math.round(score * 100)}%`;

const RelatedArticleImage = ({ article }: Readonly<Pick<RelatedArticleCardProps, "article">>) => {
  if (!isUsableImage(article.image)) {
    return null;
  }
  return (
    <SafeImage
      src={article.image}
      alt=""
      width={64}
      height={48}
      className="w-16 h-12 object-cover rounded flex-shrink-0"
    />
  );
};

const RelatedArticleMeta = ({ article }: Readonly<Pick<RelatedArticleCardProps, "article">>) => (
  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
    <span>{article.source}</span>
    <span>-</span>
    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
      {formatScore(article.similarity_score)} match
    </Badge>
  </div>
);

const RelatedArticleInfo = ({ article }: Readonly<Pick<RelatedArticleCardProps, "article">>) => (
  <div className="flex-1 min-w-0">
    <h5 className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
      {article.title}
    </h5>
    <RelatedArticleMeta article={article} />
  </div>
);

const RelatedArticleCardRow = ({ article }: Readonly<Pick<RelatedArticleCardProps, "article">>) => (
  <div className="flex items-start gap-3">
    <RelatedArticleImage article={article} />
    <RelatedArticleInfo article={article} />
    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
  </div>
);

const RelatedArticleCardSurface = ({
  article,
}: Readonly<Pick<RelatedArticleCardProps, "article">>) => (
  <div className="rounded-lg border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10 hover:border-white/20">
    <RelatedArticleCardRow article={article} />
  </div>
);

const RelatedArticleCard = ({ article, onArticleClick }: Readonly<RelatedArticleCardProps>) => {
  const handleClick = useCallback(() => {
    onArticleClick?.(article);
  }, [article, onArticleClick]);
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Open related article: ${article.title}`}
      className="w-full text-left group"
    >
      <RelatedArticleCardSurface article={article} />
    </button>
  );
};

const RelatedArticlesMessage = ({
  message,
  className,
}: Readonly<{ message: string; className: string }>) => (
  <div className={className}>
    <h4 className="text-sm font-medium text-muted-foreground mb-2">Related Articles</h4>
    <p className="text-xs text-muted-foreground/70">{message}</p>
  </div>
);

const RelatedArticlesContent = ({
  className,
  errorMessage,
  onArticleClick,
  related,
}: Readonly<RelatedArticlesContentProps>) => {
  if (hasText(errorMessage)) {
    return <RelatedArticlesMessage className={className} message={errorMessage} />;
  }
  if (related.length === 0) {
    return <RelatedArticlesMessage className={className} message="No similar articles found" />;
  }
  return (
    <div className={className}>
      <h4 className="text-sm font-medium text-muted-foreground mb-3">Related Articles</h4>
      <div className="space-y-3">
        {related.map((article) => (
          <RelatedArticleCard
            key={`${article.id}-${article.url}`}
            article={article}
            onArticleClick={onArticleClick}
          />
        ))}
      </div>
    </div>
  );
};

const RelatedArticlesLoading = ({
  className,
}: Readonly<Pick<RelatedArticlesContentProps, "className">>) => (
  <div className={className}>
    <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
      <Loader2 className="w-3 h-3 animate-spin" />
      Finding related articles...
    </h4>
  </div>
);

const RelatedArticles = (props: Readonly<RelatedArticlesProps>) => {
  const { articleId, onArticleClick, limit = 5, className = "" } = props;
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
  let errorMessage: string | null = null;
  if (error instanceof Error) {
    errorMessage = error.message;
  }
  if (loading) {
    return <RelatedArticlesLoading className={className} />;
  }
  return (
    <RelatedArticlesContent
      className={className}
      errorMessage={errorMessage}
      onArticleClick={onArticleClick}
      related={related}
    />
  );
};

export { RelatedArticles };
