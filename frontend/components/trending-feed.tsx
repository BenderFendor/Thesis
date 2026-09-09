"use client";
import { hasText } from "@/lib/utils";

import type {
  BreakingCluster,
  BreakingResponse,
  ClusterArticle,
  NewsArticle,
  ReadonlyNewsArticle,
  TrendingCluster,
  TrendingResponse,
} from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { Clock, Heart, MinusCircle, PlusCircle, TrendingUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchBreaking, fetchTrending, mapBackendArticle } from "@/lib/api";
import { filterTrendingClusters, pickClusterImageUrl } from "@/lib/cluster-display";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClusterDetailModal } from "./cluster-detail-modal";
import { SafeImage } from "@/components/safe-image";
import { Skeleton } from "@/components/ui/skeleton";
import { isUsableImage } from "@/lib/article-image";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useQuery } from "@tanstack/react-query";
import { useReadingQueue } from "@/hooks/use-reading-queue";

type ReadonlyBreakingCluster = DeepReadonly<BreakingCluster>;
type ReadonlyClusterArticle = DeepReadonly<ClusterArticle>;
type ReadonlyTrendingCluster = DeepReadonly<TrendingCluster>;
type MousePropagationEvent = Readonly<{ stopPropagation: () => void }>;

const formatTimeAgo = (dateStr?: string | null): string => {
  if (!hasText(dateStr)) {
    return "";
  }
  const date = new Date(dateStr);
  const now = new Date();
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 1) {
    return "Now";
  }
  if (diffHours < 24) {
    return `${diffHours}H`;
  }
  return `${Math.floor(diffHours / 24)}d`;
};

const extractKeyTerms = (title?: string): Set<string> => {
  if (!hasText(title)) {
    return new Set();
  }
  const stopWords = new Set([
      "the",
      "and",
      "for",
      "are",
      "but",
      "not",
      "you",
      "all",
      "can",
      "had",
      "her",
      "was",
      "one",
      "our",
      "out",
      "has",
      "his",
      "how",
      "its",
      "may",
      "new",
      "now",
      "old",
      "see",
      "way",
      "who",
      "did",
      "get",
      "let",
      "put",
      "say",
      "she",
      "too",
      "use",
      "says",
      "said",
      "over",
      "after",
      "into",
      "with",
      "from",
      "that",
      "this",
      "been",
      "have",
      "were",
      "what",
      "when",
      "will",
      "more",
      "some",
      "than",
      "them",
      "then",
      "they",
      "would",
      "about",
      "could",
      "first",
      "other",
      "their",
      "there",
      "these",
      "which",
      "being",
      "member",
      "founding",
      "guitarist",
      "dies",
      "aged",
      "dead",
      "death",
      "years",
      "year",
      "cofounder",
      "founder",
    ]),
    words = title
      .toLowerCase()
      .replaceAll(/[^\w\s]/gu, " ")
      .split(/\s+/u)
      .filter((w) => w.length > 2 && !stopWords.has(w));

  return new Set(words);
};

const deduplicateClusters = function deduplicateClusters<
  T extends {
    representative_article?: { title?: string } | null;
    label?: string | null;
    keywords?: readonly string[];
  },
>(clusters: readonly T[]): T[] {
  const seen: { terms: Set<string>; title: string }[] = [];

  return clusters.filter((cluster) => {
    const title = cluster.representative_article?.title ?? "";
    const label = cluster.label ?? "";
    const keywords = (cluster.keywords ?? []).join(" ");
    const combined = `${title} ${label} ${keywords}`;
    const terms = extractKeyTerms(combined);

    if (terms.size === 0) {
      return true;
    }

    for (const existing of seen) {
      const overlap = countSetOverlap(terms, existing.terms),
        overlapRatio = overlap / Math.min(terms.size, existing.terms.size);

      if (overlap >= 2 && overlapRatio >= 0.4) {
        return false;
      }
    }

    seen.push({ terms, title: combined });
    return true;
  });
};

function countSetOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) {
    if (b.has(word)) {
      count++;
    }
  }
  return count;
}

const trendingArticleToNewsArticle = (
  article: ReadonlyClusterArticle,
  clusterLabel?: string,
): NewsArticle =>
  mapBackendArticle({
    category: "trending",
    country: "US",
    credibility: "medium",
    id: article.id,
    image_url: article.image_url,
    published_at: article.published_at,
    source: article.source,
    summary: article.summary ?? clusterLabel ?? "",
    title: article.title,
    url: article.url,
  });

const TrendingFeed = () => {
  const [selectedCluster, setSelectedCluster] = useState<TrendingCluster | BreakingCluster | null>(
      null,
    );
  const [isBreakingCluster, setIsBreakingCluster] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { likedIds, toggleLike } = useLikedArticles();
  const [trendingWindow, setTrendingWindow] = useState<"1d" | "1w" | "1m">("1d");
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
  const trendingQuery = useQuery<TrendingResponse>({
      queryFn: () => fetchTrending(trendingWindow, 10),
      queryKey: ["trending-feed", trendingWindow, 10],
      refetchInterval: 60_000 * 5,
      retry: 1,
    });
  const breakingQuery = useQuery<BreakingResponse>({
      queryFn: () => fetchBreaking(5),
      queryKey: ["breaking-feed", 5],
      refetchInterval: 60_000 * 5,
      retry: 1,
    });
  const trendingData = trendingQuery.data ?? null;
  const breakingData = breakingQuery.data ?? null;
  const loading = trendingQuery.isLoading || breakingQuery.isLoading;
  const handleClusterClick = useCallback(
      (cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster, isBreaking: boolean) => {
        setSelectedCluster(cluster);
        setIsBreakingCluster(isBreaking);
        setIsModalOpen(true);
      },
      [],
    );
  const handleQueueToggle = useCallback(
      (article: ReadonlyNewsArticle, e: MousePropagationEvent) => {
        e.stopPropagation();
        if (isArticleInQueue(article.url)) {
          void removeArticleFromQueue(article.url);
        } else {
          void addArticleToQueue(article);
        }
      },
      [isArticleInQueue, removeArticleFromQueue, addArticleToQueue],
    );
  const handleLike = useCallback(
      (articleId: number, e: MousePropagationEvent) => {
        e.stopPropagation();
        void toggleLike(articleId);
      },
      [toggleLike],
    );
  const handleModalClose = useCallback(() => {
      setIsModalOpen(false);
      setSelectedCluster(null);
    }, []);

  if (loading && !trendingData) {
    return <TrendingSkeleton />;
  }

  const rawBreaking = breakingData?.clusters ?? [];
  const rawTrending = trendingData?.clusters ?? [];
  const breakingClusters = deduplicateClusters(rawBreaking);
  const trendingClusters = deduplicateClusters(filterTrendingClusters(rawTrending, breakingClusters));

  return (
    <>
      <TrendingFeedContent
        breakingClusters={breakingClusters}
        isInQueue={isArticleInQueue}
        isLiked={likedIds}
        onClusterClick={handleClusterClick}
        onLike={handleLike}
        onQueueToggle={handleQueueToggle}
        onWindowChange={setTrendingWindow}
        trendingClusters={trendingClusters}
        trendingWindow={trendingWindow}
      />

      {/* Cluster Detail Modal */}
      <ClusterDetailModal
        cluster={selectedCluster}
        isBreaking={isBreakingCluster}
        isOpen={isModalOpen}
        onClose={handleModalClose}
      />
    </>
  );
};

