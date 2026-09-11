"use client";

import type { NewsArticle } from "@/lib/api";
import { SafeImage } from "@/components/safe-image";
import { formatArticleDate } from "@/lib/date-formatters";
import { isUsableImage } from "@/lib/article-image";
import { useCallback } from "react";

const ARTICLE_IMAGE_HEIGHT = 96;
const ARTICLE_IMAGE_WIDTH = 128;

interface InlineArticleCardProps {
  readonly article: Readonly<NewsArticle>;
  readonly handleOpenArticle: (article: Readonly<NewsArticle>) => void;
}

interface InlineArticlePartProps {
  readonly article: Readonly<NewsArticle>;
}

const InlineArticleImage = ({ article }: Readonly<InlineArticlePartProps>) => (
  <div className="h-48 shrink-0 overflow-hidden rounded-2xl bg-card sm:h-24 sm:w-32">
    <SafeImage
      src={article.image}
      alt={article.title}
      width={ARTICLE_IMAGE_WIDTH}
      height={ARTICLE_IMAGE_HEIGHT}
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
    />
  </div>
);

const InlineArticleTitle = ({ article }: Readonly<InlineArticlePartProps>) => (
  <div>
    <h4 className="font-medium text-foreground line-clamp-2 text-base transition-colors group-hover:text-primary">
      {article.title}
    </h4>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">
      {article.summary}
    </p>
  </div>
);

const InlineArticleMetadata = ({ article }: Readonly<InlineArticlePartProps>) => (
  <div className="mt-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
    <span className="text-primary/80">{article.source}</span>
    <span aria-hidden="true">•</span>
    <span>{formatArticleDate(article.publishedAt)}</span>
  </div>
);

const InlineArticleDetails = ({ article }: Readonly<InlineArticlePartProps>) => (
  <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
    <InlineArticleTitle article={article} />
    <InlineArticleMetadata article={article} />
  </div>
);

const InlineArticleCard = ({ article, handleOpenArticle }: Readonly<InlineArticleCardProps>) => {
  const onOpen = useCallback(() => {
    handleOpenArticle(article);
  }, [article, handleOpenArticle]);
  return (
    <button
      onClick={onOpen}
      className="not-prose group relative my-6 block w-full overflow-hidden rounded-3xl border border-border/40 bg-card/30 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-card/50 hover:shadow-2xl hover:shadow-black/30"
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {isUsableImage(article.image) && <InlineArticleImage article={article} />}
        <InlineArticleDetails article={article} />
      </div>
    </button>
  );
};

export { InlineArticleCard };
