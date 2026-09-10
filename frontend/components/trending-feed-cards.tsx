import { useCallback } from "react";
import { Clock, Heart, MinusCircle, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/safe-image";
import { isUsableImage } from "@/lib/article-image";
import { pickClusterImageUrl } from "@/lib/cluster-display";
import { formatTimeAgo, trendingArticleToNewsArticle } from "./trending-feed-helpers";
import type {
  MousePropagationEvent,
  ReadonlyBreakingCluster,
  ReadonlyClusterArticle,
  ReadonlyTrendingCluster,
} from "./trending-feed-helpers";

interface ClusterCardActionsProps {
  readonly article: ReturnType<typeof trendingArticleToNewsArticle>;
  readonly inQueue: boolean;
  readonly liked: boolean;
  readonly onLike: (articleId: number, event: MousePropagationEvent) => void;
  readonly onQueueToggle: (
    article: ReturnType<typeof trendingArticleToNewsArticle>,
    event: MousePropagationEvent,
  ) => void;
}

const QueueActionButton = ({
  article,
  inQueue,
  onQueueToggle,
}: Readonly<Pick<ClusterCardActionsProps, "article" | "inQueue" | "onQueueToggle">>) => {
  const handleQueueClick = useCallback(
    (event: MousePropagationEvent) => {
      onQueueToggle(article, event);
    },
    [article, onQueueToggle],
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleQueueClick}
      className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
    >
      <QueueActionIcon inQueue={inQueue} />
    </Button>
  );
};

const QueueActionIcon = ({ inQueue }: Readonly<{ inQueue: boolean }>) => {
  if (inQueue) {
    return <MinusCircle className="w-2.5 h-2.5 text-foreground/70 sm:h-3 sm:w-3" />;
  }
  return <PlusCircle className="w-2.5 h-2.5 text-foreground sm:h-3 sm:w-3" />;
};

const LikeActionButton = ({
  article,
  liked,
  onLike,
}: Readonly<Pick<ClusterCardActionsProps, "article" | "liked" | "onLike">>) => {
  const handleLikeClick = useCallback(
    (event: MousePropagationEvent) => {
      onLike(article.id, event);
    },
    [article.id, onLike],
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLikeClick}
      className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
    >
      <Heart className={getLikeClassName(liked)} />
    </Button>
  );
};

const getLikeClassName = (liked: boolean): string => {
  if (liked) {
    return "h-2.5 w-2.5 sm:h-3 sm:w-3 fill-current text-foreground";
  }
  return "h-2.5 w-2.5 sm:h-3 sm:w-3 text-muted-foreground";
};

const ClusterCardActions = ({
  article,
  inQueue,
  liked,
  onLike,
  onQueueToggle,
}: Readonly<ClusterCardActionsProps>) => (
  <div className="pointer-events-auto absolute right-1 top-1 z-20 flex gap-1 opacity-100 transition-opacity sm:right-2 sm:top-2 sm:opacity-0 sm:group-hover:opacity-100">
    <QueueActionButton article={article} inQueue={inQueue} onQueueToggle={onQueueToggle} />
    <LikeActionButton article={article} liked={liked} onLike={onLike} />
  </div>
);

const ClusterCardImage = ({
  imageUrl,
  alt,
  fallbackClassName,
}: Readonly<{
  readonly imageUrl: string | null;
  readonly alt: string;
  readonly fallbackClassName: string;
}>) => {
  if (isUsableImage(imageUrl)) {
    return (
      <SafeImage
        src={imageUrl}
        alt={alt}
        fill
        className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105"
      />
    );
  }
  return <div className={`w-full h-full ${fallbackClassName}`} />;
};

const BreakingMarker = () => (
  <div className="pointer-events-none absolute bottom-1 left-1 sm:bottom-2 sm:left-2">
    <span className="bg-red-500 px-1.5 py-0.5 text-xs font-bold tracking-normal text-white shadow-lg sm:font-mono sm:text-[8px] sm:uppercase sm:tracking-[0.18em]">
      Breaking
    </span>
  </div>
);

