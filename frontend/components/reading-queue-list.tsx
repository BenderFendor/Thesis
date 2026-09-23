"use client";

import { SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NewsArticle } from "@/lib/api";
import { QueueCard } from "@/components/reading-queue-card";
import type { ReactElement } from "react";
import { useCallback } from "react";

const ZERO = 0;

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
  );
const MobileDigestButton = ({
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
  );
const QueueCountBadge = ({ count }: Readonly<{ count: number }>): ReactElement => (
    <span className="rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
      {count}
    </span>
  );
const QueueCloseButton = (): ReactElement => (
    <Button
      size="icon"
      variant="outline"
      className="h-9 w-9 rounded-full"
      title="Close reading queue"
      aria-label="Close reading queue"
    >
      <X className="h-4 w-4" />
    </Button>
  );
const CloseQueueButton = (): ReactElement => (
    <SheetClose asChild>
      <QueueCloseButton />
    </SheetClose>
  );
const QueueListHeaderActions = ({
    articleCount,
    onOpenDigest,
  }: Readonly<{ articleCount: number; onOpenDigest: () => void }>): ReactElement => {
    const digestDisabled = articleCount === ZERO;
    return (
      <div className="flex items-center gap-2">
        <DesktopDigestButton disabled={digestDisabled} onOpenDigest={onOpenDigest} />
        <MobileDigestButton disabled={digestDisabled} onOpenDigest={onOpenDigest} />
        <QueueCountBadge count={articleCount} />
        <CloseQueueButton />
      </div>
    );
  };
const QueueListHeaderContent = ({
    articleCount,
    onOpenDigest,
  }: Readonly<{ articleCount: number; onOpenDigest: () => void }>): ReactElement => (
    <div className="flex items-center justify-between gap-3">
      <SheetTitle className="min-w-0 flex-1 truncate text-3xl font-bold font-serif sm:text-4xl">
        Articles to Read
      </SheetTitle>
      <QueueListHeaderActions articleCount={articleCount} onOpenDigest={onOpenDigest} />
    </div>
  );
const QueueListHeader = ({
    articleCount,
    onOpenDigest,
  }: Readonly<{ articleCount: number; onOpenDigest: () => void }>): ReactElement => (
    <SheetHeader className="border-border px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
      <QueueListHeaderContent articleCount={articleCount} onOpenDigest={onOpenDigest} />
    </SheetHeader>
  );
const QueueEmptyContent = (): ReactElement => (
    <div className="space-y-2">
      <p className="text-foreground text-lg font-semibold">Your queue is empty</p>
      <p className="text-muted-foreground text-sm">
        Start adding articles to build your reading list
      </p>
    </div>
  );
const QueueEmptyState = (): ReactElement => (
    <div className="flex h-full items-center justify-center text-center">
      <QueueEmptyContent />
    </div>
  );

interface QueueArticleListItemProps {
  readonly article: NewsArticle;
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
    const handleToggle = useCallback(() => {
        onToggleArticle(index);
      }, [index, onToggleArticle]);
    const handleOpen = useCallback(() => {
        onOpenArticle(article.url);
      }, [article.url, onOpenArticle]);
    const handleRemove = useCallback(() => {
        onRemoveArticle(article.url);
      }, [article.url, onRemoveArticle]);
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
  };
const QueueArticleList = ({
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
  );
const QueueListBody = ({
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
  };
const QueueListView = ({
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
      <QueueListHeader articleCount={queuedArticles.length} onOpenDigest={onOpenDigest} />
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

export { QueueListView };
