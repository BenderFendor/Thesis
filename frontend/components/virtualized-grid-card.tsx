"use client";

import { ArticleCardDate } from "@/components/article-card-date";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VirtualizedGridCardActions } from "@/components/virtualized-grid-card-actions";
import { isUsableImage } from "@/lib/article-image";
import type { NewsArticle } from "@/lib/api";
import { SafeImage } from "@/components/safe-image";
import Link from "next/link";
import { memo, useCallback, useMemo } from "react";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { CARD_HEIGHT, GAP } from "./virtualized-grid-constants";

interface VirtualizedGridCardProps {
  readonly article: Readonly<NewsArticle>;
  readonly articleNumber: number;
  readonly cardWidth: number;
  readonly onArticleClick: (article: Readonly<NewsArticle>) => void;
}

interface VirtualizedGridCardMediaProps {
  readonly article: Readonly<NewsArticle>;
  readonly articleNumber: number;
  readonly hasRealImage: boolean;
}

const VirtualizedGridCardPlaceholderBadge = ({
  articleNumber,
}: Readonly<{ articleNumber: number }>): React.JSX.Element => (
  <div className="absolute left-2 top-2">
    <Badge
      variant="outline"
      className="border-white/10 bg-background/20 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground backdrop-blur-sm"
    >
      {articleNumber}#
    </Badge>
  </div>
);

const VirtualizedGridCardPlaceholderTitle = ({
  title,
}: Readonly<{ title: string }>): React.JSX.Element => (
  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
    <h3 className="line-clamp-4 font-serif text-base font-bold leading-relaxed tracking-tight text-foreground/90 drop-shadow-sm">
      {title}
    </h3>
  </div>
);

const VirtualizedGridCardPlaceholder = ({
  article,
  articleNumber,
}: Readonly<Pick<VirtualizedGridCardMediaProps, "article" | "articleNumber">>): ReactNode => (
  <>
    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent_60%)]" />
    <VirtualizedGridCardPlaceholderBadge articleNumber={articleNumber} />
    <VirtualizedGridCardPlaceholderTitle title={article.title} />
  </>
);

const VirtualizedGridCardMediaContent = ({
  article,
  articleNumber,
  hasRealImage,
}: Readonly<VirtualizedGridCardMediaProps>): ReactNode => {
  if (hasRealImage) {
    return (
      <>
        <SafeImage
          src={article.image}
          alt={article.title}
          fill
          className="h-full w-full object-cover grayscale transition duration-300 group-hover:grayscale-0"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      </>
    );
  }
  return <VirtualizedGridCardPlaceholder article={article} articleNumber={articleNumber} />;
};

const VirtualizedGridCardCategory = ({
  category,
}: Readonly<{ category: string }>): React.JSX.Element => (
  <div className="absolute bottom-1 left-1">
    <Badge
      variant="outline"
      className="border-white/20 bg-black/70 px-1.5 py-0 text-[8px] font-semibold text-foreground"
    >
      {category}
    </Badge>
  </div>
);

const VirtualizedGridCardMedia = ({
  article,
  articleNumber,
  hasRealImage,
}: Readonly<VirtualizedGridCardMediaProps>): React.JSX.Element => (
  <div className="relative aspect-video flex-shrink-0 overflow-hidden bg-[var(--news-bg-primary)]/40">
    <VirtualizedGridCardMediaContent
      article={article}
      articleNumber={articleNumber}
      hasRealImage={hasRealImage}
    />
    <VirtualizedGridCardActions article={article} />
    <VirtualizedGridCardCategory category={article.category} />
  </div>
);

const VirtualizedGridCardSource = ({
  source,
  sourceId,
}: Readonly<Pick<NewsArticle, "source" | "sourceId">>): React.JSX.Element => {
  const handleSourceClick = useCallback<MouseEventHandler<HTMLAnchorElement>>((event) => {
    event.stopPropagation();
  }, []);
  return (
    <Link
      href={`/source/${encodeURIComponent(sourceId)}`}
      onClick={handleSourceClick}
      className="mb-2 truncate text-xs uppercase tracking-widest text-muted-foreground/70 transition-colors hover:text-primary"
    >
      {source}
    </Link>
  );
};

const VirtualizedGridCardTitle = ({
  hasRealImage,
  title,
}: Readonly<Pick<NewsArticle, "title"> & { hasRealImage: boolean }>): ReactNode => {
  if (!hasRealImage) {
    return null;
  }
  return (
    <h3 className="mb-2 line-clamp-3 font-serif text-sm font-bold leading-snug text-foreground">
      {title}
    </h3>
  );
};

const getVirtualizedGridSummaryClassName = (hasRealImage: boolean): string => {
  if (hasRealImage) {
    return "line-clamp-2";
  }
  return "line-clamp-6 mt-1";
};

const VirtualizedGridCardSummary = ({
  hasRealImage,
  summary,
}: Readonly<Pick<NewsArticle, "summary"> & { hasRealImage: boolean }>): React.JSX.Element => (
  <p
    className={`flex-1 text-xs leading-relaxed text-muted-foreground/70 ${getVirtualizedGridSummaryClassName(hasRealImage)}`}
  >
    {summary}
  </p>
);

const VirtualizedGridCardContent = ({
  article,
  hasRealImage,
}: Readonly<{ article: Readonly<NewsArticle>; hasRealImage: boolean }>): React.JSX.Element => (
  <CardContent className="flex flex-1 flex-col p-6">
    <VirtualizedGridCardSource source={article.source} sourceId={article.sourceId} />
    <VirtualizedGridCardTitle hasRealImage={hasRealImage} title={article.title} />
    <VirtualizedGridCardSummary hasRealImage={hasRealImage} summary={article.summary} />
    <div className="mt-3 flex items-center gap-1 border-t border-white/10 pt-3 text-xs text-muted-foreground/70">
      <ArticleCardDate date={article.publishedAt} />
    </div>
  </CardContent>
);

const VirtualizedGridCard = memo(
  ({ article, articleNumber, cardWidth, onArticleClick }: Readonly<VirtualizedGridCardProps>) => {
    const handleCardClick = useCallback(() => {
      onArticleClick(article);
    }, [article, onArticleClick]);
    const cardStyle = useMemo<CSSProperties>(
      () => ({ height: CARD_HEIGHT, width: cardWidth + GAP }),
      [cardWidth],
    );
    const hasRealImage = isUsableImage(article.image);
    return (
      <div style={cardStyle} className="p-0">
        <Card
          className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-none border border-white/10 bg-[var(--news-bg-secondary)] shadow-none transition-colors duration-200 hover:border-primary/60"
          onClick={handleCardClick}
        >
          <VirtualizedGridCardMedia
            article={article}
            articleNumber={articleNumber}
            hasRealImage={hasRealImage}
          />
          <VirtualizedGridCardContent article={article} hasRealImage={hasRealImage} />
        </Card>
      </div>
    );
  },
);

VirtualizedGridCard.displayName = "VirtualizedGridCard";

export { VirtualizedGridCard };
