"use client";

import {
  AlertTriangle,
  Bookmark,
  Bug,
  ChevronDown,
  DollarSign,
  ExternalLink,
  Heart,
  List,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Children, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
} from "react";
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { z } from "zod";

import { ArticleDetailModal } from "@/components/article-detail-modal";
import { ArticleInlineEmbed } from "@/components/article-inline-embed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NoveltyBadge } from "@/components/novelty-badge";
import { SafeImage } from "@/components/safe-image";
import { SemanticTags } from "@/components/semantic-tags";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingHistory } from "@/hooks/useReadingHistory";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { useFavorites } from "@/hooks/use-favorites";
import {
  API_BASE_URL,
  analyzeArticle,
  fetchSourceDebugData,
  getSourceById,
} from "@/lib/api";
import type {
  ArticleAnalysis,
  NewsArticle,
  NewsSource,
  SourceDebugData,
} from "@/lib/api";
import { activateCardFromKeyDown } from "@/lib/keyboard-activation";

const ARTICLE_IMAGE_HEIGHT = 384,
 ARTICLE_IMAGE_WIDTH = 1280,
 CARD_IMAGE_HEIGHT = 160,
 CARD_IMAGE_WIDTH = 640,
 CARD_INDENT_LIMIT = 16,
 CARD_INDENT_STEP = 4,
 CARD_OVERLAP = -8,
 DIGEST_IMAGE_HEIGHT = 48,
 DIGEST_IMAGE_WIDTH = 64,
 MAX_SEMANTIC_TAGS = 3,
 NO_ARTICLE_INDEX = -1,
 PREVIEW_WORD_LIMIT = 150,
 READ_SPEED_WPM = 230,
 ZERO = 0,

 CODE_STYLE: CSSProperties = {
  backgroundColor: "rgba(0, 0, 0, 0.3)",
  color: "rgb(168, 85, 247)",
},
 PRIMARY_BUTTON_STYLE: CSSProperties = {
  backgroundColor: "var(--primary)",
  color: "var(--primary-foreground)",
},
 CARD_STYLE: CSSProperties = {
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
},
 EXPANDED_CARD_STYLE: CSSProperties = {
  backgroundColor: "var(--news-bg-secondary)",
  borderColor: "var(--primary)",
  outlineColor: "var(--primary)",
  outlineOffset: "0px",
  outlineWidth: "2px",
},
 COLLAPSED_CARD_STYLE: CSSProperties = {
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  outlineOffset: "0px",
  outlineWidth: "0px",
},
 MUTED_TEXT_STYLE: CSSProperties = {
  color: "var(--muted-foreground)",
},
 FOREGROUND_TEXT_STYLE: CSSProperties = {
  color: "var(--foreground)",
},
 QUEUE_COUNT_STYLE: CSSProperties = {
  backgroundColor: "var(--primary)",
  color: "var(--primary-foreground)",
},
 READ_TIME_STYLE: CSSProperties = {
  backgroundColor: "var(--primary)",
  color: "var(--primary)",
},
 ARTICLE_READ_TIME_STYLE: CSSProperties = {
  backgroundColor: "rgba(168, 85, 247, 0.2)",
  border: "1px solid rgba(168, 85, 247, 0.3)",
  color: "var(--primary)",
},
 LOADING_BADGE_STYLE: CSSProperties = {
  backgroundColor: "rgba(59, 130, 246, 0.15)",
  color: "rgb(59, 130, 246)",
},
 DIGEST_CARD_STYLE: CSSProperties = {
  backgroundColor: "rgba(168, 85, 247, 0.1)",
  borderColor: "rgba(168, 85, 247, 0.3)",
},
 DARK_CARD_STYLE: CSSProperties = {
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  borderColor: "var(--border)",
},
 DIGEST_PRE_STYLE: CSSProperties = {
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  color: "var(--foreground)",
},
 BLOCKQUOTE_STYLE: CSSProperties = {
  borderColor: "var(--primary)",
  color: "var(--muted-foreground)",
},
 SHEET_STYLE: CSSProperties = {
  backgroundColor: "var(--news-bg-primary)",
},
 SOURCE_DEBUG_STYLE: CSSProperties = {
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  borderColor: "var(--border)",
},
 ARTICLE_META_STYLE: CSSProperties = {
  borderColor: "var(--border)",
  color: "var(--muted-foreground)",
},
 DIGEST_HEADER_STYLE: CSSProperties = {
  borderColor: "var(--border)",
},
 DIGEST_CONTENT_STYLE: CSSProperties = {
  color: "var(--foreground)",
},

 DigestResponseSchema = z.object({
  content: z.string().optional(),
  digest: z.string().optional(),
}),
 FullArticleResponseSchema = z.object({
  full_text: z.string().optional(),
  text: z.string().optional(),
}),
 StructuredArticleSchema = z.object({
  link: z.string().optional(),
  url: z.string().optional(),
}),
 StructuredArticlesResponseSchema = z.object({
  articles: z.array(StructuredArticleSchema).optional(),
});

type DigestResponse = z.infer<typeof DigestResponseSchema>;
type FullArticleResponse = z.infer<typeof FullArticleResponseSchema>;
type StructuredArticle = z.infer<typeof StructuredArticleSchema>;

type DigestDirection = "next" | "previous";
type MarkdownChildrenProps = Readonly<{ children?: ReactNode }>;

interface QueueCardMetaProps {
  readonly article: Readonly<NewsArticle>;
  readonly estimatedReadTime?: number;
  readonly readingHistoryIds: readonly number[];
}

interface QueueCardExpandableProps {
  readonly article: Readonly<NewsArticle>;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}

interface QueueCardActionsProps {
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}

interface QueueCardProps {
  readonly article: Readonly<NewsArticle>;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly estimatedReadTime?: number;
  readonly readingHistoryIds: readonly number[];
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}

interface ArticleSummaryVisibility {
  readonly showNoContent: boolean;
  readonly showSummary: boolean;
  readonly showText: boolean;
}

const getArticlePreview = (article: Readonly<NewsArticle>): string => {
  if (article.summary !== "") {
    return getPreviewWithLimit(article.summary);
  }
  if (article.content !== undefined && article.content !== "") {
    return getPreviewWithLimit(article.content);
  }
  return "No description available";
},

 getArticleSummaryVisibility = (
  article: Readonly<NewsArticle>,
  articleLoading: boolean,
  fullArticleText: string | undefined,
): ArticleSummaryVisibility => {
  const hasContent = Boolean(article.content),
   hasFullArticle = Boolean(fullArticleText),
   hasSummary = Boolean(article.summary),
   presentFieldCount = [hasContent, hasFullArticle, hasSummary].filter(Boolean).length;
  return {
    showNoContent: presentFieldCount === ZERO,
    showSummary: hasSummary && article.summary !== article.content,
    showText: hasContent && !hasFullArticle && !articleLoading,
  };
},

 getPreviewWithLimit = (text: string): string => {
  const words = text.split(/\s+/u);
  if (words.length <= PREVIEW_WORD_LIMIT) {
    return text;
  }
  return `${words.slice(ZERO, PREVIEW_WORD_LIMIT).join(" ")} ...`;
},

 calculateReadTime = (text: string): number => {
  if (text === "") {
    return ZERO;
  }
  const wordCount = text.trim().split(/\s+/u).length;
  return Math.ceil(wordCount / READ_SPEED_WPM);
},

 getQueueCardStyle = (index: number): CSSProperties => ({
  marginLeft: `${Math.min(index * CARD_INDENT_STEP, CARD_INDENT_LIMIT)}px`,
  marginTop: index > ZERO ? `${CARD_OVERLAP}px` : "0px",
}),

 getQueueCardSurfaceClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "relative rounded-xl border overflow-hidden backdrop-blur-sm transition-all duration-300 p-4 flex flex-col shadow-2xl ring-2";
  }
  return "relative rounded-xl border overflow-hidden backdrop-blur-sm transition-all duration-300 p-4 flex flex-col shadow-lg group-hover:shadow-xl";
},

 getQueueCardSurfaceStyle = (isExpanded: boolean): CSSProperties => {
  if (isExpanded) {
    return EXPANDED_CARD_STYLE;
  }
  return COLLAPSED_CARD_STYLE;
},

 getQueueCardHeadingClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "font-bold leading-tight group-hover:text-primary transition-colors text-base";
  }
  return "font-bold leading-tight group-hover:text-primary transition-colors text-sm line-clamp-2";
},

 getExpandIndicatorStyle = (isExpanded: boolean): CSSProperties => {
  if (isExpanded) {
    return { color: "var(--muted-foreground)", transform: "rotate(180deg)" };
  }
  return { color: "var(--muted-foreground)", transform: "rotate(0deg)" };
},

 getCardActivationHandler = (
  onToggle: () => void,
): ((event: KeyboardEvent<HTMLElement>) => void) => (
  event: KeyboardEvent<HTMLElement>,
): void => {
  activateCardFromKeyDown(event, onToggle);
},

 readJsonResponse = async <T,>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T | undefined> => {
  try {
    const body = await response.text(),
    // SAFETY: JSON.parse output is validated immediately by the supplied Zod schema.
     parsed = JSON.parse(body) as unknown,
     result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch (error) {
    console.error("Failed to decode API response:", error);
  }
  return undefined;
},

 getStructuredArticleUrl = (
  article: Readonly<StructuredArticle>,
  index: number,
): string => {
  if (article.url !== undefined && article.url !== "") {
    return article.url;
  }
  if (article.link !== undefined && article.link !== "") {
    return article.link;
  }
  return `about:blank#${index}`;
},

 parseStructuredArticles = (text: string): readonly StructuredArticle[] => {
  try {
    // SAFETY: JSON.parse output is validated immediately by the Zod schema.
    const parsed = JSON.parse(text) as unknown,
     result = StructuredArticlesResponseSchema.safeParse(parsed);
    if (result.success) {
      return result.data.articles ?? [];
    }
  } catch (error) {
    console.error("Failed to parse structured articles JSON:", error);
  }
  return [];
},

 isStructuredDigestCode = (
  className: string | undefined,
  text: string,
): boolean => {
  if (className === "language-json:articles") {
    return true;
  }
  const trimmedText = text.trim();
  return trimmedText.startsWith("{") && trimmedText.includes('"articles"');
};

interface DigestCodeRendererProps {
  readonly className?: string;
  readonly children?: ReactNode;
  readonly onOpenArticle: (article: NewsArticle) => void;
}

const DigestCodeRenderer = ({
  children,
  className,
  onOpenArticle,
}: DigestCodeRendererProps): ReactElement => {
  const text = String(children).replace(/\n$/u, "");
  if (isStructuredDigestCode(className, text)) {
    return <StructuredArticleEmbeds text={text} onOpenArticle={onOpenArticle} />;
  }
  return (
    <code className="px-2 py-1 rounded text-sm" style={CODE_STYLE}>
      {text}
    </code>
  );
};

interface StructuredArticleEmbedsProps {
  readonly text: string;
  readonly onOpenArticle: (article: NewsArticle) => void;
}

const StructuredArticleEmbeds = ({
  onOpenArticle,
  text,
}: StructuredArticleEmbedsProps): ReactElement => {
  const articles = parseStructuredArticles(text);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-3">
      {articles.map((article, index) => {
        const url = getStructuredArticleUrl(article, index);
        return (
          <ArticleInlineEmbed
            key={`${url}-${index}`}
            url={url}
            onOpen={onOpenArticle}
          />
        );
      })}
    </div>
  );
},

 QueueCardSource = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): ReactElement => (
  <p className="text-xs" style={MUTED_TEXT_STYLE}>
    {article.source}
  </p>
),

 QueueCardReadTime = ({
  estimatedReadTime,
}: Readonly<{ estimatedReadTime: number }>): ReactElement => (
  <span
    className="text-xs px-1.5 py-0.5 rounded"
    style={READ_TIME_STYLE}
  >
    {estimatedReadTime}m
  </span>
),

 QueueCardLoadingBadge = (): ReactElement => (
  <Badge className="text-xs flex items-center gap-1 animate-pulse" style={LOADING_BADGE_STYLE}>
    <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
    Loading...
  </Badge>
),

 QueueCardMeta = ({
  article,
  estimatedReadTime,
  readingHistoryIds,
}: QueueCardMetaProps): ReactElement => {
  const hasReadTime =
    estimatedReadTime !== undefined && estimatedReadTime > ZERO,
   hasPreloadedData =
    article._queueData?.preloadedAt !== undefined &&
    article._queueData.preloadedAt !== ZERO;
  return (
    <div className="flex items-center gap-2 mt-1">
      <QueueCardSource article={article} />
      {hasReadTime && (
        <QueueCardReadTime estimatedReadTime={estimatedReadTime} />
      )}
      {readingHistoryIds.length > ZERO && (
        <NoveltyBadge
          articleId={article.id}
          readingHistory={[...readingHistoryIds]}
        />
      )}
      {!hasPreloadedData && <QueueCardLoadingBadge />}
    </div>
  );
},

 QueueCardReadButton = ({
  onOpen,
}: Readonly<{ onOpen: () => void }>): ReactElement => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      onOpen();
    },
    [onOpen],
  );
  return (
    <Button
      size="sm"
      className="flex-1"
      onClick={handleClick}
      style={PRIMARY_BUTTON_STYLE}
    >
      Read Article
    </Button>
  );
},

 QueueCardRemoveButton = ({
  onRemove,
}: Readonly<{ onRemove: () => void }>): ReactElement => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    },
    [onRemove],
  );
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      className="text-destructive hover:text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
},

