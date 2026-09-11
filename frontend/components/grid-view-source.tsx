"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart, MinusCircle, PlusCircle, Star } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ArticleCardDate } from "@/components/article-card-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { NewsArticle } from "@/lib/api";
import { SafeImage } from "@/components/safe-image";
import { isUsableImage } from "@/lib/article-image";

const VERTICAL_OFFSET_KEY = "y";
const ARTICLE_INITIAL = { opacity: 0, [VERTICAL_OFFSET_KEY]: 20 } as const;
const ARTICLE_ANIMATE = { opacity: 1, [VERTICAL_OFFSET_KEY]: 0 } as const;
const CARD_BUTTON_CLASS =
  "h-5 w-5 rounded-full bg-black/45 p-0 text-white backdrop-blur-md transition-all duration-300 hover:bg-white hover:text-black active:scale-95 sm:h-8 sm:w-8";
const COLLAPSED_SOURCE_ARTICLE_COUNT = 20;

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
interface GridSourceGroup {
  readonly articles: readonly NewsArticle[];
  readonly bias?: string;
  readonly credibility?: string;
  readonly sourceCountry?: string;
  readonly sourceId: string;
  readonly sourceName: string;
}

interface SourceArticleCardProps {
  readonly article: NewsArticle;
  readonly index: number;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onArticleClick: (article: NewsArticle) => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
}

interface SourceArticleImageProps {
  readonly article: NewsArticle;
  readonly showImage: boolean;
}

const articleFallbackClassName = (article: NewsArticle): string => {
  if (article.category === "breaking") {
    return "editorial-fallback-surface";
  }
  return "editorial-paper-surface";
};

const SourceArticleImageContent = ({ article, showImage }: SourceArticleImageProps) => {
  if (showImage) {
    return (
      <SafeImage
        src={article.image ?? undefined}
        alt={article.title}
        fill
        sizes="(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="object-cover grayscale transition duration-700 group-hover:scale-105 group-hover:grayscale-0"
      />
    );
  }
  return (
    <div
      className={`h-full w-full opacity-50 transition duration-700 group-hover:scale-105 ${articleFallbackClassName(article)}`}
    />
  );
};

const SourceArticleImage = ({ article, showImage }: SourceArticleImageProps) => (
  <div className="relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-lg">
    <SourceArticleImageContent article={article} showImage={showImage} />
    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-100" />
  </div>
);

interface SourceArticleActionsProps {
  readonly article: NewsArticle;
  readonly inQueue: boolean;
  readonly liked: boolean;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
}

const queueActionLabel = (inQueue: boolean): string => {
  if (inQueue) {
    return "Remove from queue";
  }
  return "Add to queue";
};

const QueueActionIcon = ({ inQueue }: Readonly<{ inQueue: boolean }>) => {
  if (inQueue) {
    return <MinusCircle className="h-2.5 w-2.5 sm:h-4 sm:w-4" />;
  }
  return <PlusCircle className="h-2.5 w-2.5 sm:h-4 sm:w-4" />;
};

const likeActionLabel = (liked: boolean): string => {
  if (liked) {
    return "Unlike";
  }
  return "Like";
};

const likeActionClassName = (liked: boolean): string => {
  if (liked) {
    return "fill-red-500 text-red-500 hover:text-red-600";
  }
  return "text-white";
};

const SourceArticleQueueButton = ({
  article,
  inQueue,
  onQueueToggle,
}: Readonly<Pick<SourceArticleActionsProps, "inQueue" | "onQueueToggle"> & { article: NewsArticle }>) => {
  const handleQueueToggle = useCallback(
    (event: GridButtonEvent) => {
      onQueueToggle(article, event);
    },
    [article, onQueueToggle],
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleQueueToggle}
      className={CARD_BUTTON_CLASS}
      title={queueActionLabel(inQueue)}
    >
      <QueueActionIcon inQueue={inQueue} />
    </Button>
  );
};

