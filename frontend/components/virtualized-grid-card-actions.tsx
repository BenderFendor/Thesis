"use client";

import { Button } from "@/components/ui/button";
import { Heart, MinusCircle, PlusCircle } from "lucide-react";
import { useCallback } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import type { NewsArticle } from "@/lib/api";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";

const getQueueIcon = (inQueue: boolean): ReactNode => {
  if (inQueue) {
    return <MinusCircle className="h-3 w-3 text-foreground/70" />;
  }
  return <PlusCircle className="h-3 w-3 text-foreground" />;
};

const getLikeClassName = (liked: boolean): string => {
  if (liked) {
    return "fill-current text-foreground";
  }
  return "text-muted-foreground";
};

interface VirtualizedGridCardActionState {
  readonly handleLike: MouseEventHandler<HTMLButtonElement>;
  readonly handleQueueToggle: MouseEventHandler<HTMLButtonElement>;
  readonly inQueue: boolean;
  readonly liked: boolean;
}

const useVirtualizedGridCardActionState = (
  article: Readonly<NewsArticle>,
): VirtualizedGridCardActionState => {
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
  const { likedIds, toggleLike } = useLikedArticles();
  const inQueue = isArticleInQueue(article.url);
  const liked = likedIds.has(article.id);
  const handleQueueToggle = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      if (inQueue) {
        void removeArticleFromQueue(article.url);
      } else {
        void addArticleToQueue(article);
      }
    },
    [addArticleToQueue, article, inQueue, removeArticleFromQueue],
  );
  const handleLike = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      void toggleLike(article.id);
    },
    [article.id, toggleLike],
  );
  return { handleLike, handleQueueToggle, inQueue, liked };
};

const VirtualizedGridCardActions = ({
  article,
}: Readonly<{ article: Readonly<NewsArticle> }>): React.JSX.Element => {
  const { handleLike, handleQueueToggle, inQueue, liked } =
    useVirtualizedGridCardActionState(article);

  return (
    <div className="absolute right-1 top-1 flex gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleQueueToggle}
        className="h-6 w-6 bg-black/50 p-0 hover:bg-black/70"
      >
        {getQueueIcon(inQueue)}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLike}
        className="h-6 w-6 bg-black/50 p-0 hover:bg-black/70"
      >
        <Heart className={`h-3 w-3 ${getLikeClassName(liked)}`} />
      </Button>
    </div>
  );
};

export { VirtualizedGridCardActions };
