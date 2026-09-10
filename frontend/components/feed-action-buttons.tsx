import { Bookmark, Heart, Star } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { NewsArticle } from "@/lib/api";
import { cn } from "@/lib/utils";

interface FeedActionButtonsProps {
  readonly article: NewsArticle;
  readonly liked: boolean;
  readonly favorite: boolean;
  readonly bookmarked: boolean;
  readonly onLike: (articleId: number) => void;
  readonly onFavorite: (sourceId: string) => void;
  readonly onBookmark: (articleId: number) => void;
}

interface FeedButtonClickEvent {
  readonly stopPropagation: () => void;
}

type FeedActionKind = "like" | "favorite" | "bookmark";

const getFeedActionLabel = (action: FeedActionKind): string => {
  if (action === "like") {
    return "Like article";
  }
  if (action === "favorite") {
    return "Favorite article";
  }
  return "Bookmark article";
};

const getFeedActionIconClassName = (action: FeedActionKind, active: boolean): string => {
  if (!active) {
    return "text-white/80";
  }
  if (action === "like") {
    return "fill-primary text-primary scale-110";
  }
  if (action === "favorite") {
    return "fill-amber-400 text-amber-400 scale-110";
  }
  return "fill-white text-white scale-110";
};

const FeedActionIcon = ({
  action,
  active,
}: Readonly<{
  readonly action: FeedActionKind;
  readonly active: boolean;
}>) => {
  const className = cn(
    "w-5 h-5 md:w-6 md:h-6 transition-all",
    getFeedActionIconClassName(action, active),
  );
  if (action === "like") {
    return <Heart className={className} />;
  }
  if (action === "favorite") {
    return <Star className={className} />;
  }
  return <Bookmark className={className} />;
};

const FeedActionIconButton = ({
  action,
  active,
  onClick,
}: Readonly<{
  readonly action: FeedActionKind;
  readonly active: boolean;
  readonly onClick: (event: FeedButtonClickEvent) => void;
}>) => (
  <Button
    variant="ghost"
    size="icon"
    className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-white/20 transition-all active:scale-95"
    onClick={onClick}
    aria-label={getFeedActionLabel(action)}
  >
    <FeedActionIcon action={action} active={active} />
  </Button>
);

const FeedActionButtons = ({
  article,
  liked,
  favorite,
  bookmarked,
  onLike,
  onFavorite,
  onBookmark,
}: Readonly<FeedActionButtonsProps>): React.JSX.Element => {
  const handleLike = useCallback(
    (event: FeedButtonClickEvent) => {
      event.stopPropagation();
      onLike(article.id);
    },
    [article.id, onLike],
  );
  const handleFavorite = useCallback(
    (event: FeedButtonClickEvent) => {
      event.stopPropagation();
      onFavorite(article.sourceId);
    },
    [article.sourceId, onFavorite],
  );
  const handleBookmark = useCallback(
    (event: FeedButtonClickEvent) => {
      event.stopPropagation();
      onBookmark(article.id);
    },
    [article.id, onBookmark],
  );

  return (
    <div className="flex flex-row md:flex-col items-center gap-2 md:gap-4 bg-black/40 backdrop-blur-xl p-2 md:p-3 border border-white/20 rounded-xl self-start md:self-auto">
      <FeedActionIconButton action="like" active={liked} onClick={handleLike} />
      <FeedActionIconButton action="favorite" active={favorite} onClick={handleFavorite} />
      <FeedActionIconButton action="bookmark" active={bookmarked} onClick={handleBookmark} />
    </div>
  );
};

export { FeedActionButtons };