const SourceArticleLikeButton = ({
  article,
  liked,
  onLike,
}: Readonly<Pick<SourceArticleActionsProps, "article" | "liked" | "onLike">>) => {
  const handleLike = useCallback(
    (event: GridButtonEvent) => {
      onLike(article.id, event);
    },
    [article.id, onLike],
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLike}
      className={CARD_BUTTON_CLASS}
      title={likeActionLabel(liked)}
    >
      <Heart
        className={`h-2.5 w-2.5 transition-colors sm:h-4 sm:w-4 ${likeActionClassName(liked)}`}
      />
    </Button>
  );
};

const SourceArticleActions = ({
  article,
  inQueue,
  liked,
  onLike,
  onQueueToggle,
}: Readonly<SourceArticleActionsProps>) => (
    <div className="pointer-events-auto absolute right-1 top-1 z-20 flex gap-1 opacity-100 transition-all duration-300 sm:right-3 sm:top-3 sm:gap-2 md:translate-y-[-10px] md:opacity-0 md:group-hover:translate-y-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
      <SourceArticleQueueButton
        article={article}
        inQueue={inQueue}
        onQueueToggle={onQueueToggle}
      />
      <SourceArticleLikeButton article={article} liked={liked} onLike={onLike} />
    </div>
  );

const SourceArticleBadge = ({ article }: Readonly<{ article: NewsArticle }>) => (
  <div className="absolute left-1 top-1 z-10 flex max-w-20 flex-wrap gap-1 sm:left-3 sm:top-3 sm:max-w-none sm:gap-2">
    <Badge
      variant={(() => {
  if (article.category === "breaking") {
    return "destructive";
  }
  return "outline";
})()}
      className={`truncate rounded-sm border-0 px-1 py-0.5 text-xs font-medium tracking-normal backdrop-blur-md sm:rounded-md sm:px-2 sm:uppercase sm:tracking-widest ${(() => {
  if (article.category === "breaking") {
    return "bg-red-500/90 text-white shadow-lg";
  }
  return "bg-black/50 text-white/90";
})()}`}
    >
      {article.category}
    </Badge>
  </div>
);

const SourceArticleBody = ({ article }: Readonly<{ article: NewsArticle }>) => (
  <div className="pointer-events-none relative z-10 flex flex-1 flex-col p-1.5 pt-1 sm:p-5 sm:pt-4">
    <div className="mb-1 flex min-w-0 items-center text-xs font-semibold tracking-normal text-primary/80 sm:mb-3 sm:uppercase sm:tracking-widest">
      <span className="truncate">{article.source}</span>
    </div>
    <h3 className="mb-1 line-clamp-4 font-serif text-sm font-medium leading-tight text-foreground/90 transition-colors duration-300 group-hover:text-white sm:mb-3 sm:text-lg sm:leading-snug md:text-xl">
      {article.title}
    </h3>
    <p className="hidden text-sm leading-relaxed text-muted-foreground/80 sm:line-clamp-3">
      {article.summary}
    </p>
    <div className="mt-auto flex items-center justify-between pt-1.5 text-xs tracking-normal text-muted-foreground/60 transition-opacity duration-300 group-hover:text-muted-foreground sm:pt-5 sm:uppercase sm:tracking-widest">
      <ArticleCardDate date={article.publishedAt} />
      <span className="hidden text-primary/0 transition-colors duration-300 group-hover:text-primary sm:inline">
        Open brief -&gt;
      </span>
    </div>
  </div>
);