QueueCardActions = ({
  onOpen,
  onRemove,
}: QueueCardActionsProps): ReactElement => (
  <div className="flex gap-2 pt-2">
    <QueueCardReadButton onOpen={onOpen} />
    <QueueCardRemoveButton onRemove={onRemove} />
  </div>
),

 QueueCardExpandable = ({
  article,
  onOpen,
  onRemove,
}: QueueCardExpandableProps): ReactElement => (
  <div
    className="space-y-3 pt-3 mt-3 border-t animate-in fade-in slide-in-from-top-2 duration-200"
    style={{ borderColor: "var(--border)" }}
  >
    {article.image !== "" && (
      <SafeImage
        src={article.image}
        alt={article.title}
        width={CARD_IMAGE_WIDTH}
        height={CARD_IMAGE_HEIGHT}
        className="w-full h-40 object-cover rounded-lg"
      />
    )}
    <p className="text-sm" style={FOREGROUND_TEXT_STYLE}>
      {getArticlePreview(article)}
    </p>
    <QueueCardActions onOpen={onOpen} onRemove={onRemove} />
  </div>
),

 QueueCardIndexBadge = ({
  index,
}: Readonly<{ index: number }>): ReactElement => (
  <div
    className="flex-shrink-0 text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center"
    style={QUEUE_COUNT_STYLE}
  >
    {index + 1}
  </div>
),

 QueueCardThumbnail = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): ReactElement | undefined => {
  if (article.image === "") {
    return undefined;
  }
  return (
    <div
      className="flex-shrink-0 h-12 w-16 rounded-lg overflow-hidden border"
      style={{ borderColor: "var(--border)" }}
    >
      <SafeImage
        src={article.image}
        alt={article.title}
        width={DIGEST_IMAGE_WIDTH}
        height={DIGEST_IMAGE_HEIGHT}
        className="w-full h-full object-cover"
      />
    </div>
  );
},

 QueueCardTitleBlock = ({
  article,
  estimatedReadTime,
  isExpanded,
  readingHistoryIds,
}: Readonly<{
  article: Readonly<NewsArticle>;
  estimatedReadTime?: number;
  isExpanded: boolean;
  readingHistoryIds: readonly number[];
}>): ReactElement => (
  <div className="flex-1 min-w-0">
    <h3 className={getQueueCardHeadingClassName(isExpanded)} style={FOREGROUND_TEXT_STYLE}>
      {article.title}
    </h3>
    <QueueCardMeta
      article={article}
      estimatedReadTime={estimatedReadTime}
      readingHistoryIds={readingHistoryIds}
    />
    {isExpanded && (
      <SemanticTags
        articleId={article.id}
        maxTags={MAX_SEMANTIC_TAGS}
        className="mt-2"
      />
    )}
  </div>
),

 QueueCardExpandIndicator = ({
  isExpanded,
}: Readonly<{ isExpanded: boolean }>): ReactElement => (
  <div
    className="flex-shrink-0 transition-transform"
    style={getExpandIndicatorStyle(isExpanded)}
  >
    <ChevronDown className="h-5 w-5" />
  </div>
),

 QueueCardHeader = ({
  article,
  estimatedReadTime,
  index,
  isExpanded,
  readingHistoryIds,
}: Readonly<{
  article: Readonly<NewsArticle>;
  estimatedReadTime?: number;
  index: number;
  isExpanded: boolean;
  readingHistoryIds: readonly number[];
}>): ReactElement => (
  <div className="flex items-start gap-3">
    <QueueCardIndexBadge index={index} />
    <QueueCardTitleBlock
      article={article}
      estimatedReadTime={estimatedReadTime}
      isExpanded={isExpanded}
      readingHistoryIds={readingHistoryIds}
    />
    {!isExpanded && <QueueCardThumbnail article={article} />}
    <QueueCardExpandIndicator isExpanded={isExpanded} />
  </div>
),

 QueueCardSurface = ({
  article,
  estimatedReadTime,
  index,
  isExpanded,
  onKeyDown,
  onOpen,
  onRemove,
  onToggle,
  readingHistoryIds,
}: QueueCardProps & {
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}): ReactElement => (
  <div
    onClick={onToggle}
    onKeyDown={onKeyDown}
    role="button"
    tabIndex={ZERO}
    className="w-full transition-all duration-300 ease-out cursor-pointer text-left group transform hover:scale-105"
    style={getQueueCardStyle(index)}
  >
    <div
      className={getQueueCardSurfaceClassName(isExpanded)}
      style={getQueueCardSurfaceStyle(isExpanded)}
    >
      <QueueCardHeader
        article={article}
        estimatedReadTime={estimatedReadTime}
        index={index}
        isExpanded={isExpanded}
        readingHistoryIds={readingHistoryIds}
      />
      {isExpanded && (
        <QueueCardExpandable
          article={article}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      )}
    </div>
  </div>
),

 QueueCard = ({
  article,
  estimatedReadTime,
  index,
  isExpanded,
  onOpen,
  onRemove,
  onToggle,
  readingHistoryIds,
}: QueueCardProps): ReactElement => {
  const onKeyDown = useCallback(
    getCardActivationHandler(onToggle),
    [onToggle],
  );
  return (
    <article>
      <QueueCardSurface
        article={article}
        estimatedReadTime={estimatedReadTime}
        index={index}
        isExpanded={isExpanded}
        onKeyDown={onKeyDown}
        onOpen={onOpen}
        onRemove={onRemove}
        onToggle={onToggle}
        readingHistoryIds={readingHistoryIds}
      />
    </article>
  );
};

