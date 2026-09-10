"use client";

import { X } from "lucide-react";
import type { NewsArticle } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { ReactElement } from "react";
import { SafeImage } from "@/components/safe-image";

import { formatArticleDate } from "@/lib/date-formatters";
import { getArticleSummaryVisibility } from "@/lib/reading-queue-content";
import { isUsableImage } from "@/lib/article-image";

const ARTICLE_IMAGE_HEIGHT = 384;
const ARTICLE_IMAGE_WIDTH = 1280;
const ZERO = 0;

interface ArticleDetailHeaderProps {
  readonly article: NewsArticle;
  readonly index: number;
  readonly count: number;
  readonly readTime?: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
}

const ArticlePosition = ({
  count,
  index,
  readTime,
}: Readonly<Pick<ArticleDetailHeaderProps, "count" | "index" | "readTime">>): ReactElement => (
  <div className="flex items-center gap-3 mt-2">
    <p className="text-muted-foreground text-xs">
      Article {index + 1} of {count}
    </p>
    {readTime !== undefined && readTime > ZERO && (
      <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-2 py-1 text-primary text-xs">
        {readTime} min read
      </span>
    )}
  </div>
);

const ArticleDetailHeaderText = ({
  article,
  count,
  index,
  readTime,
}: Readonly<
  Pick<ArticleDetailHeaderProps, "article" | "count" | "index" | "readTime">
>): ReactElement => (
  <div className="flex-1 mr-4">
    <h1 className="font-bold text-2xl leading-tight font-serif">{article.title}</h1>
    <p className="mt-2 text-muted-foreground text-sm">{article.source}</p>
    <ArticlePosition count={count} index={index} readTime={readTime} />
  </div>
);