const SourceArticleCard = ({
  article,
  likedIds,
  isArticleInQueue,
  onArticleClick,
  onLike,
  onQueueToggle,
  index,
}: SourceArticleCardProps) => {
  const handleOpen = useCallback(() => {
    onArticleClick(article);
  }, [article, onArticleClick]);
  const inQueue = isArticleInQueue(article.url);
  const liked = likedIds.has(article.id);
  const showImage = isUsableImage(article.image);
  const transition = useMemo(
    () => ({ delay: index * 0.05, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const }),
    [index],
  );

  return (
    <motion.article
      initial={ARTICLE_INITIAL}
      animate={ARTICLE_ANIMATE}
      transition={transition}
      className="group relative flex h-full min-h-48 w-full flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 text-left shadow-xl transition-all duration-500 ease-out hover:bg-white/[0.03] hover:shadow-2xl sm:min-h-80 sm:rounded-lg"
    >
      <button
        type="button"
        aria-label={`Open article: ${article.title}`}
        onClick={handleOpen}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:rounded-lg"
      />
      <div className="pointer-events-none relative z-10 flex flex-col">
        <SourceArticleImage article={article} showImage={showImage} />
        <SourceArticleBadge article={article} />
        <SourceArticleActions
          article={article}
          inQueue={inQueue}
          liked={liked}
          onLike={onLike}
          onQueueToggle={onQueueToggle}
        />
      </div>
      <SourceArticleBody article={article} />
    </motion.article>
  );
};

interface SourceGroupSectionProps {
  readonly group: GridSourceGroup;
  readonly isExpanded: boolean;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onArticleClick: (article: NewsArticle, context: readonly NewsArticle[]) => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
  readonly onToggleExpand: () => void;
  readonly onToggleFavorite: (sourceId: string) => void;
}

const sourceFavoriteClassName = (favorite: boolean): string => {
  if (favorite) {
    return "fill-amber-400 text-amber-400";
  }
  return "text-white/40";
};

interface SourceGroupIdentityProps {
  readonly group: GridSourceGroup;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly onToggleFavorite: () => void;
}

const SourceGroupIdentity = ({
  group,
  isFavorite,
  onToggleFavorite,
}: Readonly<SourceGroupIdentityProps>) => (
  <div className="space-y-1 sm:space-y-3">
    <div className="flex items-center gap-2 sm:gap-4">
      <Link
        href={`/source/${encodeURIComponent(group.sourceId)}`}
        className="min-w-0 break-words font-serif text-2xl leading-none text-foreground transition-colors hover:text-primary sm:text-4xl md:text-5xl"
      >
        {group.sourceName}
      </Link>
      <SourceGroupFavoriteButton
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        sourceId={group.sourceId}
      />
    </div>
  </div>
);

const SourceGroupFavoriteButton = ({
  isFavorite,
  onToggleFavorite,
  sourceId,
}: Readonly<{
  isFavorite: (sourceId: string) => boolean;
  onToggleFavorite: () => void;
  sourceId: string;
}>) => (
  <Button
        variant="ghost"
        size="sm"
        onClick={onToggleFavorite}
        className="h-8 w-8 shrink-0 rounded-full bg-white/5 p-0 text-muted-foreground transition-all duration-300 hover:bg-white/10 hover:text-primary active:scale-95 sm:h-9 sm:w-9"
      >
    <Star className={`h-4 w-4 ${sourceFavoriteClassName(isFavorite(sourceId))}`} />
  </Button>
);

const SourceGroupStats = ({ group }: Readonly<{ group: GridSourceGroup }>) => (
  <div className="flex flex-wrap items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground sm:gap-2">
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-medium text-white/80 sm:px-3 sm:py-1.5">
      {group.articles.length} articles
    </span>
    {group.credibility !== undefined && group.credibility !== "" && (
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-medium text-white/80 sm:px-3 sm:py-1.5">
        {group.credibility} credibility
      </span>
    )}
    {group.bias !== undefined && group.bias !== "" && (
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-medium text-white/80 sm:px-3 sm:py-1.5">
        {group.bias} bias
      </span>
    )}
  </div>
);

const SourceGroupHeader = ({
  group,
  isFavorite,
  onToggleFavorite,
}: Readonly<SourceGroupIdentityProps>) => (
  <div className="mb-2 flex flex-col gap-2 border-t border-white/10 pt-3 sm:mb-6 sm:gap-4 sm:border-t-0 sm:pt-0 sm:pb-4 lg:flex-row lg:items-end lg:justify-between">
    <SourceGroupIdentity
      group={group}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
    />
    <SourceGroupStats group={group} />
  </div>
);