const TrendingRankMarker = ({ rank }: Readonly<{ rank?: number }>) => (
  <div className="pointer-events-none absolute left-1 top-1 border border-white/10 bg-black/60 px-1 py-0.5 text-xs text-white/80 backdrop-blur-sm sm:left-2 sm:top-2 sm:px-1.5 sm:font-mono sm:text-[9px]">
    #{rank}
  </div>
);

const ClusterCardMarker = (props: Readonly<{ isBreaking: boolean; rank?: number }>) => {
  if (props.isBreaking) {
    return <BreakingMarker />;
  }
  return <TrendingRankMarker rank={props.rank} />;
};

interface ClusterCardMediaProps {
  readonly article: ReadonlyClusterArticle;
  readonly actionArticle: ReturnType<typeof trendingArticleToNewsArticle>;
  readonly imageUrl: string | null;
  readonly label: string;
  readonly isBreaking: boolean;
  readonly rank?: number;
  readonly inQueue: boolean;
  readonly liked: boolean;
  readonly onLike: (articleId: number, event: MousePropagationEvent) => void;
  readonly onQueueToggle: (
    article: ReturnType<typeof trendingArticleToNewsArticle>,
    event: MousePropagationEvent,
  ) => void;
}

const ClusterCardMedia = (props: Readonly<ClusterCardMediaProps>) => (
  <div className="pointer-events-none relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-lg">
    <ClusterCardImage
      imageUrl={props.imageUrl}
      alt={props.article.title || props.label}
      fallbackClassName={getFallbackClassName(props.isBreaking)}
    />
    <ClusterCardActions
      article={props.actionArticle}
      inQueue={props.inQueue}
      liked={props.liked}
      onLike={props.onLike}
      onQueueToggle={props.onQueueToggle}
    />
    <ClusterCardMarker isBreaking={props.isBreaking} rank={props.rank} />
  </div>
);

const getFallbackClassName = (isBreaking: boolean): string => {
  if (isBreaking) {
    return "bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.15),transparent_70%)]";
  }
  return "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]";
};

const ClusterCardFooter = ({
  article,
  footerText,
  isBreaking,
}: Readonly<{
  readonly article: ReadonlyClusterArticle;
  readonly footerText: string;
  readonly isBreaking: boolean;
}>) => (
  <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-1.5 sm:pt-3">
    <div className="flex items-center gap-1 text-xs tracking-normal text-muted-foreground/40 sm:gap-1.5 sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest">
      <Clock className="w-3 h-3 opacity-50" />
      <span>{formatTimeAgo(article.published_at)}</span>
    </div>
    <span className={getFooterClassName(isBreaking)}>{footerText}</span>
  </div>
);

const ClusterCardBody = ({
  article,
  statsText,
  footerText,
  isBreaking,
  label,
}: Readonly<
  Pick<ClusterCardProps, "article" | "statsText" | "footerText" | "isBreaking" | "label">
>) => (
  <div className="pointer-events-none flex flex-1 flex-col space-y-1.5 p-1.5 sm:space-y-3 sm:p-4">
    <div className="space-y-1 sm:space-y-2">
      <h3 className="line-clamp-4 font-serif text-sm leading-tight text-foreground/90 transition-colors group-hover:text-white sm:text-[15px]">
        {article.title || label}
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground/60 tracking-normal sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-wider">
        {statsText}
      </p>
    </div>
    <ClusterCardFooter article={article} footerText={footerText} isBreaking={isBreaking} />
  </div>
);

const getFooterClassName = (isBreaking: boolean): string => {
  if (isBreaking) {
    return "text-red-400/60 text-xs font-bold tracking-normal sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest";
  }
  return "text-xs tabular-nums text-muted-foreground/30 tracking-normal sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest";
};

const getClusterAriaLabel = (isBreaking: boolean, title: string, label: string): string => {
  if (isBreaking) {
    return `Open breaking story: ${title || label}`;
  }
  return `Open trending story: ${title || label}`;
};

