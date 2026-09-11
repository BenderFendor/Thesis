import type {
  ActionIconProps,
  ModalActionsProps,
  NewsArticle,
} from "../lib/article-detail-modal-data";
import { Bookmark, Heart, Loader2, MinusCircle, PlusCircle, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

const EMPTY_COUNT = 0;

const getModalActionStates = (
  article: Readonly<NewsArticle>,
  isLiked: (articleId: number) => boolean,
  isFavorite: (sourceId: string) => boolean,
  isBookmarked: (articleId: number) => boolean,
  isArticleInQueue: (url: string) => boolean,
) => ({
  bookmarked: article.id !== EMPTY_COUNT && isBookmarked(article.id),
  favorited: isFavorite(article.sourceId),
  inQueue: isArticleInQueue(article.url),
  liked: article.id !== EMPTY_COUNT && isLiked(article.id),
});

type ModalActionStates = Readonly<ReturnType<typeof getModalActionStates>>;

const getBookmarkTitle = (canPersist: boolean): string => {
  if (canPersist) {
    return "Bookmark article";
  }
  return "Only indexed articles can be bookmarked.";
};

const getFavoriteTitle = (active: boolean): string => {
  if (active) {
    return "Remove from favorites";
  }
  return "Add to favorites";
};

const getLikeTitle = (canPersist: boolean): string => {
  if (canPersist) {
    return "Like article";
  }
  return "Only indexed articles can be liked.";
};

const getQueueLabel = (active: boolean): string => {
  if (active) {
    return "Remove from Queue";
  }
  return "Add to Queue";
};

const getActionClassName = (active: boolean, activeClass: string): string => {
  if (active) {
    return activeClass;
  }
  return "text-gray-400";
};

const getActionIconClassName = (active: boolean): string => {
  if (active) {
    return "fill-current";
  }
  return "";
};

const AnalysisActionIcon = ({ loading }: Readonly<{ loading: boolean }>) => {
  if (loading) {
    return <Loader2 className="mr-2 h-4 w-4 animate-spin" />;
  }
  return <Sparkles className="mr-2 h-4 w-4" />;
};

const AnalysisActionButton = ({
  active,
  aiActionLabel,
  aiAnalysisLoading,
  aiHasError,
  canRequestAiAnalysis,
  onClick,
}: Readonly<{
  readonly active: boolean;
  readonly aiActionLabel: string;
  readonly aiAnalysisLoading: boolean;
  readonly aiHasError: boolean;
  readonly canRequestAiAnalysis: boolean;
  readonly onClick: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    disabled={!canRequestAiAnalysis || aiAnalysisLoading}
    className={getActionClassName(active && !aiHasError, "text-emerald-400")}
    title="AI analysis is opt-in to reduce API calls"
  >
    <AnalysisActionIcon loading={aiAnalysisLoading} />
    {aiActionLabel}
  </Button>
);

const BookmarkActionIcon = ({ active }: Readonly<ActionIconProps>) => (
  <Bookmark className={`h-4 w-4 ${getActionIconClassName(active)}`} />
);

const BookmarkActionButton = ({
  active,
  canPersist,
  loading,
  onClick,
}: Readonly<{
  readonly active: boolean;
  readonly canPersist: boolean;
  readonly loading: boolean;
  readonly onClick: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-yellow-400")}
    disabled={loading || !canPersist}
    title={getBookmarkTitle(canPersist)}
  >
    <BookmarkActionIcon active={active} />
    Bookmark
  </Button>
);

const FavoriteActionIcon = ({ active }: Readonly<ActionIconProps>) => (
  <Star className={`mr-2 h-4 w-4 ${getActionIconClassName(active)}`} />
);

const FavoriteActionButton = ({
  active,
  onClick,
}: Readonly<{
  readonly active: boolean;
  readonly onClick: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-yellow-400")}
    title={getFavoriteTitle(active)}
  >
    <FavoriteActionIcon active={active} />
    Favorite
  </Button>
);

const LikeActionIcon = ({ active }: Readonly<ActionIconProps>) => (
  <Heart className={`mr-2 h-4 w-4 ${getActionIconClassName(active)}`} />
);

const LikeActionButton = ({
  active,
  canPersist,
  onClick,
}: Readonly<{
  readonly active: boolean;
  readonly canPersist: boolean;
  readonly onClick: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-red-400")}
    disabled={!canPersist}
    title={getLikeTitle(canPersist)}
  >
    <LikeActionIcon active={active} />
    Like
  </Button>
);

const QueueActionIcon = ({ active }: Readonly<ActionIconProps>) => {
  if (active) {
    return <MinusCircle className="mr-2 h-4 w-4" />;
  }
  return <PlusCircle className="mr-2 h-4 w-4" />;
};

const QueueActionButton = ({
  active,
  onClick,
}: Readonly<{
  readonly active: boolean;
  readonly onClick: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={getActionClassName(active, "text-blue-400")}
  >
    <QueueActionIcon active={active} />
    {getQueueLabel(active)}
  </Button>
);

const ModalActionButtonContent = ({
  props,
  actionStates,
}: Readonly<{
  props: Readonly<ModalActionsProps>;
  actionStates: ModalActionStates;
}>) => (
  <div className="flex items-center gap-4">
    <LikeActionButton
      active={actionStates.liked}
      canPersist={props.canPersist}
      onClick={props.onLike}
    />
    <FavoriteActionButton active={actionStates.favorited} onClick={props.onFavorite} />
    <BookmarkActionButton
      active={actionStates.bookmarked}
      canPersist={props.canPersist}
      loading={props.bookmarkLoading}
      onClick={props.onBookmark}
    />
    <AnalysisActionButton
      active={props.aiAnalysisRequested}
      aiActionLabel={props.aiActionLabel}
      aiAnalysisLoading={props.aiAnalysisLoading}
      aiHasError={props.aiHasError}
      canRequestAiAnalysis={props.canRequestAiAnalysis}
      onClick={props.onAiAnalysis}
    />
    <QueueActionButton active={actionStates.inQueue} onClick={props.onQueueToggle} />
  </div>
);

const ModalActionButtons = ({ props }: Readonly<{ props: Readonly<ModalActionsProps> }>) => {
  const actionStates = getModalActionStates(
    props.article,
    props.isLiked,
    props.isFavorite,
    props.isBookmarked,
    props.isArticleInQueue,
  );
  return <ModalActionButtonContent props={props} actionStates={actionStates} />;
};

export { ModalActionButtons };
