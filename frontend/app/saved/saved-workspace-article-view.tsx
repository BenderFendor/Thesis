import { Bookmark, ChevronDown, ChevronRight, Heart, MinusCircle, PlusCircle } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SafeImage } from "@/components/safe-image";
import { cn } from "@/lib/utils";
import {
  ARTICLE_THUMBNAIL_SIZE,
  getArticleStackStyle,
  getCardFrameStyle,
  hasUsableArticleImage,
} from "@/app/saved/saved-workspace-helpers";
import type {
  ArticleActionProps,
  ArticleCardHeaderProps,
  ArticleCardProps,
  ArticleListProps,
  ArticleKindIconProps,
  EmptyStateCardProps,
  ExpandIndicatorProps,
  ExpandedArticleContentProps,
  ResearchShelvesCardProps,
  SavedController,
  SavedNewsArticle,
  IconComponent,
  ShelfListProps,
  ControllerProps,
} from "@/app/saved/saved-workspace-types";

type SavedArticle = ArticleListProps["articles"][number];

const EmptyStateCard = (props: Readonly<EmptyStateCardProps>): ReactElement => {
  const { cardClassName = "", description, icon: Icon, showBrowseLink = false, title } = props;
  return (
    <Card
      className={`border-dashed border-white/20 bg-[var(--news-bg-secondary)]/50 ${cardClassName}`}
    >
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Icon className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="mb-2 font-serif text-lg font-semibold">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        {showBrowseLink && (
          <Link href="/" className={cn(buttonVariants(), "mt-4")} data-slot="button">
            Browse News
          </Link>
        )}
      </CardContent>
    </Card>
  );
};

const ShelfList = (props: ShelfListProps): ReactElement => {
  const { shelves, loading } = props;
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading shelves...</p>;
  }
  if (shelves === undefined || shelves.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create shelves for topics, open questions, and claim trails.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {shelves.map((shelf) => (
        <div
          key={shelf.id ?? shelf.name}
          className="rounded-md border border-white/10 bg-[var(--news-bg-primary)]/50 px-3 py-2"
        >
          <div className="text-sm font-medium">{shelf.name}</div>
          {(shelf.description?.trim().length ?? 0) > 0 && (
            <div className="text-xs text-muted-foreground">{shelf.description}</div>
          )}
        </div>
      ))}
    </div>
  );
};

const ResearchShelvesHeader = (props: Readonly<{ count: number }>): ReactElement => (
  <div className="mb-4 flex items-center justify-between">
    <h3 className="font-serif text-lg font-bold">Research Shelves</h3>
    <Badge>{props.count}</Badge>
  </div>
);

const CreateShelfButton = (
  props: Readonly<{ disabled: boolean; onClick: () => void }>,
): ReactElement => (
  <Button variant="outline" size="sm" onClick={props.onClick} disabled={props.disabled}>
    <PlusCircle className="h-4 w-4" />
  </Button>
);

const ResearchShelfForm = (
  props: Readonly<
    Pick<
      ResearchShelvesCardProps,
      "isPending" | "newShelfName" | "onCreateShelf" | "onNewShelfNameChange"
    >
  >,
): ReactElement => {
  const { isPending, newShelfName, onCreateShelf, onNewShelfNameChange } = props;
  const handleChange = useCallback<NonNullable<ComponentProps<"input">["onChange"]>>(
    (event) => {
      onNewShelfNameChange(event.target.value);
    },
    [onNewShelfNameChange],
  );
  const handleKeyDown = useCallback<NonNullable<ComponentProps<"input">["onKeyDown"]>>(
    (event) => {
      if (event.key === "Enter") {
        onCreateShelf();
      }
    },
    [onCreateShelf],
  );
  return (
    <div className="mb-3 flex gap-2">
      <input
        value={newShelfName}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="New shelf"
        className="min-w-0 flex-1 rounded-md border border-white/10 bg-[var(--news-bg-primary)] px-3 py-2 text-sm text-foreground"
      />
      <CreateShelfButton
        onClick={onCreateShelf}
        disabled={isPending || newShelfName.trim().length === 0}
      />
    </div>
  );
};

const ResearchShelvesCard = (props: ResearchShelvesCardProps): ReactElement => {
  const { shelves, shelvesLoading } = props;
  return (
    <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
      <CardContent className="p-4">
        <ResearchShelvesHeader count={shelves?.length ?? 0} />
        <ResearchShelfForm
          isPending={props.isPending}
          newShelfName={props.newShelfName}
          onCreateShelf={props.onCreateShelf}
          onNewShelfNameChange={props.onNewShelfNameChange}
        />
        <ShelfList shelves={shelves} loading={shelvesLoading} />
      </CardContent>
    </Card>
  );
};

const SavedShelfCard = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const handleNewShelfNameChange = useCallback(
    (name: string) => {
      controller.setNewShelfName(name);
    },
    [controller],
  );
  const handleCreateShelf = useCallback(() => {
    controller.createShelf();
  }, [controller]);
  return (
    <ResearchShelvesCard
      shelves={controller.shelves}
      shelvesLoading={controller.shelvesLoading}
      newShelfName={controller.newShelfName}
      onNewShelfNameChange={handleNewShelfNameChange}
      onCreateShelf={handleCreateShelf}
      isPending={controller.shelfPending}
    />
  );
};