interface ArticleDetailHeaderProps {
  readonly article: Readonly<NewsArticle>;
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
    <p className="text-xs" style={MUTED_TEXT_STYLE}>
      Article {index + 1} of {count}
    </p>
    {readTime !== undefined && readTime > ZERO && (
      <span className="text-xs px-2 py-1 rounded-full" style={ARTICLE_READ_TIME_STYLE}>
        {readTime} min read
      </span>
    )}
  </div>
),

 ArticleDetailHeaderText = ({
  article,
  count,
  index,
  readTime,
}: Readonly<Pick<ArticleDetailHeaderProps, "article" | "count" | "index" | "readTime">>): ReactElement => (
  <div className="flex-1 mr-4">
    <h1 className="font-bold text-2xl leading-tight font-serif">
      {article.title}
    </h1>
    <p className="text-sm mt-2" style={MUTED_TEXT_STYLE}>
      {article.source}
    </p>
    <ArticlePosition count={count} index={index} readTime={readTime} />
  </div>
),

 PreviousArticleButton = ({
  disabled,
  onPrevious,
}: Readonly<{ disabled: boolean; onPrevious: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    onClick={onPrevious}
    disabled={disabled}
    title="Previous article (← Arrow)"
  >
    ← Prev
  </Button>
),

 NextArticleButton = ({
  disabled,
  onNext,
}: Readonly<{ disabled: boolean; onNext: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    onClick={onNext}
    disabled={disabled}
    title="Next article (→ Arrow)"
  >
    Next →
  </Button>
),

 CloseArticleButton = ({
  onClose,
}: Readonly<{ onClose: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="ghost"
    onClick={onClose}
    className="flex-shrink-0"
    aria-label="Close article"
  >
    <X className="h-5 w-5" />
  </Button>
),

 ArticleDetailHeaderActions = ({
  count,
  index,
  onClose,
  onNext,
  onPrevious,
}: Readonly<Pick<ArticleDetailHeaderProps, "count" | "index" | "onClose" | "onNext" | "onPrevious">>): ReactElement => (
  <div className="flex items-center gap-2 flex-shrink-0">
    <PreviousArticleButton disabled={index === ZERO} onPrevious={onPrevious} />
    <NextArticleButton disabled={index === count - 1} onNext={onNext} />
    <CloseArticleButton onClose={onClose} />
  </div>
),

 ArticleDetailHeader = ({
  article,
  count,
  index,
  onClose,
  onNext,
  onPrevious,
  readTime,
}: ArticleDetailHeaderProps): ReactElement => (
  <div
    className="flex items-center justify-between p-6 border-b flex-shrink-0"
    style={DIGEST_HEADER_STYLE}
  >
    <ArticleDetailHeaderText
      article={article}
      count={count}
      index={index}
      readTime={readTime}
    />
    <ArticleDetailHeaderActions
      count={count}
      index={index}
      onClose={onClose}
      onNext={onNext}
      onPrevious={onPrevious}
    />
  </div>
),

 getArticleFallbackText = (article: Readonly<NewsArticle>): string => {
  if (article.content !== undefined && article.content !== "") {
    return article.content;
  }
  return article.summary;
},

 FullArticleLoading = (): ReactElement => (
  <div className="flex items-center gap-3 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
    <p className="text-gray-400 text-sm">Loading full article text...</p>
  </div>
),

 FullArticleBody = ({
  article,
  articleLoading,
  fullArticleText,
}: Readonly<{
  article: Readonly<NewsArticle>;
  articleLoading: boolean;
  fullArticleText?: string;
}>): ReactElement => {
  if (articleLoading) {
    return <FullArticleLoading />;
  }
  if (fullArticleText !== undefined && fullArticleText !== "") {
    return (
      <div
        className="text-gray-300 leading-relaxed whitespace-pre-wrap text-sm"
        style={FOREGROUND_TEXT_STYLE}
      >
        {fullArticleText}
      </div>
    );
  }
  return (
    <div className="text-gray-300 leading-relaxed text-sm" style={FOREGROUND_TEXT_STYLE}>
      {getArticleFallbackText(article)}
    </div>
  );
},

 FullArticleSection = ({
  article,
  articleLoading,
  fullArticleText,
}: Readonly<{
  article: Readonly<NewsArticle>;
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

interface ArticleDetailActionButtonsProps {
  readonly isLiked: boolean;
  readonly isFavorite: boolean;
  readonly isBookmarked: boolean;
  readonly isRead: boolean;
  readonly onLike: () => void;
  readonly onFavorite: () => void;
  readonly onBookmark: () => void;
  readonly onMarkRead: () => void;
}

const getLikeButtonClassName = (active: boolean): string => {
  if (active) {
    return "text-red-400";
  }
  return "text-gray-400";
},

 getFavoriteButtonClassName = (active: boolean): string => {
  if (active) {
    return "text-yellow-400";
  }
  return "text-gray-400";
},

 getBookmarkButtonClassName = (active: boolean): string => {
  if (active) {
    return "text-yellow-400";
  }
  return "text-gray-400";
},

 getActionIconClassName = (active: boolean, withMargin: boolean): string => {
  let className = "h-4 w-4";
  if (withMargin) {
    className += " mr-2";
  }
  if (active) {
    className += " fill-current";
  }
  return className;
},

 getReadButtonVariant = (isRead: boolean): "default" | "outline" => {
  if (isRead) {
    return "default";
  }
  return "outline";
},

 getReadButtonClassName = (isRead: boolean): string => {
  if (isRead) {
    return "text-green-400";
  }
  return "text-gray-400";
},

 LikeActionButton = ({
  isLiked,
  onLike,
}: Readonly<Pick<ArticleDetailActionButtonsProps, "isLiked" | "onLike">>): ReactElement => (
  <Button
    size="sm"
    variant="ghost"
    onClick={onLike}
    className={getLikeButtonClassName(isLiked)}
  >
    <Heart className={getActionIconClassName(isLiked, true)} />
    Like
  </Button>
),

 FavoriteActionButton = ({
  isFavorite,
  onFavorite,
}: Readonly<Pick<ArticleDetailActionButtonsProps, "isFavorite" | "onFavorite">>): ReactElement => (
  <Button
    size="sm"
    variant="ghost"
    onClick={onFavorite}
    className={getFavoriteButtonClassName(isFavorite)}
  >
    <Star className={getActionIconClassName(isFavorite, true)} />
    Favorite
  </Button>
),

 BookmarkActionButton = ({
  isBookmarked,
  onBookmark,
}: Readonly<Pick<ArticleDetailActionButtonsProps, "isBookmarked" | "onBookmark">>): ReactElement => (
  <Button
    size="sm"
    variant="ghost"
    onClick={onBookmark}
    className={getBookmarkButtonClassName(isBookmarked)}
  >
    <Bookmark className={getActionIconClassName(isBookmarked, false)} />
    Bookmark
  </Button>
),

 ReadActionButton = ({
  isRead,
  onMarkRead,
}: Readonly<Pick<ArticleDetailActionButtonsProps, "isRead" | "onMarkRead">>): ReactElement => (
  <Button
    size="sm"
    variant={getReadButtonVariant(isRead)}
    onClick={onMarkRead}
    className={getReadButtonClassName(isRead)}
    title="Mark as read (M)"
  >
    Read
  </Button>
),

 ArticleDetailActionButtons = ({
  isBookmarked,
  isFavorite,
  isLiked,
  isRead,
  onBookmark,
  onFavorite,
  onLike,
  onMarkRead,
}: ArticleDetailActionButtonsProps): ReactElement => (
  <div className="flex gap-2 pt-4 border-t flex-wrap" style={DIGEST_HEADER_STYLE}>
    <LikeActionButton isLiked={isLiked} onLike={onLike} />
    <FavoriteActionButton isFavorite={isFavorite} onFavorite={onFavorite} />
    <BookmarkActionButton isBookmarked={isBookmarked} onBookmark={onBookmark} />
    <ReadActionButton isRead={isRead} onMarkRead={onMarkRead} />
  </div>
),

 ArticleFeaturedImage = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): ReactElement | undefined => {
  if (article.image === "") {
    return undefined;
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
},

 PublishedDateField = ({
  publishedAt,
}: Readonly<{ publishedAt: string }>): ReactElement | undefined => {
  if (publishedAt === "") {
    return undefined;
  }
  return (
    <div>
      <span className="font-semibold">Published:</span>{" "}
      {new Date(publishedAt).toLocaleDateString()}
    </div>
  );
},

 SourceField = ({
  source,
}: Readonly<{ source: string }>): ReactElement => (
  <div>
    <span className="font-semibold">Source:</span>{" "}
    {source}
  </div>
),

 ArticleMetaBar = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): ReactElement => (
  <div className="flex flex-wrap gap-4 text-sm pb-4 border-b" style={ARTICLE_META_STYLE}>
    <PublishedDateField publishedAt={article.publishedAt} />
    <SourceField source={article.source} />
  </div>
),

 SummarySection = ({
  summary,
}: Readonly<{ summary: string }>): ReactElement => (
  <div>
    <h3 className="font-bold text-lg mb-2">Summary</h3>
    <p>{summary}</p>
  </div>
),

 ArticleTextSection = ({
  content,
}: Readonly<{ content: string }>): ReactElement => (
  <div>
    <h3 className="font-bold text-lg mb-2">Article Text</h3>
    <p className="whitespace-pre-wrap text-sm">{content}</p>
  </div>
),

 NoContentMessage = (): ReactElement => (
  <p>No content available for this article.</p>
),

 ArticleSummaryContent = ({
  article,
  articleLoading,
  fullArticleText,
}: Readonly<{
  article: Readonly<NewsArticle>;
  articleLoading: boolean;
  fullArticleText?: string;
}>): ReactElement => {
  const { showNoContent, showSummary, showText } = getArticleSummaryVisibility(
    article,
    articleLoading,
    fullArticleText,
  );
  return (
    <div className="space-y-4 text-base leading-relaxed" style={FOREGROUND_TEXT_STYLE}>
      {showSummary && (
        <SummarySection summary={article.summary} />
      )}
      <FullArticleSection
        article={article}
        articleLoading={articleLoading}
        fullArticleText={fullArticleText}
      />
      {showText && (
        <ArticleTextSection content={article.content ?? ""} />
      )}
      {showNoContent && <NoContentMessage />}
    </div>
  );
};

interface ArticleDetailMainProps extends ArticleDetailActionButtonsProps {
  readonly article: Readonly<NewsArticle>;
  readonly articleLoading: boolean;
  readonly fullArticleText?: string;
}

const ArticleDetailMain = ({
  article,
  articleLoading,
  fullArticleText,
  isBookmarked,
  isFavorite,
  isLiked,
  isRead,
  onBookmark,
  onFavorite,
  onLike,
  onMarkRead,
}: ArticleDetailMainProps): ReactElement => (
  <div className="lg:col-span-2 space-y-6">
    <ArticleFeaturedImage article={article} />
    <ArticleMetaBar article={article} />
    <ArticleSummaryContent
      article={article}
      articleLoading={articleLoading}
      fullArticleText={fullArticleText}
    />
    <ArticleDetailActionButtons
      isBookmarked={isBookmarked}
      isFavorite={isFavorite}
      isLiked={isLiked}
      isRead={isRead}
      onBookmark={onBookmark}
      onFavorite={onFavorite}
      onLike={onLike}
      onMarkRead={onMarkRead}
    />
  </div>
),

 KeyboardShortcutRow = ({
  keyLabel,
  text,
}: Readonly<{ keyLabel: string; text: string }>): ReactElement => (
  <div>
    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs mr-2">{keyLabel}</kbd>
    {text}
  </div>
),

 KeyboardShortcutList = (): ReactElement => (
  <div className="space-y-1" style={MUTED_TEXT_STYLE}>
    <KeyboardShortcutRow keyLabel="→" text="Next article" />
    <KeyboardShortcutRow keyLabel="←" text="Previous article" />
    <KeyboardShortcutRow keyLabel="M" text="Mark as read" />
    <KeyboardShortcutRow keyLabel="Esc" text="Close article" />
  </div>
),

 KeyboardShortcutsCard = (): ReactElement => (
  <div className="rounded-lg p-4 border text-xs" style={CARD_STYLE}>
    <h3 className="font-semibold text-sm text-white mb-2">Keyboard Shortcuts</h3>
    <KeyboardShortcutList />
  </div>
);

interface AiSummaryCardProps {
  readonly aiAnalysisLoading: boolean;
  readonly aiAnalysis?: Readonly<ArticleAnalysis>;
}

const AiSummaryLoading = (): ReactElement => (
  <div
    className="flex items-center justify-center p-4 rounded-lg border"
    style={CARD_STYLE}
  >
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
  </div>
),

 AiSummaryHeader = (): ReactElement => (
  <div className="flex items-center gap-2 mb-3">
    <Sparkles className="h-4 w-4 text-primary" />
    <h3 className="font-semibold text-sm text-white">AI Summary</h3>
  </div>
),

 AiSummaryCard = ({
  aiAnalysis,
  aiAnalysisLoading,
}: AiSummaryCardProps): ReactElement | undefined => {
  if (aiAnalysisLoading) {
    return <AiSummaryLoading />;
  }
  if (
    aiAnalysis === undefined ||
    !
    aiAnalysis.success ||
    aiAnalysis.summary === undefined ||
    aiAnalysis.summary === ""
  ) {
    return undefined;
  }
  return (
    <div className="rounded-lg p-4 border" style={DIGEST_CARD_STYLE}>
      <AiSummaryHeader />
      <p className="text-sm leading-relaxed" style={FOREGROUND_TEXT_STYLE}>
        {aiAnalysis.summary}
      </p>
    </div>
  );
};

type BiasAnalysis = NonNullable<ArticleAnalysis["bias_analysis"]>;

const BiasCardHeader = (): ReactElement => (
  <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-2">
    <AlertTriangle className="h-4 w-4 text-yellow-400" />
    Bias Analysis
  </h3>
),

 BiasScoreBadge = ({
  score,
}: Readonly<{ score: string }>): ReactElement | undefined => {
  if (score === "") {
    return undefined;
  }
  return (
    <Badge className="mb-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
      Score: {score}/10
    </Badge>
  );
},

 BiasDetailRow = ({
  label,
  value,
}: Readonly<{ label: string; value: string }>): ReactElement | undefined => {
  if (value === "") {
    return undefined;
  }
  return (
    <div>
      <span style={MUTED_TEXT_STYLE}>{label}:</span>
      <p style={FOREGROUND_TEXT_STYLE}>{value}</p>
    </div>
  );
},

 BiasDetails = ({
  analysis,
}: Readonly<{ analysis: Readonly<BiasAnalysis> }>): ReactElement => (
  <div className="space-y-2 text-xs">
    <BiasDetailRow label="Tone" value={analysis.tone_bias} />
    <BiasDetailRow label="Framing" value={analysis.framing_bias} />
  </div>
),

 BiasAnalysisCard = ({
  aiAnalysis,
}: Readonly<{ aiAnalysis?: Readonly<ArticleAnalysis> }>): ReactElement | undefined => {
  if (
    aiAnalysis === undefined ||
    !
    aiAnalysis.success ||
    aiAnalysis.bias_analysis === undefined
  ) {
    return undefined;
  }
  const analysis = aiAnalysis.bias_analysis;
  return (
    <div className="rounded-lg p-4 border" style={CARD_STYLE}>
      <BiasCardHeader />
      <BiasScoreBadge score={analysis.overall_bias_score} />
      <BiasDetails analysis={analysis} />
    </div>
  );
};

interface SourceDebugPanelProps {
  readonly debugLoading: boolean;
  readonly debugData?: Readonly<SourceDebugData>;
}

const SourceDebugPanel = ({
  debugData,
  debugLoading,
}: SourceDebugPanelProps): ReactElement => {
  if (debugLoading) {
    return (
      <div className="flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
      </div>
    );
  }
  if (debugData !== undefined) {
    return (
      <div style={FOREGROUND_TEXT_STYLE}>
        Feed has {debugData.parsed_entries.length} entries
      </div>
    );
  }
  return <div style={MUTED_TEXT_STYLE}>No debug data</div>;
};

interface SourceCardProps {
  readonly sourceLoading: boolean;
  readonly source?: Readonly<NewsSource>;
  readonly showSourceDetails: boolean;
  readonly onToggleDetails: () => void;
  readonly debugOpen: boolean;
  readonly onToggleDebug: () => void;
  readonly debugLoading: boolean;
  readonly debugData?: Readonly<SourceDebugData>;
}

const SourceCardHeader = (): ReactElement => (
  <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-3">
    <AlertTriangle className="h-4 w-4 text-yellow-400" />
    Source
  </h3>
),

 SourceLoadingState = (): ReactElement => (
  <div className="flex items-center justify-center p-4">
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
  </div>
),

 SourceFunding = ({
  funding,
}: Readonly<{ funding: readonly string[] }>): ReactElement | undefined => {
  if (funding.length === ZERO) {
    return undefined;
  }
  return (
    <div className="flex items-center gap-2">
      <DollarSign className="h-4 w-4 text-green-400" />
      <span style={FOREGROUND_TEXT_STYLE}>{funding.join(", ")}</span>
    </div>
  );
},

 SourceDetailField = ({
  label,
  value,
}: Readonly<{ label: string; value: string }>): ReactElement => (
  <div>
    <span style={MUTED_TEXT_STYLE}>{label}:</span>
    <p style={FOREGROUND_TEXT_STYLE}>{value}</p>
  </div>
),

 SourceDetails = ({
  source,
}: Readonly<{ source: Readonly<NewsSource> }>): ReactElement | undefined => {
  if (source.url === "") {
    return undefined;
  }
  return (
    <div className="pt-2 border-t space-y-2" style={DIGEST_HEADER_STYLE}>
      <SourceDetailField label="Website" value={source.url} />
      <SourceDetailField label="Category" value={source.category.join(", ")} />
    </div>
  );
},

 SourceDetailsButton = ({
  onToggleDetails,
  showSourceDetails,
}: Readonly<Pick<SourceCardProps, "onToggleDetails" | "showSourceDetails">>): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    onClick={onToggleDetails}
    className="w-full mt-2 text-xs"
  >
    {showSourceDetails ? "Hide" : "Show"} Details
  </Button>
),

 SourceCardBody = ({
  onToggleDetails,
  showSourceDetails,
  source,
  sourceLoading,
}: Readonly<Pick<SourceCardProps, "onToggleDetails" | "showSourceDetails" | "source" | "sourceLoading">>): ReactElement => {
  if (sourceLoading) {
    return <SourceLoadingState />;
  }
  if (source === undefined) {
    return <p className="text-xs" style={MUTED_TEXT_STYLE}>Source info unavailable</p>;
  }
  return (
    <div className="space-y-2 text-xs">
      <SourceFunding funding={source.funding} />
      {showSourceDetails && <SourceDetails source={source} />}
      <SourceDetailsButton
        onToggleDetails={onToggleDetails}
        showSourceDetails={showSourceDetails}
      />
    </div>
  );
},

 SourceDebugButton = ({
  debugOpen,
  onToggleDebug,
}: Readonly<Pick<SourceCardProps, "debugOpen" | "onToggleDebug">>): ReactElement => (
  <Button
    variant="outline"
    size="sm"
    onClick={onToggleDebug}
    className="w-full mt-2 text-xs"
  >
    <Bug className="h-3 w-3 mr-1" />
    {debugOpen ? "Hide" : "Show"} Debug
  </Button>
),

 SourceCardDebug = ({
  debugData,
  debugLoading,
}: Readonly<Pick<SourceCardProps, "debugData" | "debugLoading">>): ReactElement => (
  <div className="mt-2 p-2 rounded text-xs" style={SOURCE_DEBUG_STYLE}>
    <SourceDebugPanel debugLoading={debugLoading} debugData={debugData} />
  </div>
),

 SourceCard = ({
  debugData,
  debugLoading,
  debugOpen,
  onToggleDebug,
  onToggleDetails,
  showSourceDetails,
  source,
  sourceLoading,
}: SourceCardProps): ReactElement => (
  <div className="rounded-lg p-4 border" style={CARD_STYLE}>
    <SourceCardHeader />
    <SourceCardBody
      onToggleDetails={onToggleDetails}
      showSourceDetails={showSourceDetails}
      source={source}
      sourceLoading={sourceLoading}
    />
    <SourceDebugButton debugOpen={debugOpen} onToggleDebug={onToggleDebug} />
    {debugOpen && (
      <SourceCardDebug debugData={debugData} debugLoading={debugLoading} />
    )}
  </div>
);

interface ArticleDetailFooterProps {
  readonly article: Readonly<NewsArticle>;
  readonly isRead: boolean;
  readonly onMarkRead: () => void;
  readonly onRemove: () => void;
}

const ReadSourceLink = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): ReactElement => (
  <a
    href={article.url}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center justify-center gap-2"
  >
    <ExternalLink className="h-4 w-4" />
    Read on Source
  </a>
),

 ReadSourceButton = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): ReactElement => (
  <Button className="flex-1" asChild style={PRIMARY_BUTTON_STYLE}>
    <ReadSourceLink article={article} />
  </Button>
),

 getFooterReadClassName = (isRead: boolean): string => {
  if (isRead) {
    return "text-green-400";
  }
  return "text-gray-400 hover:text-green-400";
},

 MarkReadFooterButton = ({
  isRead,
  onMarkRead,
}: Readonly<Pick<ArticleDetailFooterProps, "isRead" | "onMarkRead">>): ReactElement => (
  <Button
    variant="ghost"
    onClick={onMarkRead}
    className={getFooterReadClassName(isRead)}
    title="Mark as read (M)"
    aria-label="Mark article as read"
  />
),

 RemoveFooterButton = ({
  onRemove,
}: Readonly<{ onRemove: () => void }>): ReactElement => (
  <Button
    variant="ghost"
    onClick={onRemove}
    className="text-destructive hover:text-destructive hover:bg-destructive/10"
  >
    <Trash2 className="h-4 w-4" />
  </Button>
),

 ArticleDetailFooter = ({
  article,
  isRead,
  onMarkRead,
  onRemove,
}: ArticleDetailFooterProps): ReactElement => (
  <div className="flex gap-3 p-6 border-t flex-shrink-0" style={DIGEST_HEADER_STYLE}>
    <ReadSourceButton article={article} />
    <MarkReadFooterButton isRead={isRead} onMarkRead={onMarkRead} />
    <RemoveFooterButton onRemove={onRemove} />
  </div>
);

interface ArticleDetailSidebarProps {
  readonly aiAnalysis?: Readonly<ArticleAnalysis>;
  readonly aiAnalysisLoading: boolean;
  readonly debugData?: Readonly<SourceDebugData>;
  readonly debugLoading: boolean;
  readonly debugOpen: boolean;
  readonly onToggleDebug: () => void;
  readonly onToggleSourceDetails: () => void;
  readonly showSourceDetails: boolean;
  readonly source?: Readonly<NewsSource>;
  readonly sourceLoading: boolean;
}

const ArticleDetailSidebar = ({
  aiAnalysis,
  aiAnalysisLoading,
  debugData,
  debugLoading,
  debugOpen,
  onToggleDebug,
  onToggleSourceDetails,
  showSourceDetails,
  source,
  sourceLoading,
}: ArticleDetailSidebarProps): ReactElement => (
  <div className="lg:col-span-1 space-y-4">
    <KeyboardShortcutsCard />
    <AiSummaryCard
      aiAnalysis={aiAnalysis}
      aiAnalysisLoading={aiAnalysisLoading}
    />
    <BiasAnalysisCard aiAnalysis={aiAnalysis} />
    <SourceCard
      debugData={debugData}
      debugLoading={debugLoading}
      debugOpen={debugOpen}
      onToggleDebug={onToggleDebug}
      onToggleDetails={onToggleSourceDetails}
      showSourceDetails={showSourceDetails}
      source={source}
      sourceLoading={sourceLoading}
    />
  </div>
);

interface ArticleDetailViewProps {
  readonly article: Readonly<NewsArticle>;
  readonly index: number;
  readonly count: number;
  readonly readTime?: number;
  readonly articleLoading: boolean;
  readonly fullArticleText?: string;
  readonly aiAnalysis?: Readonly<ArticleAnalysis>;
  readonly aiAnalysisLoading: boolean;
  readonly source?: Readonly<NewsSource>;
  readonly sourceLoading: boolean;
  readonly showSourceDetails: boolean;
  readonly onToggleSourceDetails: () => void;
  readonly debugOpen: boolean;
  readonly onToggleDebug: () => void;
  readonly debugLoading: boolean;
  readonly debugData?: Readonly<SourceDebugData>;
  readonly isLiked: boolean;
  readonly isFavorite: boolean;
  readonly isBookmarked: boolean;
  readonly isRead: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
  readonly onLike: () => void;
  readonly onFavorite: () => void;
  readonly onBookmark: () => void;
  readonly onMarkRead: () => void;
  readonly onRemove: () => void;
}

const ArticleDetailGrid = ({
  details,
}: Readonly<{ details: Readonly<ArticleDetailViewProps> }>): ReactElement => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
    <ArticleDetailMain
      article={details.article}
      articleLoading={details.articleLoading}
      fullArticleText={details.fullArticleText}
      isBookmarked={details.isBookmarked}
      isFavorite={details.isFavorite}
      isLiked={details.isLiked}
      isRead={details.isRead}
      onBookmark={details.onBookmark}
      onFavorite={details.onFavorite}
      onLike={details.onLike}
      onMarkRead={details.onMarkRead}
    />
    <ArticleDetailSidebar
      aiAnalysis={details.aiAnalysis}
      aiAnalysisLoading={details.aiAnalysisLoading}
      debugData={details.debugData}
      debugLoading={details.debugLoading}
      debugOpen={details.debugOpen}
      onToggleDebug={details.onToggleDebug}
      onToggleSourceDetails={details.onToggleSourceDetails}
      showSourceDetails={details.showSourceDetails}
      source={details.source}
      sourceLoading={details.sourceLoading}
    />
  </div>
),

 ArticleDetailScroll = ({
  details,
}: Readonly<{ details: Readonly<ArticleDetailViewProps> }>): ReactElement => (
  <div className="flex-1 overflow-y-auto">
    <ArticleDetailGrid details={details} />
  </div>
),

 ArticleDetailView = (props: Readonly<ArticleDetailViewProps>): ReactElement => (
  <div className="flex flex-col h-full overflow-hidden">
    <ArticleDetailHeader
      article={props.article}
      count={props.count}
      index={props.index}
      onClose={props.onClose}
      onNext={props.onNext}
      onPrevious={props.onPrevious}
      readTime={props.readTime}
    />
    <ArticleDetailScroll details={props} />
    <ArticleDetailFooter
      article={props.article}
      isRead={props.isRead}
      onMarkRead={props.onMarkRead}
      onRemove={props.onRemove}
    />
  </div>
),

 DigestHeadingOne = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <h1
    className="font-semibold font-serif text-2xl mt-6 mb-3"
    style={FOREGROUND_TEXT_STYLE}
  >
    {children}
  </h1>
),

 DigestHeadingTwo = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <h2
    className="font-semibold font-serif text-xl mt-5 mb-2"
    style={FOREGROUND_TEXT_STYLE}
  >
    {children}
  </h2>
),

 DigestHeadingThree = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <h3
    className="font-semibold font-serif text-lg mt-4 mb-2"
    style={FOREGROUND_TEXT_STYLE}
  >
    {children}
  </h3>
),

 DigestParagraph = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <p className="mb-3 leading-relaxed text-base" style={FOREGROUND_TEXT_STYLE}>
    {children}
  </p>
),

 DigestUnorderedList = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <ul className="list-disc list-inside mb-3 space-y-1" style={FOREGROUND_TEXT_STYLE}>
    {children}
  </ul>
),

 DigestOrderedList = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <ol className="list-decimal list-inside mb-3 space-y-1" style={FOREGROUND_TEXT_STYLE}>
    {children}
  </ol>
),

 DigestListItem = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <li className="ml-2" style={FOREGROUND_TEXT_STYLE}>
    {children}
  </li>
),

 DigestBlockquote = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <blockquote className="border-l-4 pl-4 italic my-3" style={BLOCKQUOTE_STYLE}>
    {children}
  </blockquote>
),

 DigestPre = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <pre className="p-4 rounded mb-3 overflow-x-auto text-sm" style={DIGEST_PRE_STYLE}>
    {children}
  </pre>
),

 DigestStrong = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <strong className="font-semibold" style={{ color: "var(--primary)" }}>
    {children}
  </strong>
),

 DigestEmphasis = ({
  children,
}: MarkdownChildrenProps): ReactElement => (
  <em className="italic" style={FOREGROUND_TEXT_STYLE}>
    {children}
  </em>
);

