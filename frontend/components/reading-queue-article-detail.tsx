"use client";

import { Bookmark, ExternalLink, Heart, Star, Trash2 } from "lucide-react";
import type { NewsArticle } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ArticleDetailHeader,
  ArticleFeaturedImage,
  ArticleMetaBar,
  ArticleSummaryContent,
} from "@/components/reading-queue-article-detail-content";
import { ArticleDetailSidebar } from "@/components/reading-queue-article-detail-sidebar";
import type {
  QueueAnalysisView,
  QueueSourceDebugView,
  QueueSourceView,
} from "@/components/reading-queue-article-detail-sidebar";
import type { ReactElement } from "react";

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
  };
const getFavoriteButtonClassName = (active: boolean): string => {
    if (active) {
      return "text-yellow-400";
    }
    return "text-gray-400";
  };
const getBookmarkButtonClassName = (active: boolean): string => {
    if (active) {
      return "text-yellow-400";
    }
    return "text-gray-400";
  };
const getActionIconClassName = (active: boolean, withMargin: boolean): string => {
    let className = "h-4 w-4";
    if (withMargin) {
      className += " mr-2";
    }
    if (active) {
      className += " fill-current";
    }
    return className;
  };
const getReadButtonVariant = (isRead: boolean): "default" | "outline" => {
    if (isRead) {
      return "default";
    }
    return "outline";
  };
const getReadButtonClassName = (isRead: boolean): string => {
    if (isRead) {
      return "text-green-400";
    }
    return "text-gray-400";
  };
const LikeActionButton = ({
    isLiked,
    onLike: handleLike,
  }: Readonly<Pick<ArticleDetailActionButtonsProps, "isLiked" | "onLike">>): ReactElement => (
    <Button size="sm" variant="ghost" onClick={handleLike} className={getLikeButtonClassName(isLiked)}>
      <Heart className={getActionIconClassName(isLiked, true)} />
      Like
    </Button>
  );
const FavoriteActionButton = ({
    isFavorite,
    onFavorite: handleFavorite,
  }: Readonly<
    Pick<ArticleDetailActionButtonsProps, "isFavorite" | "onFavorite">
  >): ReactElement => (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleFavorite}
      className={getFavoriteButtonClassName(isFavorite)}
    >
      <Star className={getActionIconClassName(isFavorite, true)} />
      Favorite
    </Button>
  );
const BookmarkActionButton = ({
    isBookmarked,
    onBookmark: handleBookmark,
  }: Readonly<
    Pick<ArticleDetailActionButtonsProps, "isBookmarked" | "onBookmark">
  >): ReactElement => (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleBookmark}
      className={getBookmarkButtonClassName(isBookmarked)}
    >
      <Bookmark className={getActionIconClassName(isBookmarked, false)} />
      Bookmark
    </Button>
  );
const ReadActionButton = ({
    isRead,
    onMarkRead: handleMarkRead,
  }: Readonly<Pick<ArticleDetailActionButtonsProps, "isRead" | "onMarkRead">>): ReactElement => (
    <Button
      size="sm"
      variant={getReadButtonVariant(isRead)}
      onClick={handleMarkRead}
      className={getReadButtonClassName(isRead)}
      title="Mark as read (M)"
    >
      Read
    </Button>
  );
const ArticleDetailActionButtons = ({
    isBookmarked,
    isFavorite,
    isLiked,
    isRead,
    onBookmark: handleBookmark,
    onFavorite: handleFavorite,
    onLike: handleLike,
    onMarkRead: handleMarkRead,
  }: ArticleDetailActionButtonsProps): ReactElement => (
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      <LikeActionButton isLiked={isLiked} onLike={handleLike} />
      <FavoriteActionButton isFavorite={isFavorite} onFavorite={handleFavorite} />
      <BookmarkActionButton isBookmarked={isBookmarked} onBookmark={handleBookmark} />
      <ReadActionButton isRead={isRead} onMarkRead={handleMarkRead} />
    </div>
  );
interface ArticleDetailMainProps extends ArticleDetailActionButtonsProps {
  readonly article: NewsArticle;
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
    onBookmark: handleBookmark,
    onFavorite: handleFavorite,
    onLike: handleLike,
    onMarkRead: handleMarkRead,
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
        onBookmark={handleBookmark}
        onFavorite={handleFavorite}
        onLike={handleLike}
        onMarkRead={handleMarkRead}
      />
    </div>
  );

interface ArticleDetailFooterProps {
  readonly article: NewsArticle;
  readonly isRead: boolean;
  readonly onMarkRead: () => void;
  readonly onRemove: () => void;
}

const ReadSourceLink = ({ article }: Readonly<{ article: NewsArticle }>): ReactElement => (
  <a
    href={article.url}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center justify-center gap-2"
  >
    <ExternalLink className="h-4 w-4" />
    Read on Source
  </a>
);