const ArticleKindIcon = (props: Readonly<ArticleKindIconProps>): ReactElement => {
  if (props.kind === "liked") {
    return <Heart className="h-3.5 w-3.5 fill-current" />;
  }
  return <Bookmark className="h-3.5 w-3.5 fill-current" />;
};

const ExpandIndicator = (props: Readonly<ExpandIndicatorProps>): ReactElement => {
  if (props.expanded) {
    return <ChevronDown className="h-5 w-5 text-muted-foreground" />;
  }
  return <ChevronRight className="h-5 w-5 text-muted-foreground" />;
};

const ArticleKindBadge = (props: Readonly<ArticleKindIconProps>): ReactElement => (
  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
    <ArticleKindIcon kind={props.kind} />
  </div>
);

const ReadTimeBadge = (props: Readonly<{ minutes: number }>): ReactElement => (
  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">{props.minutes}m</span>
);

const BothSavedBadge = (): ReactElement => (
  <Badge variant="outline" className="text-xs">
    <Heart className="mr-1 h-3 w-3" /> Liked
  </Badge>
);

const ArticleCardMetadata = (
  props: Readonly<{ article: Readonly<SavedArticle> }>,
): ReactElement => {
  const { article } = props;
  const { _queueData: queueData } = article;
  const readTime = queueData?.readingTimeMinutes;
  return (
    <div className="mt-1 flex items-center gap-2">
      <p className="text-xs text-muted-foreground">{article.source}</p>
      {readTime !== undefined && <ReadTimeBadge minutes={readTime} />}
      {article.type === "both" && <BothSavedBadge />}
    </div>
  );
};

const ArticleThumbnail = (props: Readonly<{ article: Readonly<SavedArticle> }>): ReactElement => (
  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
    <SafeImage
      src={props.article.image}
      alt={props.article.title}
      width={ARTICLE_THUMBNAIL_SIZE}
      height={ARTICLE_THUMBNAIL_SIZE}
      className="h-full w-full object-cover"
      sizes="64px"
    />
  </div>
);

const ArticleCardHeader = (props: Readonly<ArticleCardHeaderProps>): ReactElement => {
  const { article, isExpanded } = props;
  return (
    <div className="flex items-start gap-3">
      <ArticleKindBadge kind={article.type} />
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "font-serif font-bold leading-tight transition-colors group-hover:text-primary",
            isExpanded && "text-base",
            !isExpanded && "line-clamp-2 text-sm",
          )}
        >
          {article.title}
        </h3>
        <ArticleCardMetadata article={article} />
      </div>
      {hasUsableArticleImage(article) && <ArticleThumbnail article={article} />}
      <div className="flex-shrink-0 self-center">
        <ExpandIndicator expanded={isExpanded} />
      </div>
    </div>
  );
};

const SavedToggleButton = (
  props: Readonly<{
    active: boolean;
    activeClassName: string;
    icon: IconComponent;
    label: string;
    onClick: () => void;
  }>,
): ReactElement => {
  const Icon = props.icon;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={props.onClick}
      className={cn("text-muted-foreground", props.active && props.activeClassName)}
    >
      <Icon className={cn("mr-1 h-4 w-4", props.active && "fill-current")} />
      {props.label}
    </Button>
  );
};

const CardActionButtons = (props: Readonly<ArticleActionProps>): ReactElement => {
  const { article, bookmarkIds, inQueue, likedIds, onBookmark, onLike, onRead, onToggleQueue } =
    props;
  const isLiked = likedIds.has(article.id);
  const isBookmarked = bookmarkIds.has(article.id);
  const handleRead = useCallback(() => {
    onRead(article);
  }, [article, onRead]);
  const handleQueue = useCallback(() => {
    onToggleQueue(article);
  }, [article, onToggleQueue]);
  const handleLike = useCallback(() => {
    void onLike(article.id);
  }, [article.id, onLike]);
  const handleBookmark = useCallback(() => {
    void onBookmark(article.id);
  }, [article.id, onBookmark]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={handleRead}>
        Read Article
      </Button>
      <Button size="sm" variant="outline" onClick={handleQueue}>
        {inQueue && <MinusCircle className="mr-1 h-4 w-4" />}
        {!inQueue && <PlusCircle className="mr-1 h-4 w-4" />}
        {inQueue && "Remove from Queue"}
        {!inQueue && "Add to Queue"}
      </Button>
      <SavedToggleButton
        active={isLiked}
        activeClassName="text-red-400"
        icon={Heart}
        label="Like"
        onClick={handleLike}
      />
      <SavedToggleButton
        active={isBookmarked}
        activeClassName="text-yellow-400"
        icon={Bookmark}
        label="Bookmark"
        onClick={handleBookmark}
      />
      <Button size="sm" variant="ghost" asChild>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          Open Source
        </a>
      </Button>
    </div>
  );
};