type MarkdownCodeProps = Readonly<{
  children?: ReactNode;
  className?: string;
}>;

const createDigestComponents = (
  onOpenArticle: (article: NewsArticle) => void,
): Components => ({
  blockquote: DigestBlockquote,
  code: ({ children, className }: MarkdownCodeProps) => (
    <DigestCodeRenderer
      children={children}
      className={className}
      onOpenArticle={onOpenArticle}
    />
  ),
  em: DigestEmphasis,
  h1: DigestHeadingOne,
  h2: DigestHeadingTwo,
  h3: DigestHeadingThree,
  li: DigestListItem,
  ol: DigestOrderedList,
  p: DigestParagraph,
  pre: DigestPre,
  strong: DigestStrong,
  ul: DigestUnorderedList,
}),

 EmbedArticleModal = ({
  article,
  isOpen,
  onClose,
  onNavigate,
}: Readonly<{
  article: Readonly<NewsArticle>;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (direction: "next" | "prev") => void;
}>): ReactElement => (
  <ArticleDetailModal
    article={article}
    isOpen={isOpen}
    onClose={onClose}
    onNavigate={onNavigate}
  />
);

interface DigestMarkdownContentProps {
  readonly digest: string;
  readonly embedModalArticle?: Readonly<NewsArticle>;
  readonly embedModalOpen: boolean;
  readonly onCloseEmbedded: () => void;
  readonly onNavigateArticle: (direction: DigestDirection) => void;
  readonly onOpenArticle: (article: NewsArticle) => void;
}