interface ClusterCardProps {
  readonly article: ReadonlyClusterArticle;
  readonly imageUrl: string | null;
  readonly label: string;
  readonly isBreaking: boolean;
  readonly rank?: number;
  readonly statsText: string;
  readonly footerText: string;
  readonly inQueue: boolean;
  readonly liked: boolean;
  readonly onLike: (articleId: number, event: MousePropagationEvent) => void;
  readonly onQueueToggle: (
    article: ReturnType<typeof trendingArticleToNewsArticle>,
    event: MousePropagationEvent,
  ) => void;
  readonly onOpen: () => void;
}

const ClusterCard = ({
  article,
  imageUrl,
  label,
  isBreaking,
  rank,
  statsText,
  footerText,
  inQueue,
  liked,
  onLike,
  onQueueToggle,
  onOpen,
}: Readonly<ClusterCardProps>) => {
  const actionArticle = trendingArticleToNewsArticle(article, label);
  return (
    <article className="group relative flex min-h-48 w-full flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 text-left shadow-xl transition-all duration-500 ease-out hover:bg-white/[0.03] hover:shadow-2xl sm:min-h-0 sm:rounded-lg">
      <button
        type="button"
        aria-label={getClusterAriaLabel(isBreaking, article.title, label)}
        onClick={onOpen}
        className="absolute inset-0 z-0"
      />
      {isBreaking && (
        <div className="pointer-events-none absolute top-0 left-0 z-10 h-full w-px bg-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.4)]" />
      )}
      <ClusterCardMedia
        article={article}
        actionArticle={actionArticle}
        imageUrl={imageUrl}
        label={label}
        isBreaking={isBreaking}
        rank={rank}
        inQueue={inQueue}
        liked={liked}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
      />
      <ClusterCardBody
        article={article}
        label={label}
        statsText={statsText}
        footerText={footerText}
        isBreaking={isBreaking}
      />
    </article>
  );
};

interface ClusterCardSharedProps {
  readonly onClusterClick: (
    cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster,
    isBreaking: boolean,
  ) => void;
  readonly onQueueToggle: (
    article: ReturnType<typeof trendingArticleToNewsArticle>,
    event: MousePropagationEvent,
  ) => void;
  readonly onLike: (articleId: number, event: MousePropagationEvent) => void;
  readonly isInQueue: (url: string) => boolean;
  readonly isLiked: ReadonlySet<number>;
}

const BreakingCard = ({
  cluster,
  onClusterClick,
  onQueueToggle,
  onLike,
  isInQueue,
  isLiked,
}: Readonly<ClusterCardSharedProps & { cluster: ReadonlyBreakingCluster }>) => {
  const handleOpen = useCallback(() => {
    onClusterClick(cluster, true);
  }, [cluster, onClusterClick]);
  const article = cluster.representative_article;
  if (!article) {
    return null;
  }
  const label = cluster.label ?? cluster.keywords.slice(0, 3).join(" ");
  return (
    <ClusterCard
      article={article}
      imageUrl={pickClusterImageUrl(cluster)}
      label={label}
      isBreaking
      statsText={`${cluster.article_count_3h} updates in 3h`}
      footerText={`${cluster.spike_magnitude.toFixed(1)}x spike`}
      inQueue={isInQueue(article.url)}
      liked={isLiked.has(article.id)}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
      onOpen={handleOpen}
    />
  );
};

const TrendingCard = ({
  cluster,
  rank,
  onClusterClick,
  onQueueToggle,
  onLike,
  isInQueue,
  isLiked,
}: Readonly<ClusterCardSharedProps & { cluster: ReadonlyTrendingCluster; rank: number }>) => {
  const handleOpen = useCallback(() => {
    onClusterClick(cluster, false);
  }, [cluster, onClusterClick]);
  const article = cluster.representative_article;
  if (!article) {
    return null;
  }
  const label = cluster.label ?? cluster.keywords.slice(0, 3).join(" ");
  return (
    <ClusterCard
      article={article}
      imageUrl={pickClusterImageUrl(cluster)}
      label={label}
      isBreaking={false}
      rank={rank}
      statsText={`${cluster.source_diversity} sources`}
      footerText={`${cluster.article_count} stories`}
      inQueue={isInQueue(article.url)}
      liked={isLiked.has(article.id)}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
      onOpen={handleOpen}
    />
  );
};

export { BreakingCard, TrendingCard };