interface TrendingFeedContentProps {
  readonly breakingClusters: readonly ReadonlyBreakingCluster[];
  readonly isInQueue: (url: string) => boolean;
  readonly isLiked: ReturnType<typeof useLikedArticles>["likedIds"];
  readonly onClusterClick: (
    cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster,
    isBreaking: boolean,
  ) => void;
  readonly onLike: (articleId: number, event: MousePropagationEvent) => void;
  readonly onQueueToggle: (article: ReadonlyNewsArticle, event: MousePropagationEvent) => void;
  readonly onWindowChange: (window: "1d" | "1w" | "1m") => void;
  readonly trendingClusters: readonly ReadonlyTrendingCluster[];
  readonly trendingWindow: "1d" | "1w" | "1m";
}

const TrendingFeedContent = ({
  breakingClusters,
  isInQueue,
  isLiked,
  onClusterClick,
  onLike,
  onQueueToggle,
  onWindowChange,
  trendingClusters,
  trendingWindow,
}: Readonly<TrendingFeedContentProps>) => (
  <div className="flex flex-col space-y-3 sm:space-y-6">
    <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pb-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
        <TrendingUp className="h-4 w-4 text-primary/80 sm:h-6 sm:w-6" />
        <h3 className="font-serif text-2xl font-bold tracking-tight text-foreground/90 sm:text-4xl md:text-5xl">
          Latest & Trending
        </h3>
        {breakingClusters.length > 0 && (
          <span className="flex items-center gap-1.5 border border-red-500/20 bg-red-500/10 px-2 py-1 text-[8px] font-mono text-red-500 uppercase tracking-widest animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.2)] sm:gap-2 sm:px-3 sm:text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {breakingClusters.length} Breaking
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-3">
        <div className="flex items-center gap-1 rounded-sm bg-white/[0.03] p-1 border border-white/5">
          <Select value={trendingWindow} onValueChange={onWindowChange}>
            <SelectTrigger
              className="h-6 border-none bg-transparent px-2 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/80 focus:ring-0"
              title="Filter by time"
            >
              <SelectValue placeholder="Window" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--card)] border-white/10">
              <SelectItem value="1d" className="text-[9px] font-mono uppercase tracking-widest">
                Last 24h
              </SelectItem>
              <SelectItem value="1w" className="text-[9px] font-mono uppercase tracking-widest">
                Last 7d
              </SelectItem>
              <SelectItem value="1m" className="text-[9px] font-mono uppercase tracking-widest">
                Last 30d
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
          {trendingClusters.length + breakingClusters.length} updates
        </span>
      </div>
    </div>

    <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {breakingClusters.map((cluster) => (
        <BreakingCard
          key={`breaking-${cluster.cluster_id}`}
          cluster={cluster}
          onClusterClick={onClusterClick}
          onQueueToggle={onQueueToggle}
          onLike={onLike}
          isInQueue={isInQueue}
          isLiked={isLiked}
        />
      ))}
      {trendingClusters.map((cluster, index) => (
        <TrendingCard
          key={`trending-${cluster.cluster_id}`}
          cluster={cluster}
          rank={index + 1}
          onClusterClick={onClusterClick}
          onQueueToggle={onQueueToggle}
          onLike={onLike}
          isInQueue={isInQueue}
          isLiked={isLiked}
        />
      ))}
    </div>
  </div>
);

const ClusterCardActions = ({
  article,
  inQueue,
  liked,
  onLike,
  onQueueToggle,
}: Readonly<{
  article: ReadonlyNewsArticle;
  inQueue: boolean;
  liked: boolean;
  onLike: (articleId: number, event: MousePropagationEvent) => void;
  onQueueToggle: (article: ReadonlyNewsArticle, event: MousePropagationEvent) => void;
}>) => {
  const handleLikeClick = useCallback(
      (event: MousePropagationEvent) =>{  onLike(article.id, event); },
      [article.id, onLike],
    ),
    handleQueueClick = useCallback(
      (event: MousePropagationEvent) =>{  onQueueToggle(article, event); },
      [article, onQueueToggle],
    );
  return (
    <div className="pointer-events-auto absolute right-1 top-1 z-20 flex gap-1 opacity-100 transition-opacity sm:right-2 sm:top-2 sm:opacity-0 sm:group-hover:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleQueueClick}
        className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
      >
        {(() => {
  if (inQueue) {
    return <MinusCircle className="w-2.5 h-2.5 text-foreground/70 sm:h-3 sm:w-3" />;
  }
  return <PlusCircle className="w-2.5 h-2.5 text-foreground sm:h-3 sm:w-3" />;
})()}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLikeClick}
        className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
      >
        <Heart
          className={`h-2.5 w-2.5 sm:h-3 sm:w-3 ${
            (() => {
  if (liked) {
    return "fill-current text-foreground";
  }
  return "text-muted-foreground";
})()
          }`}
        />
      </Button>
    </div>
  );
};