const DigestMarkdownContent = ({
  digest,
  embedModalArticle,
  embedModalOpen,
  onCloseEmbedded,
  onNavigateArticle,
  onOpenArticle,
}: DigestMarkdownContentProps): ReactElement => {
  const components = useMemo(
    () => createDigestComponents(onOpenArticle),
    [onOpenArticle],
  );
  return (
    <div className="px-6 py-8 prose prose-invert max-w-none" style={DIGEST_CONTENT_STYLE}>
      <ReactMarkdown components={components}>{digest}</ReactMarkdown>
      {embedModalArticle !== undefined && (
        <EmbedArticleModal
          article={embedModalArticle}
          isOpen={embedModalOpen}
          onClose={onCloseEmbedded}
          onNavigate={(direction) => {
            onNavigateArticle(direction === "prev" ? "previous" : "next");
          }}
        />
      )}
    </div>
  );
},

 DigestHeaderTitle = ({
  articleCount,
}: Readonly<{ articleCount: number }>): ReactElement => (
  <div>
    <SheetTitle className="text-3xl font-semibold font-serif">Reading Digest</SheetTitle>
    <p className="text-sm text-muted-foreground mt-1">
      {articleCount} articles summarized for quick review
    </p>
  </div>
),

 DigestCloseButton = ({
  onClose,
}: Readonly<{ onClose: () => void }>): ReactElement => (
  <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close digest">
    <X className="h-5 w-5" />
  </Button>
),

 DigestHeaderContent = ({
  articleCount,
  onClose,
}: Readonly<{ articleCount: number; onClose: () => void }>): ReactElement => (
  <div className="flex items-center justify-between">
    <DigestHeaderTitle articleCount={articleCount} />
    <DigestCloseButton onClose={onClose} />
  </div>
),

 DigestHeader = ({
  articleCount,
  onClose,
}: Readonly<{ articleCount: number; onClose: () => void }>): ReactElement => (
  <SheetHeader className="px-6 pt-6 pb-4 border-b" style={DIGEST_HEADER_STYLE}>
    <DigestHeaderContent articleCount={articleCount} onClose={onClose} />
  </SheetHeader>
),

 DigestLoadingContent = (): ReactElement => (
  <div className="flex flex-col items-center gap-3">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    <p style={MUTED_TEXT_STYLE}>Generating your digest...</p>
  </div>
),

 DigestLoading = (): ReactElement => (
  <div className="flex items-center justify-center h-full">
    <DigestLoadingContent />
  </div>
),

 DigestFailure = (): ReactElement => (
  <div className="flex items-center justify-center h-full">
    <p style={MUTED_TEXT_STYLE}>Failed to generate digest</p>
  </div>
),

 DigestBody = ({
  digest,
  digestLoading,
  embedModalArticle,
  embedModalOpen,
  onCloseEmbedded,
  onNavigateArticle,
  onOpenArticle,
}: Readonly<{
  digest?: string;
  digestLoading: boolean;
  embedModalArticle?: Readonly<NewsArticle>;
  embedModalOpen: boolean;
  onCloseEmbedded: () => void;
  onNavigateArticle: (direction: DigestDirection) => void;
  onOpenArticle: (article: NewsArticle) => void;
}>): ReactElement => {
  if (digestLoading) {
    return <DigestLoading />;
  }
  if (digest !== undefined && digest !== "") {
    return (
      <DigestMarkdownContent
        digest={digest}
        embedModalArticle={embedModalArticle}
        embedModalOpen={embedModalOpen}
        onCloseEmbedded={onCloseEmbedded}
        onNavigateArticle={onNavigateArticle}
        onOpenArticle={onOpenArticle}
      />
    );
  }
  return <DigestFailure />;
};

