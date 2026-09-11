"use client";

import type { CSSProperties, KeyboardEventHandler, MouseEventHandler, ReactElement } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NewsArticle } from "@/lib/api";
import { NoveltyBadge } from "@/components/novelty-badge";
import { SafeImage } from "@/components/safe-image";
import { SemanticTags } from "@/components/semantic-tags";
import { activateCardFromKeyDown } from "@/lib/keyboard-activation";
import { getArticlePreview, isUsableImage } from "@/lib/reading-queue-content";
import { useCallback } from "react";

const CARD_IMAGE_HEIGHT = 160;
const CARD_IMAGE_WIDTH = 640;
const DIGEST_IMAGE_HEIGHT = 48;
const DIGEST_IMAGE_WIDTH = 64;
const MAX_SEMANTIC_TAGS = 3;
const CARD_INDENT_LIMIT = 16;
const CARD_INDENT_STEP = 4;
const CARD_OVERLAP = -8;
const ZERO = 0;
const QUEUE_DATA_KEY = "_queueData" as const;

const getCardStyle = (index: number): CSSProperties => ({
  marginLeft: `${Math.min(index * CARD_INDENT_STEP, CARD_INDENT_LIMIT)}px`,
  marginTop: (() => {
  if (index > ZERO) {
    return `${CARD_OVERLAP}px`;
  }
  return "0px";
})(),
});

interface QueueCardProps {
  readonly article: NewsArticle;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly estimatedReadTime?: number;
  readonly readingHistoryIds: readonly number[];
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}

interface QueueCardHeaderProps {
  readonly article: NewsArticle;
  readonly estimatedReadTime?: number;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly readingHistoryIds: readonly number[];
  readonly hasReadTime: boolean;
  readonly hasPreloadedData: boolean;
}

interface QueueCardMetaProps {
  readonly article: NewsArticle;
  readonly estimatedReadTime?: number;
  readonly readingHistoryIds: readonly number[];
  readonly hasReadTime: boolean;
  readonly hasPreloadedData: boolean;
}

const QueueCardLoadingBadge = (): ReactElement => (
  <Badge className="text-xs flex items-center gap-1 animate-pulse">
    <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
    Loading...
  </Badge>
);

const QueueCardMeta = ({
  article,
  estimatedReadTime,
  readingHistoryIds,
  hasReadTime,
  hasPreloadedData,
}: QueueCardMetaProps): ReactElement => (
  <div className="flex items-center gap-2 mt-1">
    <p className="text-xs text-muted-foreground">{article.source}</p>
    {hasReadTime && (
      <span className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
        {estimatedReadTime}m
      </span>
    )}
    {readingHistoryIds.length > ZERO && (
      <NoveltyBadge articleId={article.id} readingHistory={readingHistoryIds} />
    )}
    {!hasPreloadedData && <QueueCardLoadingBadge />}
  </div>
);

const QueueCardThumbnail = ({
  article,
  isExpanded,
}: Readonly<Pick<QueueCardHeaderProps, "article" | "isExpanded">>): ReactElement | null => {
  if (isExpanded || !isUsableImage(article.image)) {
    return null;
  }
  return (
    <div className="flex-shrink-0 h-12 w-16 rounded-lg overflow-hidden border border-border">
      <SafeImage
        src={article.image}
        alt={article.title}
        width={DIGEST_IMAGE_WIDTH}
        height={DIGEST_IMAGE_HEIGHT}
        className="w-full h-full object-cover"
      />
    </div>
  );
};

const QueueCardHeader = ({
  article,
  estimatedReadTime,
  index,
  isExpanded,
  readingHistoryIds,
  hasReadTime,
  hasPreloadedData,
}: QueueCardHeaderProps): ReactElement => {
  const headingClass = (() => {
  if (isExpanded) {
    return "font-bold leading-tight group-hover:text-primary transition-colors text-base";
  }
  return "font-bold leading-tight group-hover:text-primary transition-colors text-sm line-clamp-2";
})();

  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center bg-primary text-primary-foreground">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={headingClass}>{article.title}</h3>
        <QueueCardMeta
          article={article}
          estimatedReadTime={estimatedReadTime}
          readingHistoryIds={readingHistoryIds}
          hasReadTime={hasReadTime}
          hasPreloadedData={hasPreloadedData}
        />
        {isExpanded && (
          <SemanticTags articleId={article.id} maxTags={MAX_SEMANTIC_TAGS} className="mt-2" />
        )}
      </div>
      <QueueCardThumbnail article={article} isExpanded={isExpanded} />
      <ChevronDown
        className={`h-5 w-5 flex-shrink-0 transition-transform ${(() => {
  if (isExpanded) {
    return "rotate-180 text-muted-foreground";
  }
  return "text-muted-foreground";
})()}`}
      />
    </div>
  );
};