const ExpandedArticleImage = (
  props: Readonly<{ article: Readonly<Pick<SavedNewsArticle, "image" | "title">> }>,
): ReactElement => {
  const { article } = props;
  const { image, title } = article;
  return (
    <div className="mb-4 overflow-hidden rounded-lg">
      <SafeImage
        src={image}
        alt={title}
        width={896}
        height={192}
        className="h-48 w-full object-cover"
        sizes="(min-width: 1024px) 50vw, 100vw"
      />
    </div>
  );
};

const ExpandedArticleContent = (
  props: Readonly<ExpandedArticleContentProps>,
): ReactElement | null => {
  const {
    article,
    bookmarkIds,
    inQueue,
    isExpanded,
    likedIds,
    onBookmark,
    onLike,
    onRead,
    onToggleQueue,
  } = props;
  if (!isExpanded) {
    return null;
  }
  return (
    <div className="mt-4 border-t border-border/50 pt-4">
      {hasUsableArticleImage(article) && <ExpandedArticleImage article={article} />}
      <p className="mb-4 line-clamp-4 text-sm text-muted-foreground">{article.summary}</p>
      <CardActionButtons
        article={article}
        bookmarkIds={bookmarkIds}
        inQueue={inQueue}
        likedIds={likedIds}
        onBookmark={onBookmark}
        onLike={onLike}
        onRead={onRead}
        onToggleQueue={onToggleQueue}
      />
    </div>
  );
};

const ArticleCardHeaderButton = (
  props: Readonly<ArticleCardHeaderProps & { onClick: () => void }>,
): ReactElement => (
  <button type="button" className="w-full text-left" onClick={props.onClick}>
    <ArticleCardHeader article={props.article} isExpanded={props.isExpanded} />
  </button>
);

const ArticleCard = (props: Readonly<ArticleCardProps>): ReactElement => {
  const handleToggleExpanded = useCallback(() => {
    if (props.isExpanded) {
      props.onToggleExpanded();
      return;
    }
    props.onToggleExpanded(props.article.url);
  }, [props]);
  return (
    <div className="w-full" style={getArticleStackStyle(props.index)}>
      <div
        className={cn(
          "group relative overflow-hidden rounded-2xl border p-4 backdrop-blur-sm transition-all duration-300",
          props.isExpanded && "shadow-2xl ring-2",
          !props.isExpanded && "shadow-lg hover:shadow-xl",
        )}
        style={getCardFrameStyle(props.isExpanded)}
      >
        <ArticleCardHeaderButton
          article={props.article}
          isExpanded={props.isExpanded}
          onClick={handleToggleExpanded}
        />
        <ExpandedArticleContent
          article={props.article}
          bookmarkIds={props.bookmarkIds}
          inQueue={props.inQueue}
          isExpanded={props.isExpanded}
          likedIds={props.likedIds}
          onBookmark={props.onBookmark}
          onLike={props.onLike}
          onRead={props.onRead}
          onToggleQueue={props.onToggleQueue}
        />
      </div>
    </div>
  );
};

const useArticleListActions = (controller: SavedController) => {
  const handleToggleExpanded = useCallback(
    (articleUrl?: string): void => {
      controller.setExpandedArticleUrl(articleUrl);
    },
    [controller],
  );
  const handleRead = useCallback(
    (article: SavedNewsArticle): void => {
      controller.openArticle(article);
    },
    [controller],
  );
  const handleToggleQueue = useCallback(
    (article: SavedNewsArticle): void => {
      controller.toggleQueue(article);
    },
    [controller],
  );
  const handleLike = useCallback(
    (articleId: number): Promise<void> => controller.toggleLike(articleId),
    [controller],
  );
  const handleBookmark = useCallback(
    (articleId: number): Promise<void> => controller.toggleBookmark(articleId),
    [controller],
  );
  return { handleBookmark, handleLike, handleRead, handleToggleExpanded, handleToggleQueue };
};

const ArticleList = (props: Readonly<ArticleListProps>): ReactElement => {
  const { articles, controller } = props;
  const actions = useArticleListActions(controller);
  return (
    <div className="space-y-3">
      {articles.map((article, index) => (
        <ArticleCard
          key={`${article.id}:${article.url}`}
          article={article}
          index={index}
          isExpanded={controller.expandedArticleUrl === article.url}
          inQueue={controller.isArticleInQueue(article.url)}
          likedIds={controller.likedIds}
          bookmarkIds={controller.bookmarkIds}
          onToggleExpanded={actions.handleToggleExpanded}
          onRead={actions.handleRead}
          onToggleQueue={actions.handleToggleQueue}
          onLike={actions.handleLike}
          onBookmark={actions.handleBookmark}
        />
      ))}
    </div>
  );
};

export {
  ArticleCard,
  ArticleCardHeader,
  ArticleKindIcon,
  ArticleList,
  CardActionButtons,
  EmptyStateCard,
  ExpandIndicator,
  ExpandedArticleContent,
  ResearchShelvesCard,
  SavedShelfCard,
  ShelfList,
};