interface QueueDigestViewProps {
  readonly articleCount: number;
  readonly digestLoading: boolean;
  readonly queueDigest?: string;
  readonly embedModalArticle?: Readonly<NewsArticle>;
  readonly embedModalOpen: boolean;
  readonly onClose: () => void;
  readonly onOpenArticle: (article: NewsArticle) => void;
  readonly onEmbedClose: () => void;
  readonly onNavigateArticle: (direction: DigestDirection) => void;
}

const QueueDigestView = ({
  articleCount,
  digestLoading,
  embedModalArticle,
  embedModalOpen,
  onClose,
  onEmbedClose,
  onNavigateArticle,
  onOpenArticle,
  queueDigest,
}: QueueDigestViewProps): ReactElement => (
  <>
    <DigestHeader articleCount={articleCount} onClose={onClose} />
    <div className="flex-1 overflow-y-auto">
      <DigestBody
        digest={queueDigest}
        digestLoading={digestLoading}
        embedModalArticle={embedModalArticle}
        embedModalOpen={embedModalOpen}
        onCloseEmbedded={onEmbedClose}
        onNavigateArticle={onNavigateArticle}
        onOpenArticle={onOpenArticle}
      />
    </div>
  </>
);

interface QueueListViewProps {
  readonly queuedArticles: readonly NewsArticle[];
  readonly isLoaded: boolean;
  readonly expandedIndex?: number;
  readonly estimatedReadTimes: Readonly<Record<string, number>>;
  readonly readingHistoryIds: readonly number[];
  readonly onOpenDigest: () => void;
  readonly onToggleArticle: (index: number) => void;
  readonly onOpenArticle: (url: string) => void;
  readonly onRemoveArticle: (url: string) => void;
}

const DesktopDigestButton = ({
  disabled,
  onOpenDigest,
}: Readonly<{ disabled: boolean; onOpenDigest: () => void }>): ReactElement => (
  <Button
    size="sm"
    variant="outline"
    onClick={onOpenDigest}
    disabled={disabled}
    title="Generate a digest of all articles"
    className="hidden sm:inline-flex"
  >
    <Sparkles className="h-4 w-4 mr-1" />
    Reading digest
  </Button>
),

 MobileDigestButton = ({
  disabled,
  onOpenDigest,
}: Readonly<{ disabled: boolean; onOpenDigest: () => void }>): ReactElement => (
  <Button
    size="icon"
    variant="outline"
    onClick={onOpenDigest}
    disabled={disabled}
    title="Generate a digest of all articles"
    className="h-9 w-9 sm:hidden"
    aria-label="Generate reading digest"
  >
    <Sparkles className="h-4 w-4" />
  </Button>
),

 QueueCountBadge = ({
  count,
}: Readonly<{ count: number }>): ReactElement => (
  <span
    className="text-sm font-medium px-3 py-1 rounded-full"
    style={QUEUE_COUNT_STYLE}
  >
    {count}
  </span>
),

 QueueCloseButton = (): ReactElement => (
  <Button
    size="icon"
    variant="outline"
    className="h-9 w-9 rounded-full"
    title="Close reading queue"
    aria-label="Close reading queue"
  >
    <X className="h-4 w-4" />
  </Button>
),

 CloseQueueButton = (): ReactElement => (
  <SheetClose asChild>
    <QueueCloseButton />
  </SheetClose>
),

 QueueListHeaderActions = ({
  articleCount,
  onOpenDigest,
}: Readonly<{ articleCount: number; onOpenDigest: () => void }>): ReactElement => {
  const digestDisabled = articleCount === ZERO;
  return (
    <div className="flex items-center gap-2">
      <DesktopDigestButton
        disabled={digestDisabled}
        onOpenDigest={onOpenDigest}
      />
      <MobileDigestButton
        disabled={digestDisabled}
        onOpenDigest={onOpenDigest}
      />
      <QueueCountBadge count={articleCount} />
      <CloseQueueButton />
    </div>
  );
},

 QueueListHeaderContent = ({
  articleCount,
  onOpenDigest,
}: Readonly<{ articleCount: number; onOpenDigest: () => void }>): ReactElement => (
  <div className="flex items-center justify-between gap-3">
    <SheetTitle className="min-w-0 flex-1 truncate text-3xl font-bold font-serif sm:text-4xl">
      Articles to Read
    </SheetTitle>
    <QueueListHeaderActions
      articleCount={articleCount}
      onOpenDigest={onOpenDigest}
    />
  </div>
),

 QueueListHeader = ({
  articleCount,
  onOpenDigest,
}: Readonly<{ articleCount: number; onOpenDigest: () => void }>): ReactElement => (
  <SheetHeader
    className="px-4 pt-5 pb-4 border-b sm:px-6 sm:pt-6"
    style={DIGEST_HEADER_STYLE}
  >
    <QueueListHeaderContent
      articleCount={articleCount}
      onOpenDigest={onOpenDigest}
    />
  </SheetHeader>
),

 QueueEmptyContent = (): ReactElement => (
  <div className="space-y-2">
    <p className="text-lg font-semibold" style={FOREGROUND_TEXT_STYLE}>
      Your queue is empty
    </p>
    <p className="text-sm" style={MUTED_TEXT_STYLE}>
      Start adding articles to build your reading list
    </p>
  </div>
),

 QueueEmptyState = (): ReactElement => (
  <div className="flex h-full items-center justify-center text-center">
    <QueueEmptyContent />
  </div>
);

interface QueueArticleListItemProps {
  readonly article: Readonly<NewsArticle>;
  readonly index: number;
  readonly expandedIndex?: number;
  readonly estimatedReadTime?: number;
  readonly readingHistoryIds: readonly number[];
  readonly onToggleArticle: (index: number) => void;
  readonly onOpenArticle: (url: string) => void;
  readonly onRemoveArticle: (url: string) => void;
}

const QueueArticleListItem = ({
  article,
  estimatedReadTime,
  expandedIndex,
  index,
  onOpenArticle,
  onRemoveArticle,
  onToggleArticle,
  readingHistoryIds,
}: QueueArticleListItemProps): ReactElement => {
  const handleToggle = useCallback(
    () =>{  onToggleArticle(index); },
    [index, onToggleArticle],
  ),
   handleOpen = useCallback(
    () =>{  onOpenArticle(article.url); },
    [article.url, onOpenArticle],
  ),
   handleRemove = useCallback(
    () =>{  onRemoveArticle(article.url); },
    [article.url, onRemoveArticle],
  );
  return (
    <QueueCard
      article={article}
      estimatedReadTime={estimatedReadTime}
      index={index}
      isExpanded={expandedIndex === index}
      onOpen={handleOpen}
      onRemove={handleRemove}
      onToggle={handleToggle}
      readingHistoryIds={readingHistoryIds}
    />
  );
},

 QueueArticleList = ({
  estimatedReadTimes,
  expandedIndex,
  onOpenArticle,
  onRemoveArticle,
  onToggleArticle,
  queuedArticles,
  readingHistoryIds,
}: Readonly<
  Pick<
    QueueListViewProps,
    | "estimatedReadTimes"
    | "expandedIndex"
    | "onOpenArticle"
    | "onRemoveArticle"
    | "onToggleArticle"
    | "queuedArticles"
    | "readingHistoryIds"
  >
>): ReactElement => (
  <div className="space-y-3">
    {queuedArticles.map((article, index) => (
      <QueueArticleListItem
        key={`${article.url}-${article.id}`}
        article={article}
        estimatedReadTime={estimatedReadTimes[article.url]}
        expandedIndex={expandedIndex}
        index={index}
        onOpenArticle={onOpenArticle}
        onRemoveArticle={onRemoveArticle}
        onToggleArticle={onToggleArticle}
        readingHistoryIds={readingHistoryIds}
      />
    ))}
  </div>
),

 QueueListBody = ({
  estimatedReadTimes,
  expandedIndex,
  isLoaded,
  onOpenArticle,
  onRemoveArticle,
  onToggleArticle,
  queuedArticles,
  readingHistoryIds,
}: Omit<QueueListViewProps, "onOpenDigest">): ReactElement => {
  const isEmpty = isLoaded && queuedArticles.length === ZERO;
  return (
    <div className="flex-1 overflow-y-auto flex flex-col px-4 py-5 sm:px-6 sm:py-6">
      {isEmpty && <QueueEmptyState />}
      {!isEmpty && (
        <QueueArticleList
          estimatedReadTimes={estimatedReadTimes}
          expandedIndex={expandedIndex}
          onOpenArticle={onOpenArticle}
          onRemoveArticle={onRemoveArticle}
          onToggleArticle={onToggleArticle}
          queuedArticles={queuedArticles}
          readingHistoryIds={readingHistoryIds}
        />
      )}
    </div>
  );
},

 QueueListView = ({
  estimatedReadTimes,
  expandedIndex,
  isLoaded,
  onOpenArticle,
  onOpenDigest,
  onRemoveArticle,
  onToggleArticle,
  queuedArticles,
  readingHistoryIds,
}: QueueListViewProps): ReactElement => (
  <>
    <QueueListHeader
      articleCount={queuedArticles.length}
      onOpenDigest={onOpenDigest}
    />
    <QueueListBody
      estimatedReadTimes={estimatedReadTimes}
      expandedIndex={expandedIndex}
      isLoaded={isLoaded}
      onOpenArticle={onOpenArticle}
      onRemoveArticle={onRemoveArticle}
      onToggleArticle={onToggleArticle}
      queuedArticles={queuedArticles}
      readingHistoryIds={readingHistoryIds}
    />
  </>
);