const PreviousArticleButton = ({
  disabled,
  onPrevious: handlePrevious,
}: Readonly<{ disabled: boolean; onPrevious: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    onClick={handlePrevious}
    disabled={disabled}
    title="Previous article (← Arrow)"
  >
    ← Prev
  </Button>
);

const NextArticleButton = ({
  disabled,
  onNext: handleNext,
}: Readonly<{ disabled: boolean; onNext: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    onClick={handleNext}
    disabled={disabled}
    title="Next article (→ Arrow)"
  >
    Next →
  </Button>
);

const CloseArticleButton = ({
  onClose: handleClose,
}: Readonly<{ onClose: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="ghost"
    onClick={handleClose}
    className="flex-shrink-0"
    aria-label="Close article"
  >
    <X className="h-5 w-5" />
  </Button>
);

const ArticleDetailHeaderActions = ({
  count,
  index,
  onClose: handleClose,
  onNext: handleNext,
  onPrevious: handlePrevious,
}: Readonly<
  Pick<ArticleDetailHeaderProps, "count" | "index" | "onClose" | "onNext" | "onPrevious">
>): ReactElement => (
  <div className="flex items-center gap-2 flex-shrink-0">
    <PreviousArticleButton disabled={index === ZERO} onPrevious={handlePrevious} />
    <NextArticleButton disabled={index === count - 1} onNext={handleNext} />
    <CloseArticleButton onClose={handleClose} />
  </div>
);

const ArticleDetailHeader = ({
  article,
  count,
  index,
  onClose: handleClose,
  onNext: handleNext,
  onPrevious: handlePrevious,
  readTime,
}: ArticleDetailHeaderProps): ReactElement => (
  <div className="flex items-center justify-between border-b border-border p-6 flex-shrink-0">
    <ArticleDetailHeaderText article={article} count={count} index={index} readTime={readTime} />
    <ArticleDetailHeaderActions
      count={count}
      index={index}
      onClose={handleClose}
      onNext={handleNext}
      onPrevious={handlePrevious}
    />
  </div>
);

const getArticleFallbackText = (article: NewsArticle): string => {
  if (article.content !== undefined && article.content !== "") {
    return article.content;
  }
  return article.summary;
};

const FullArticleLoading = (): ReactElement => (
  <div className="flex items-center gap-3 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
    <p className="text-gray-400 text-sm">Loading full article text...</p>
  </div>
);

const FullArticleBody = ({
  article,
  articleLoading,
  fullArticleText,
}: Readonly<{
  article: NewsArticle;
  articleLoading: boolean;
  fullArticleText?: string;
}>): ReactElement => {
  if (articleLoading) {
    return <FullArticleLoading />;
  }
  if (fullArticleText !== undefined && fullArticleText !== "") {
    return (
      <div className="text-foreground text-gray-300 leading-relaxed whitespace-pre-wrap text-sm">
        {fullArticleText}
      </div>
    );
  }
  return (
    <div className="text-foreground text-gray-300 leading-relaxed text-sm">
      {getArticleFallbackText(article)}
    </div>
  );
};

const FullArticleSection = ({
  article,
  articleLoading,
  fullArticleText,
}: Readonly<{
  article: NewsArticle;
  articleLoading: boolean;
  fullArticleText?: string;
}>): ReactElement => (
  <div>
    <h3 className="font-bold text-lg mb-2">Full Article</h3>
    <FullArticleBody
      article={article}
      articleLoading={articleLoading}
      fullArticleText={fullArticleText}
    />
  </div>
);

const ArticleFeaturedImage = ({
  article,
}: Readonly<{ article: NewsArticle }>): ReactElement | undefined => {
  if (!isUsableImage(article.image)) {
    return void 0;
  }
  return (
    <div className="rounded-lg overflow-hidden">
      <SafeImage
        src={article.image}
        alt={article.title}
        width={ARTICLE_IMAGE_WIDTH}
        height={ARTICLE_IMAGE_HEIGHT}
        className="w-full h-96 object-cover"
      />
    </div>
  );
};

const PublishedDateField = ({
  publishedAt,
}: Readonly<{ publishedAt: string }>): ReactElement | undefined => {
  if (publishedAt === "") {
    return void 0;
  }
  return (
    <div>
      <span className="font-semibold">Published:</span> {formatArticleDate(publishedAt)}
    </div>
  );
};

const SourceField = ({ source }: Readonly<{ source: string }>): ReactElement => (
  <div>
    <span className="font-semibold">Source:</span> {source}
  </div>
);

const ArticleMetaBar = ({ article }: Readonly<{ article: NewsArticle }>): ReactElement => (
  <div className="flex flex-wrap gap-4 border-b border-border pb-4 text-muted-foreground text-sm">
    <PublishedDateField publishedAt={article.publishedAt} />
    <SourceField source={article.source} />
  </div>
);

const SummarySection = ({ summary }: Readonly<{ summary: string }>): ReactElement => (
  <div>
    <h3 className="font-bold text-lg mb-2">Summary</h3>
    <p>{summary}</p>
  </div>
);

const ArticleTextSection = ({ content }: Readonly<{ content: string }>): ReactElement => (
  <div>
    <h3 className="font-bold text-lg mb-2">Article Text</h3>
    <p className="whitespace-pre-wrap text-sm">{content}</p>
  </div>
);

const NoContentMessage = (): ReactElement => <p>No content available for this article.</p>;

const ArticleSummaryContent = ({
  article,
  articleLoading,
  fullArticleText,
}: Readonly<{
  article: NewsArticle;
  articleLoading: boolean;
  fullArticleText?: string;
}>): ReactElement => {
  const { showNoContent, showSummary, showText } = getArticleSummaryVisibility(
    article,
    articleLoading,
    fullArticleText,
  );
  return (
    <div className="text-foreground space-y-4 text-base leading-relaxed">
      {showSummary && <SummarySection summary={article.summary} />}
      <FullArticleSection
        article={article}
        articleLoading={articleLoading}
        fullArticleText={fullArticleText}
      />
      {showText && <ArticleTextSection content={article.content ?? ""} />}
      {showNoContent && <NoContentMessage />}
    </div>
  );
};

export {
  ArticleDetailHeader,
  ArticleFeaturedImage,
  ArticleMetaBar,
  ArticleSummaryContent,
};