const QueueCardExpandedContent = ({
  article,
}: Readonly<{ article: NewsArticle }>): ReactElement => (
  <div className="space-y-3 pt-3 mt-3 border-t border-border animate-in fade-in slide-in-from-top-2 duration-200">
    {isUsableImage(article.image) && (
      <SafeImage
        src={article.image}
        alt={article.title}
        width={CARD_IMAGE_WIDTH}
        height={CARD_IMAGE_HEIGHT}
        className="w-full h-40 object-cover rounded-lg"
      />
    )}
    <p className="text-sm text-foreground">{getArticlePreview(article)}</p>
  </div>
);

const QueueCardActions = ({
  onOpen,
  onRemove,
}: Readonly<Pick<QueueCardProps, "onOpen" | "onRemove">>): ReactElement => {
  const onRead: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      event.stopPropagation();
      onOpen();
    },
    [onOpen],
  );
  const onDelete: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      event.stopPropagation();
      onRemove();
    },
    [onRemove],
  );
  return (
    <div className="flex gap-2 pt-2">
      <Button size="sm" className="flex-1" onClick={onRead}>
        Read Article
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDelete}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};

const getQueueCardSurfaceClass = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "relative rounded-xl border overflow-hidden backdrop-blur-sm transition-all duration-300 p-4 flex flex-col shadow-2xl ring-2 bg-news-bg-secondary border-primary ring-primary";
  }
  return "relative rounded-xl border overflow-hidden backdrop-blur-sm transition-all duration-300 p-4 flex flex-col shadow-lg group-hover:shadow-xl bg-card border-border";
};

type QueueCardButtonProps = Pick<
  QueueCardProps,
  "article" | "estimatedReadTime" | "index" | "isExpanded" | "onToggle" | "readingHistoryIds"
>;

const QueueCardButton = ({
  article,
  estimatedReadTime,
  index,
  isExpanded,
  onToggle,
  readingHistoryIds,
}: Readonly<QueueCardButtonProps>): ReactElement => {
  const onKeyDown: KeyboardEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      activateCardFromKeyDown(event, onToggle);
    },
    [onToggle],
  );
  const hasReadTime = estimatedReadTime !== undefined && estimatedReadTime > ZERO;
  const queueData = article[QUEUE_DATA_KEY];
  const hasPreloadedData = queueData?.preloadedAt !== undefined && queueData.preloadedAt !== ZERO;

  return (
    <button
      type="button"
      onClick={onToggle}
      onKeyDown={onKeyDown}
      aria-expanded={isExpanded}
      className="w-full border-0 bg-transparent p-0 transition-all duration-300 ease-out cursor-pointer text-left group transform hover:scale-105"
    >
      <QueueCardHeader
        article={article}
        estimatedReadTime={estimatedReadTime}
        index={index}
        isExpanded={isExpanded}
        readingHistoryIds={readingHistoryIds}
        hasReadTime={hasReadTime}
        hasPreloadedData={hasPreloadedData}
      />
      {isExpanded && <QueueCardExpandedContent article={article} />}
    </button>
  );
};

export const QueueCard = ({
  article,
  estimatedReadTime,
  index,
  isExpanded,
  onOpen,
  onRemove,
  onToggle,
  readingHistoryIds,
}: QueueCardProps): ReactElement => {
  const surfaceClass = getQueueCardSurfaceClass(isExpanded);
  return (
    <article style={getCardStyle(index)}>
      <div className={surfaceClass}>
        <QueueCardButton
          article={article}
          estimatedReadTime={estimatedReadTime}
          index={index}
          isExpanded={isExpanded}
          onToggle={onToggle}
          readingHistoryIds={readingHistoryIds}
        />
        {isExpanded && <QueueCardActions onOpen={onOpen} onRemove={onRemove} />}
      </div>
    </article>
  );
};