interface DigestArticleSummary {
  readonly category: string;
  readonly source: string;
  readonly summary: string;
  readonly title: string;
  readonly url: string;
}

const DIGEST_FENCE_PATTERN = /```json:articles\n[\s\S]*?\n```/gu,
 READING_HISTORY_LIMIT = 50,

 getDigestArticleSummaries = (
  articles: readonly NewsArticle[],
): readonly DigestArticleSummary[] =>
  articles.map((article) => ({
    category: article.category === "" ? "Uncategorized" : article.category,
    source: article.source,
    summary: article.summary,
    title: article.title,
    url: article.url,
  })),

 groupDigestArticles = (
  articles: readonly DigestArticleSummary[],
): Readonly<Record<string, readonly DigestArticleSummary[]>> => {
  const grouped: Record<string, DigestArticleSummary[]> = {};
  articles.forEach((article) => {
    const {category} = article;
    if (grouped[category] === undefined) {
      grouped[category] = [];
    }
    grouped[category].push(article);
  });
  return grouped;
},

 requestQueueDigest = async (
  articles: readonly NewsArticle[],
): Promise<string | undefined> => {
  const articleSummaries = getDigestArticleSummaries(articles),
   grouped = groupDigestArticles(articleSummaries),
   response = await fetch(`${API_BASE_URL}/api/queue/digest`, {
    body: JSON.stringify({ articles: articleSummaries, grouped }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    console.error("Failed to generate digest");
    return undefined;
  }
  const data = await readJsonResponse(response, DigestResponseSchema);
  if (data === undefined) {
    return undefined;
  }
  const raw = data.digest ?? data.content ?? "";
  return raw.replace(DIGEST_FENCE_PATTERN, "").trim();
},

 getFullArticleText = async (
  article: Readonly<NewsArticle>,
): Promise<string | undefined> => {
  const response = await fetch(
    `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`,
  );
  if (!response.ok) {
    return undefined;
  }
  const data = await readJsonResponse(response, FullArticleResponseSchema);
  if (data === undefined) {
    return undefined;
  }
  if (data.text !== undefined && data.text !== "") {
    return data.text;
  }
  return data.full_text;
},

 getSheetContentStyle = (
  selectedArticle: Readonly<NewsArticle> | undefined,
): CSSProperties => {
  if (selectedArticle !== undefined) {
    return {
      ...SHEET_STYLE,
      maxWidth: "70vw",
      width: "70vw",
    };
  }
  return {
    ...SHEET_STYLE,
    maxWidth: "100%",
    width: "540px",
  };
},

 getArticleIdState = (
  article: Readonly<NewsArticle> | undefined,
  getState: (articleId: number) => boolean,
): boolean => {
  if (article === undefined || article.id === ZERO) {
    return false;
  }
  return getState(article.id);
};

interface ReadingQueueController {
  readonly queuedArticles: readonly NewsArticle[];
  readonly isLoaded: boolean;
  readonly selectedArticle?: Readonly<NewsArticle>;
  readonly selectedArticleIndex: number;
  readonly expandedIndex?: number;
  readonly readingHistoryIds: readonly number[];
  readonly estimatedReadTimes: Readonly<Record<string, number>>;
  readonly articleLoading: boolean;
  readonly fullArticleText?: string;
  readonly aiAnalysis?: Readonly<ArticleAnalysis>;
  readonly aiAnalysisLoading: boolean;
  readonly source?: Readonly<NewsSource>;
  readonly sourceLoading: boolean;
  readonly showSourceDetails: boolean;
  readonly debugOpen: boolean;
  readonly debugLoading: boolean;
  readonly debugData?: Readonly<SourceDebugData>;
  readonly readArticles: ReadonlySet<string>;
  readonly isLiked: (articleId: number) => boolean;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly isBookmarked: (articleId: number) => boolean;
  readonly showQueueOverview: boolean;
  readonly digestLoading: boolean;
  readonly queueDigest?: string;
  readonly embedModalArticle?: Readonly<NewsArticle>;
  readonly embedModalOpen: boolean;
  readonly onOpenDigest: () => void;
  readonly onToggleArticle: (index: number) => void;
  readonly onOpenArticle: (url: string) => void;
  readonly onRemoveArticle: (url: string) => void;
  readonly onToggleSourceDetails: () => void;
  readonly onToggleDebug: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onCloseArticle: () => void;
  readonly onLike: () => void;
  readonly onFavorite: () => void;
  readonly onBookmark: () => void;
  readonly onMarkRead: () => void;
  readonly onRemoveSelected: () => void;
  readonly onCloseOverview: () => void;
  readonly onOpenEmbeddedArticle: (article: NewsArticle) => void;
  readonly onCloseEmbedded: () => void;
  readonly onNavigateArticle: (direction: DigestDirection) => void;
}

const useReadingQueueController = (): ReadingQueueController => {
  const { isLoaded, queuedArticles, removeArticleFromQueue } = useReadingQueue(),
   { isFavorite, toggleFavorite } = useFavorites(),
   { getRecentIds } = useReadingHistory(),
   { isLiked, toggleLike } = useLikedArticles(),
   { isBookmarked, toggleBookmark } = useBookmarks(),
   readingHistoryIds = useMemo(
    () => getRecentIds(READING_HISTORY_LIMIT),
    [getRecentIds],
  ),
   [expandedIndex, setExpandedIndex] = useState<number | undefined>(),
   [selectedArticleUrl, setSelectedArticleUrl] = useState<string>(),
   [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis>(),
   [aiAnalysisLoading, setAiAnalysisLoading] = useState(false),
   [source, setSource] = useState<NewsSource>(),
   [sourceLoading, setSourceLoading] = useState(false),
   [showSourceDetails, setShowSourceDetails] = useState(false),
   [debugOpen, setDebugOpen] = useState(false),
   [debugLoading, setDebugLoading] = useState(false),
   [debugData, setDebugData] = useState<SourceDebugData>(),
   [fullArticleText, setFullArticleText] = useState<string>(),
   [articleLoading, setArticleLoading] = useState(false),
   [readArticles, setReadArticles] = useState<Set<string>>(
    () => new Set<string>(),
  ),
   [estimatedReadTimes, setEstimatedReadTimes] = useState<
    Record<string, number>
  >({}),
   [queueDigest, setQueueDigest] = useState<string>(),
   [digestLoading, setDigestLoading] = useState(false),
   [showQueueOverview, setShowQueueOverview] = useState(false),
   [embedModalArticle, setEmbedModalArticle] = useState<NewsArticle>(),
   [embedModalOpen, setEmbedModalOpen] = useState(false),

   selectedArticle = useMemo(() => {
    if (selectedArticleUrl === undefined) {
      return;
    }
    return queuedArticles.find((article) => article.url === selectedArticleUrl);
  }, [queuedArticles, selectedArticleUrl]),
   selectedArticleIndex = useMemo(() => {
    if (selectedArticle === undefined) {
      return NO_ARTICLE_INDEX;
    }
    return queuedArticles.findIndex((article) => article.url === selectedArticle.url);
  }, [queuedArticles, selectedArticle]),

   handleRemove = useCallback(
    (articleUrl: string): void => {
      removeArticleFromQueue(articleUrl);
    },
    [removeArticleFromQueue],
  ),
   handleMarkAsRead = useCallback((articleUrl: string): void => {
    setReadArticles((previous) => {
      const next = new Set(previous);
      next.add(articleUrl);
      return next;
    });
  }, []),
   handleNavigateArticle = useCallback(
    (direction: DigestDirection): void => {
      if (selectedArticleUrl === undefined) {
        return;
      }
      const currentIndex = queuedArticles.findIndex(
        (article) => article.url === selectedArticleUrl,
      );
      let nextIndex = currentIndex;
      if (direction === "next") {
        nextIndex = Math.min(currentIndex + 1, queuedArticles.length - 1);
      }
      if (direction === "previous") {
        nextIndex = Math.max(currentIndex - 1, ZERO);
      }
      if (nextIndex === currentIndex) {
        return;
      }
      const nextArticle = queuedArticles[nextIndex];
      if (nextArticle !== undefined) {
        setSelectedArticleUrl(nextArticle.url);
      }
    },
    [queuedArticles, selectedArticleUrl],
  ),
   handlePrevious = useCallback((): void => {
    handleNavigateArticle("previous");
  }, [handleNavigateArticle]),
   handleNext = useCallback((): void => {
    handleNavigateArticle("next");
  }, [handleNavigateArticle]),
   loadAiAnalysis = useCallback(async (article: Readonly<NewsArticle>): Promise<void> => {
    try {
      setAiAnalysisLoading(true);
      const analysis = await analyzeArticle(article.url, article.source);
      setAiAnalysis(analysis);
    } catch (error) {
      console.error("Failed to analyze article:", error);
      setAiAnalysis({
        article_url: article.url,
        error: error instanceof Error ? error.message : "Failed to analyze article",
        success: false,
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  }, []),
   loadSource = useCallback(async (article: Readonly<NewsArticle>): Promise<void> => {
    setSourceLoading(true);
    try {
      const fetchedSource = await getSourceById(article.sourceId);
      setSource(fetchedSource);
    } catch (error) {
      console.error("Failed to load source:", error);
      setSource(undefined);
    } finally {
      setSourceLoading(false);
    }
  }, []),
   loadDebugData = useCallback(async (article: Readonly<NewsArticle>): Promise<void> => {
    try {
      setDebugLoading(true);
      const data = await fetchSourceDebugData(article.source);
      setDebugData(data);
    } catch (error) {
      console.error("Failed to fetch debug data:", error);
      setDebugData(undefined);
    } finally {
      setDebugLoading(false);
    }
  }, []),
   loadFullArticle = useCallback(async (article: Readonly<NewsArticle>): Promise<void> => {
    try {
      setArticleLoading(true);
      setFullArticleText(undefined);
      const preloadedText = article._queueData?.fullText;
      if (preloadedText !== undefined && preloadedText !== "") {
        setFullArticleText(preloadedText);
        return;
      }
      const text = await getFullArticleText(article);
      setFullArticleText(text);
      if (text !== undefined && text !== "") {
        setEstimatedReadTimes((previous) => ({
          ...previous,
          [article.url]: calculateReadTime(text),
        }));
      }
    } catch (error) {
      console.error("Failed to fetch full article:", error);
    } finally {
      setArticleLoading(false);
    }
  }, []),
   resetSelectedArticleState = useCallback((): void => {
    setShowSourceDetails(false);
    setDebugOpen(false);
    setAiAnalysisLoading(true);
    setSourceLoading(true);
    setArticleLoading(true);
    setAiAnalysis(undefined);
    setSource(undefined);
    setDebugData(undefined);
    setFullArticleText(undefined);
  }, []),
   loadSelectedArticle = useCallback(
    (article: Readonly<NewsArticle>): void => {
      resetSelectedArticleState();
      void loadFullArticle(article);
      void loadAiAnalysis(article);
      void loadSource(article);
    },
    [loadAiAnalysis, loadFullArticle, loadSource, resetSelectedArticleState],
  );

  useEffect(() => {
    if (selectedArticle !== undefined) {
      loadSelectedArticle(selectedArticle);
    }
  }, [loadSelectedArticle, selectedArticle]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (selectedArticle === undefined) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNavigateArticle("next");
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleNavigateArticle("previous");
        return;
      }
      if (event.key === "m") {
        event.preventDefault();
        handleMarkAsRead(selectedArticle.url);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedArticleUrl(undefined);
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return (): void => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleMarkAsRead, handleNavigateArticle, selectedArticle]);

  const generateQueueDigest = useCallback(async (): Promise<void> => {
    if (queuedArticles.length === ZERO) {
      return;
    }
    try {
      setDigestLoading(true);
      const digest = await requestQueueDigest(queuedArticles);
      setQueueDigest(digest);
    } catch (error) {
      console.error("Error generating digest:", error);
      setQueueDigest(undefined);
    } finally {
      setDigestLoading(false);
    }
  }, [queuedArticles]),
   handleOpenDigest = useCallback((): void => {
    setShowQueueOverview(true);
    void generateQueueDigest();
  }, [generateQueueDigest]),
   handleToggleDebug = useCallback((): void => {
    if (selectedArticle !== undefined && ! debugOpen) {
      void loadDebugData(selectedArticle);
    }
    setDebugOpen((previous) => !previous);
  }, [debugOpen, loadDebugData, selectedArticle]),
   handleToggleArticle = useCallback((index: number): void => {
    setExpandedIndex((previous) => {
      if (previous === index) {
        return;
      }
      return index;
    });
  }, []),
   handleToggleSourceDetails = useCallback((): void => {
    setShowSourceDetails((previous) => !previous);
  }, []),
   handleCloseArticle = useCallback((): void => {
    setSelectedArticleUrl(undefined);
  }, []),
   handleLikeSelected = useCallback((): void => {
    if (selectedArticle !== undefined && selectedArticle.id !== ZERO) {
      toggleLike(selectedArticle.id);
    }
  }, [selectedArticle, toggleLike]),
   handleFavoriteSelected = useCallback((): void => {
    if (selectedArticle !== undefined) {
      toggleFavorite(selectedArticle.sourceId);
    }
  }, [selectedArticle, toggleFavorite]),
   handleBookmarkSelected = useCallback((): void => {
    if (selectedArticle !== undefined && selectedArticle.id !== ZERO) {
      toggleBookmark(selectedArticle.id);
    }
  }, [selectedArticle, toggleBookmark]),
   handleMarkSelected = useCallback((): void => {
    if (selectedArticle !== undefined) {
      handleMarkAsRead(selectedArticle.url);
    }
  }, [handleMarkAsRead, selectedArticle]),
   handleRemoveSelected = useCallback((): void => {
    if (selectedArticle !== undefined) {
      handleRemove(selectedArticle.url);
      setSelectedArticleUrl(undefined);
    }
  }, [handleRemove, selectedArticle]),
   handleCloseOverview = useCallback((): void => {
    setShowQueueOverview(false);
  }, []),
   handleOpenEmbeddedArticle = useCallback((article: NewsArticle): void => {
    setEmbedModalArticle(article);
    setEmbedModalOpen(true);
  }, []),
   handleCloseEmbedded = useCallback((): void => {
    setEmbedModalOpen(false);
  }, []);

  return {
    aiAnalysis,
    aiAnalysisLoading,
    articleLoading,
    debugData,
    debugLoading,
    debugOpen,
    digestLoading,
    embedModalArticle,
    embedModalOpen,
    estimatedReadTimes,
    expandedIndex,
    fullArticleText,
    isBookmarked,
    isFavorite,
    isLiked,
    isLoaded,
    onBookmark: handleBookmarkSelected,
    onCloseArticle: handleCloseArticle,
    onCloseEmbedded: handleCloseEmbedded,
    onCloseOverview: handleCloseOverview,
    onFavorite: handleFavoriteSelected,
    onLike: handleLikeSelected,
    onMarkRead: handleMarkSelected,
    onNavigateArticle: handleNavigateArticle,
    onNext: handleNext,
    onOpenArticle: setSelectedArticleUrl,
    onOpenDigest: handleOpenDigest,
    onOpenEmbeddedArticle: handleOpenEmbeddedArticle,
    onPrevious: handlePrevious,
    onRemoveArticle: handleRemove,
    onRemoveSelected: handleRemoveSelected,
    onToggleArticle: handleToggleArticle,
    onToggleDebug: handleToggleDebug,
    onToggleSourceDetails: handleToggleSourceDetails,
    queueDigest,
    queuedArticles,
    readArticles,
    readingHistoryIds,
    selectedArticle,
    selectedArticleIndex,
    showQueueOverview,
    showSourceDetails,
    source,
    sourceLoading,
  };
},

 QueueTriggerBadge = ({
  count,
}: Readonly<{ count: number }>): ReactElement => (
  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-semibold">
    {count}
  </span>
),

 QueueTriggerButton = ({
  isLoaded,
  queuedArticleCount,
}: Readonly<{ isLoaded: boolean; queuedArticleCount: number }>): ReactElement => (
  <Button
    variant="outline"
    size="icon"
    className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow"
    style={PRIMARY_BUTTON_STYLE}
    aria-label="Open reading queue"
  >
    <List className="h-6 w-6 text-primary-foreground" />
    {isLoaded && queuedArticleCount > ZERO && (
      <QueueTriggerBadge count={queuedArticleCount} />
    )}
  </Button>
),

 QueueSheetBody = ({
  controller,
}: Readonly<{ controller: Readonly<ReadingQueueController> }>): ReactElement => {
  const {selectedArticle} = controller;
  if (selectedArticle !== undefined) {
    return (
      <ArticleDetailView
        aiAnalysis={controller.aiAnalysis}
        aiAnalysisLoading={controller.aiAnalysisLoading}
        article={selectedArticle}
        articleLoading={controller.articleLoading}
        count={controller.queuedArticles.length}
        debugData={controller.debugData}
        debugLoading={controller.debugLoading}
        debugOpen={controller.debugOpen}
        fullArticleText={controller.fullArticleText}
        index={controller.selectedArticleIndex}
        isBookmarked={getArticleIdState(selectedArticle, controller.isBookmarked)}
        isFavorite={controller.isFavorite(selectedArticle.sourceId)}
        isLiked={getArticleIdState(selectedArticle, controller.isLiked)}
        isRead={controller.readArticles.has(selectedArticle.url)}
        onBookmark={controller.onBookmark}
        onClose={controller.onCloseArticle}
        onFavorite={controller.onFavorite}
        onLike={controller.onLike}
        onMarkRead={controller.onMarkRead}
        onNext={controller.onNext}
        onPrevious={controller.onPrevious}
        onRemove={controller.onRemoveSelected}
        onToggleDebug={controller.onToggleDebug}
        onToggleSourceDetails={controller.onToggleSourceDetails}
        readTime={controller.estimatedReadTimes[selectedArticle.url]}
        showSourceDetails={controller.showSourceDetails}
        source={controller.source}
        sourceLoading={controller.sourceLoading}
      />
    );
  }
  if (controller.showQueueOverview) {
    return (
      <QueueDigestView
        articleCount={controller.queuedArticles.length}
        digestLoading={controller.digestLoading}
        embedModalArticle={controller.embedModalArticle}
        embedModalOpen={controller.embedModalOpen}
        onClose={controller.onCloseOverview}
        onEmbedClose={controller.onCloseEmbedded}
        onNavigateArticle={controller.onNavigateArticle}
        onOpenArticle={controller.onOpenEmbeddedArticle}
        queueDigest={controller.queueDigest}
      />
    );
  }
  return (
    <QueueListView
      estimatedReadTimes={controller.estimatedReadTimes}
      expandedIndex={controller.expandedIndex}
      isLoaded={controller.isLoaded}
      onOpenArticle={controller.onOpenArticle}
      onOpenDigest={controller.onOpenDigest}
      onRemoveArticle={controller.onRemoveArticle}
      onToggleArticle={controller.onToggleArticle}
      queuedArticles={controller.queuedArticles}
      readingHistoryIds={controller.readingHistoryIds}
    />
  );
},

 ReadingQueueSheet = ({
  controller,
}: Readonly<{ controller: Readonly<ReadingQueueController> }>): ReactElement => (
  <Sheet>
    <SheetTrigger asChild>
      <QueueTriggerButton
        isLoaded={controller.isLoaded}
        queuedArticleCount={controller.queuedArticles.length}
      />
    </SheetTrigger>
    <SheetContent
      className="flex flex-col p-0"
      style={getSheetContentStyle(controller.selectedArticle)}
    >
      <QueueSheetBody controller={controller} />
    </SheetContent>
  </Sheet>
);

export const ReadingQueueSidebar = (): ReactElement => {
  const controller = useReadingQueueController();
  return <ReadingQueueSheet controller={controller} />;
};