const sourceArticleKey = (article: NewsArticle): string => {
  if (article.url) {
    return `url:${article.url}`;
  }
  return `id:${article.id}`;
};

interface SourceArticlePresenceProps {
  readonly articles: readonly NewsArticle[];
  readonly isArticleInQueue: (url: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onArticleClick: (article: NewsArticle) => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
}

const SourceArticlePresence = ({
  articles,
  isArticleInQueue,
  likedIds,
  onArticleClick,
  onLike,
  onQueueToggle,
}: Readonly<SourceArticlePresenceProps>) => (
  <AnimatePresence>
    {articles.map((article, index) => (
      <SourceArticleCard
        key={sourceArticleKey(article)}
        article={article}
        index={index}
        likedIds={likedIds}
        isArticleInQueue={isArticleInQueue}
        onArticleClick={onArticleClick}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
      />
    ))}
  </AnimatePresence>
);

const SourceGroupArticleGrid = ({
  articles,
  isArticleInQueue,
  likedIds,
  onArticleClick,
  onLike,
  onQueueToggle,
}: Readonly<SourceArticlePresenceProps>) => (
  <div className="flex-1">
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      <SourceArticlePresence
        articles={articles}
        isArticleInQueue={isArticleInQueue}
        likedIds={likedIds}
        onArticleClick={onArticleClick}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
      />
    </div>
  </div>
);

const sourceExpandLabel = (isExpanded: boolean, articleCount: number): string => {
  if (isExpanded) {
    return "Show fewer stories";
  }
  return `View all ${articleCount} stories`;
};

const SourceGroupExpandButton = ({
  articleCount,
  isExpanded,
  onToggleExpand,
}: Readonly<{ articleCount: number; isExpanded: boolean; onToggleExpand: () => void }>) => (
  <div className="mt-4 flex justify-center pb-4 sm:mt-8 sm:pb-8">
    <Button
      variant="outline"
      onClick={onToggleExpand}
      className="rounded-full border-white/10 bg-transparent px-5 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition-all duration-300 hover:bg-white/5 hover:text-white sm:px-8 sm:py-5"
    >
      {sourceExpandLabel(isExpanded, articleCount)}
    </Button>
  </div>
);

const getDisplayedSourceArticles = (
  articles: readonly NewsArticle[],
  isExpanded: boolean,
): readonly NewsArticle[] => {
  if (isExpanded) {
    return articles;
  }
  return articles.slice(0, COLLAPSED_SOURCE_ARTICLE_COUNT);
};

const SourceGroupSection = ({
  group,
  isExpanded,
  likedIds,
  isArticleInQueue,
  isFavorite,
  onArticleClick,
  onLike,
  onQueueToggle,
  onToggleFavorite,
  onToggleExpand,
}: Readonly<SourceGroupSectionProps>) => {
  const displayedArticles = getDisplayedSourceArticles(group.articles, isExpanded);
  const handleArticleClick = useCallback(
    (article: NewsArticle) => {
      onArticleClick(article, group.articles);
    },
    [group.articles, onArticleClick],
  );
  const handleToggleFavorite = useCallback(() => {
    onToggleFavorite(group.sourceId);
  }, [group.sourceId, onToggleFavorite]);

  return (
    <section data-source-id={group.sourceId} className="grid-source-group flex flex-col">
      <SourceGroupHeader
        group={group}
        isFavorite={isFavorite}
        onToggleFavorite={handleToggleFavorite}
      />
      {displayedArticles.length > 0 && (
        <SourceGroupArticleGrid
          articles={displayedArticles}
          isArticleInQueue={isArticleInQueue}
          likedIds={likedIds}
          onArticleClick={handleArticleClick}
          onLike={onLike}
          onQueueToggle={onQueueToggle}
        />
      )}
      {group.articles.length > COLLAPSED_SOURCE_ARTICLE_COUNT && (
        <SourceGroupExpandButton
          articleCount={group.articles.length}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
        />
      )}
    </section>
  );
};

export { SourceArticleCard, SourceGroupSection };