const BreakingCard = ({
  cluster,
  onClusterClick,
  onQueueToggle,
  onLike,
  isInQueue,
  isLiked,
}: Readonly<{
  cluster: ReadonlyBreakingCluster;
  onClusterClick: (
    cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster,
    isBreaking: boolean,
  ) => void;
  onQueueToggle: (article: ReadonlyNewsArticle, e: MousePropagationEvent) => void;
  onLike: (articleId: number, e: MousePropagationEvent) => void;
  isInQueue: (url: string) => boolean;
  isLiked: ReadonlySet<number>;
}>) => {
  const article = cluster.representative_article;
  const label = cluster.label ?? cluster.keywords.slice(0, 3).join(" ");
  const imageUrl = pickClusterImageUrl(cluster);
  const showImage = isUsableImage(imageUrl);
  const handleClick = useCallback(() =>{  onClusterClick(cluster, true); }, [cluster, onClusterClick]);

  if (!article) {
    return null;
  }

  const newsArticle = trendingArticleToNewsArticle(article, label);
  const inQueue = isInQueue(article.url);
  const liked = isLiked.has(article.id);

  return (
    <article
      className="group relative flex min-h-48 w-full flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 text-left shadow-xl transition-all duration-500 ease-out hover:bg-white/[0.03] hover:shadow-2xl sm:min-h-0 sm:rounded-lg"
    >
      <button
        type="button"
        aria-label={`Open breaking story: ${article.title || label}`}
        onClick={handleClick}
        className="absolute inset-0 z-0"
      />
      <div className="pointer-events-none absolute top-0 left-0 z-10 h-full w-px bg-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.4)]" />

      <div className="pointer-events-none relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-lg">
        {(() => {
  if (showImage) {
    return <SafeImage src={imageUrl} alt={article.title || label} fill className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105" />;
  }
  return <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.15),transparent_70%)]" />;
})()}

        <ClusterCardActions
          article={newsArticle}
          inQueue={inQueue}
          liked={liked}
          onLike={onLike}
          onQueueToggle={onQueueToggle}
        />

        <div className="pointer-events-none absolute bottom-1 left-1 sm:bottom-2 sm:left-2">
          <span className="bg-red-500 px-1.5 py-0.5 text-xs font-bold tracking-normal text-white shadow-lg sm:font-mono sm:text-[8px] sm:uppercase sm:tracking-[0.18em]">
            Breaking
          </span>
        </div>
      </div>

      <div className="pointer-events-none flex flex-1 flex-col space-y-1.5 p-1.5 sm:space-y-3 sm:p-4">
        <div className="space-y-1 sm:space-y-2">
          <h3 className="line-clamp-4 font-serif text-sm leading-tight text-foreground/90 transition-colors group-hover:text-white sm:text-[15px]">
            {article.title || label}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground/60 tracking-normal sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-wider">
            {cluster.article_count_3h} updates in 3h
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-1.5 sm:pt-3">
          <div className="flex items-center gap-1 text-xs tracking-normal text-muted-foreground/40 sm:gap-1.5 sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest">
            <Clock className="w-3 h-3 opacity-50" />
            <span>{formatTimeAgo(article.published_at)}</span>
          </div>
          <span className="text-red-400/60 text-xs font-bold tracking-normal sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest">
            {cluster.spike_magnitude.toFixed(1)}x spike
          </span>
        </div>
      </div>
    </article>
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
}: Readonly<{
  cluster: ReadonlyTrendingCluster;
  rank: number;
  onClusterClick: (
    cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster,
    isBreaking: boolean,
  ) => void;
  onQueueToggle: (article: ReadonlyNewsArticle, e: MousePropagationEvent) => void;
  onLike: (articleId: number, e: MousePropagationEvent) => void;
  isInQueue: (url: string) => boolean;
  isLiked: ReadonlySet<number>;
}>) => {
  const article = cluster.representative_article;
  const label = cluster.label ?? cluster.keywords.slice(0, 3).join(" ");
  const imageUrl = pickClusterImageUrl(cluster);
  const showImage = isUsableImage(imageUrl);
  const handleClick = useCallback(() =>{  onClusterClick(cluster, false); }, [cluster, onClusterClick]);

  if (!article) {
    return null;
  }

  const newsArticle = trendingArticleToNewsArticle(article, label);
  const inQueue = isInQueue(article.url);
  const liked = isLiked.has(article.id);

  return (
    <article
      className="group relative flex min-h-48 w-full flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 text-left shadow-xl transition-all duration-500 ease-out hover:bg-white/[0.03] hover:shadow-2xl sm:min-h-0 sm:rounded-lg"
    >
      <button
        type="button"
        aria-label={`Open trending story: ${article.title || label}`}
        onClick={handleClick}
        className="absolute inset-0 z-0"
      />
      <div className="pointer-events-none relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-lg">
        {(() => {
  if (showImage) {
    return <SafeImage src={imageUrl} alt={article.title || label} fill className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105" />;
  }
  return <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]" />;
})()}

        <ClusterCardActions
          article={newsArticle}
          inQueue={inQueue}
          liked={liked}
          onLike={onLike}
          onQueueToggle={onQueueToggle}
        />

        <div className="pointer-events-none absolute left-1 top-1 border border-white/10 bg-black/60 px-1 py-0.5 text-xs text-white/80 backdrop-blur-sm sm:left-2 sm:top-2 sm:px-1.5 sm:font-mono sm:text-[9px]">
          #{rank}
        </div>
      </div>

      <div className="pointer-events-none flex flex-1 flex-col space-y-1.5 p-1.5 sm:space-y-3 sm:p-4">
        <div className="space-y-1 sm:space-y-2">
          <h3 className="line-clamp-4 font-serif text-sm leading-tight text-foreground/90 transition-colors group-hover:text-white sm:text-[15px]">
            {article.title || label}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground/60 tracking-normal sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-wider">
            {cluster.source_diversity} sources
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-1.5 sm:pt-3">
          <div className="flex items-center gap-1 text-xs tracking-normal text-muted-foreground/40 sm:gap-1.5 sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest">
            <Clock className="w-3 h-3 opacity-50" />
            <span>{formatTimeAgo(article.published_at)}</span>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground/30 tracking-normal sm:font-mono sm:text-[9px] sm:uppercase sm:tracking-widest">
            {cluster.article_count} stories
          </span>
        </div>
      </div>
    </article>
  );
};

const TrendingSkeleton = () => (
  <div className="flex flex-col space-y-3 sm:space-y-6">
    <div className="flex items-center justify-between border-b border-white/5 pb-3 sm:pb-6">
      <div className="flex items-center gap-4">
        <Skeleton className="w-6 h-6" />
        <Skeleton className="h-8 w-44 sm:h-10 sm:w-64" />
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-white/5 bg-black/20 sm:rounded-lg"
        >
          <div className="m-1.5 sm:m-2">
            <Skeleton className="aspect-[4/3] w-full rounded-md sm:aspect-video sm:rounded-lg" />
          </div>
          <div className="space-y-2 p-2 sm:space-y-3 sm:p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  </div>
);
export { TrendingFeed };
