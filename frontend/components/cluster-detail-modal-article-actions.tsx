"use client";

import { Button } from "@/components/ui/button";
import { Heart, MinusCircle, PlusCircle } from "lucide-react";
import { useCallback } from "react";
import type { ClusterArticle } from "@/lib/api";
import { ArticleOriginalAnchor } from "./cluster-detail-modal-article-primitives";

interface ArticleTabActionProps {
  readonly article: ClusterArticle;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
}

const ArticleLikeButton = ({
  liked,
  onLike,
}: Readonly<{
  readonly liked: boolean;
  readonly onLike: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onLike}
    className={(() => {
      if (liked) {
        return "text-red-400";
      }
      return "text-gray-400";
    })()}
  >
    <Heart
      className={`h-4 w-4 mr-2 ${(() => {
        if (liked) {
          return "fill-current";
        }
        return "";
      })()}`}
    />
    Like
  </Button>
);

const ArticleQueueIcon = ({ inQueue }: Readonly<{ inQueue: boolean }>) => {
  if (inQueue) {
    return <MinusCircle className="h-4 w-4 mr-2" />;
  }
  return <PlusCircle className="h-4 w-4 mr-2" />;
};

const ArticleQueueButton = ({
  articleInQueue,
  onQueueToggle,
}: Readonly<{
  readonly articleInQueue: boolean;
  readonly onQueueToggle: () => void;
}>) => {
  let className = "text-gray-400";
  let label = "Add to Queue";
  if (articleInQueue) {
    className = "text-blue-400";
    label = "Remove";
  }
  return (
    <Button variant="ghost" size="sm" onClick={onQueueToggle} className={className}>
      <ArticleQueueIcon inQueue={articleInQueue} />
      {label}
    </Button>
  );
};

const ArticleActionButtons = ({
  articleInQueue,
  liked,
  onLike,
  onQueueToggle,
}: Readonly<{
  readonly articleInQueue: boolean;
  readonly liked: boolean;
  readonly onLike: () => void;
  readonly onQueueToggle: () => void;
}>) => (
  <div className="flex items-center gap-3">
    <ArticleLikeButton liked={liked} onLike={onLike} />
    <ArticleQueueButton articleInQueue={articleInQueue} onQueueToggle={onQueueToggle} />
  </div>
);

const ArticleReadOriginalButton = ({ url }: Readonly<{ url: string }>) => (
  <Button variant="outline" size="sm" asChild>
    <ArticleOriginalAnchor url={url} />
  </Button>
);

const ArticleTabActions = ({
  article,
  isArticleInQueue,
  likedIds,
  onLike,
  onQueueToggle,
}: Readonly<ArticleTabActionProps>) => {
  const handleLikeClick = useCallback(() => {
    onLike(article.id);
  }, [article.id, onLike]);
  const handleQueueClick = useCallback(() => {
    onQueueToggle(article);
  }, [article, onQueueToggle]);
  const articleInQueue = isArticleInQueue(article.url);
  return (
    <div className="flex items-center justify-between pt-6 border-t border-border/60">
      <ArticleActionButtons
        articleInQueue={articleInQueue}
        liked={likedIds.has(article.id)}
        onLike={handleLikeClick}
        onQueueToggle={handleQueueClick}
      />
      <ArticleReadOriginalButton url={article.url} />
    </div>
  );
};

export { ArticleTabActions };