const ReadSourceButton = ({ article }: Readonly<{ article: NewsArticle }>): ReactElement => (
  <Button className="flex-1 bg-primary text-primary-foreground" asChild>
    <ReadSourceLink article={article} />
  </Button>
);

const getFooterReadClassName = (isRead: boolean): string => {
  if (isRead) {
    return "text-green-400";
  }
  return "text-gray-400 hover:text-green-400";
};

const MarkReadFooterButton = ({
  isRead,
  onMarkRead: handleMarkRead,
}: Readonly<Pick<ArticleDetailFooterProps, "isRead" | "onMarkRead">>): ReactElement => (
  <Button
    variant="ghost"
    onClick={handleMarkRead}
    className={getFooterReadClassName(isRead)}
    title="Mark as read (M)"
    aria-label="Mark article as read"
  />
);

const RemoveFooterButton = ({
  onRemove: handleRemove,
}: Readonly<{ onRemove: () => void }>): ReactElement => (
  <Button
    variant="ghost"
    onClick={handleRemove}
    className="text-destructive hover:text-destructive hover:bg-destructive/10"
  >
    <Trash2 className="h-4 w-4" />
  </Button>
);

const ArticleDetailFooter = ({
  article,
  isRead,
  onMarkRead: handleMarkRead,
  onRemove: handleRemove,
}: ArticleDetailFooterProps): ReactElement => (
  <div className="flex gap-3 border-t border-border p-6 flex-shrink-0">
    <ReadSourceButton article={article} />
    <MarkReadFooterButton isRead={isRead} onMarkRead={handleMarkRead} />
    <RemoveFooterButton onRemove={handleRemove} />
  </div>
);

interface ArticleDetailViewProps {
  readonly article: NewsArticle;
  readonly index: number;
  readonly count: number;
  readonly readTime?: number;
  readonly articleLoading: boolean;
  readonly fullArticleText?: string;
  readonly aiAnalysis?: QueueAnalysisView;
  readonly aiAnalysisLoading: boolean;
  readonly source?: QueueSourceView;
  readonly sourceLoading: boolean;
  readonly showSourceDetails: boolean;
  readonly handleToggleSourceDetails: () => void;
  readonly debugOpen: boolean;
  readonly handleToggleDebug: () => void;
  readonly debugLoading: boolean;
  readonly debugData?: QueueSourceDebugView;
  readonly isLiked: boolean;
  readonly isFavorite: boolean;
  readonly isBookmarked: boolean;
  readonly isRead: boolean;
  readonly handlePrevious: () => void;
  readonly handleNext: () => void;
  readonly handleClose: () => void;
  readonly handleLike: () => void;
  readonly handleFavorite: () => void;
  readonly handleBookmark: () => void;
  readonly handleMarkRead: () => void;
  readonly handleRemove: () => void;
}

const ArticleDetailGrid = ({
    details,
  }: Readonly<{ readonly details: ArticleDetailViewProps }>): ReactElement => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
      <ArticleDetailMain
        article={details.article}
        articleLoading={details.articleLoading}
        fullArticleText={details.fullArticleText}
        isBookmarked={details.isBookmarked}
        isFavorite={details.isFavorite}
        isLiked={details.isLiked}
        isRead={details.isRead}
        onBookmark={details.handleBookmark}
        onFavorite={details.handleFavorite}
        onLike={details.handleLike}
        onMarkRead={details.handleMarkRead}
      />
      <ArticleDetailSidebar
        aiAnalysis={details.aiAnalysis}
        aiAnalysisLoading={details.aiAnalysisLoading}
        debugData={details.debugData}
        debugLoading={details.debugLoading}
        debugOpen={details.debugOpen}
        onToggleDebug={details.handleToggleDebug}
        onToggleSourceDetails={details.handleToggleSourceDetails}
        showSourceDetails={details.showSourceDetails}
        source={details.source}
        sourceLoading={details.sourceLoading}
      />
    </div>
  ),
  ArticleDetailScroll = ({
    details,
  }: Readonly<{ readonly details: ArticleDetailViewProps }>): ReactElement => (
    <div className="flex-1 overflow-y-auto">
      <ArticleDetailGrid details={details} />
    </div>
  ),
  ArticleDetailView = ({
    details,
  }: Readonly<{ readonly details: ArticleDetailViewProps }>): ReactElement => (
    <div className="flex flex-col h-full overflow-hidden">
      <ArticleDetailHeader
        article={details.article}
        count={details.count}
        index={details.index}
        onClose={details.handleClose}
        onNext={details.handleNext}
        onPrevious={details.handlePrevious}
        readTime={details.readTime}
      />
      <ArticleDetailScroll details={details} />
      <ArticleDetailFooter
        article={details.article}
        isRead={details.isRead}
        onMarkRead={details.handleMarkRead}
        onRemove={details.handleRemove}
      />
    </div>
  );

export { ArticleDetailView };
export type {
  QueueAnalysisView,
  QueueSourceDebugView,
  QueueSourceView,
} from "@/components/reading-queue-article-detail-sidebar";
