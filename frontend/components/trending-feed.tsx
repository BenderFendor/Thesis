"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SafeImage } from "@/components/safe-image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Clock,
  TrendingUp,
  PlusCircle,
  MinusCircle,
  Heart,
} from "lucide-react";
import {
  fetchTrending,
  fetchBreaking,
  TrendingCluster,
  BreakingCluster,
  TrendingResponse,
  BreakingResponse,
  TrendingArticle,
  NewsArticle,
} from "@/lib/api";
import {
  filterTrendingClusters,
  hasRealClusterImage,
  pickClusterImageUrl,
} from "@/lib/cluster-display";
import { ClusterDetailModal } from "./cluster-detail-modal";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { useLikedArticles } from "@/hooks/useLikedArticles";
import { activateCardFromKeyDown } from "@/lib/keyboard-activation";

function handleCardKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  onActivate: () => void,
) {
  activateCardFromKeyDown(event, onActivate);
}

function hasRealImage(src?: string | null): boolean {
  return hasRealClusterImage(src);
}

function formatTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 1) return "Now";
  if (diffHours < 24) return `${diffHours}H`;
  return `${Math.floor(diffHours / 24)}d`;
}

function extractKeyTerms(title?: string): Set<string> {
  if (!title) return new Set();
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her",
    "was", "one", "our", "out", "has", "his", "how", "its", "may", "new", "now",
    "old", "see", "way", "who", "did", "get", "let", "put", "say", "she", "too",
    "use", "says", "said", "over", "after", "into", "with", "from", "that", "this",
    "been", "have", "were", "what", "when", "will", "more", "some", "than", "them",
    "then", "they", "would", "about", "could", "first", "other", "their", "there",
    "these", "which", "being", "member", "founding", "guitarist", "dies", "aged",
    "dead", "death", "years", "year", "cofounder", "founder",
  ]);
  
  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  return new Set(words);
}

function deduplicateClusters<T extends { representative_article?: { title?: string } | null; label?: string | null; keywords?: string[] }>(
  clusters: T[]
): T[] {
  const seen: Array<{ terms: Set<string>; title: string }> = [];
  
  return clusters.filter(cluster => {
    const title = cluster.representative_article?.title || "";
    const label = cluster.label || "";
    const keywords = (cluster.keywords || []).join(" ");
    
    const combined = `${title} ${label} ${keywords}`;
    const terms = extractKeyTerms(combined);
    
    if (terms.size === 0) return true;
    
    for (const existing of seen) {
      const overlap = countSetOverlap(terms, existing.terms);
      const overlapRatio = overlap / Math.min(terms.size, existing.terms.size);
      
      if (overlap >= 2 && overlapRatio >= 0.4) {
        return false;
      }
    }
    
    seen.push({ terms, title: combined });
    return true;
  });
}

function countSetOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) {
    if (b.has(word)) count++;
  }
  return count;
}

function trendingArticleToNewsArticle(article: TrendingArticle, clusterLabel?: string): NewsArticle {
  return {
    id: article.id,
    title: article.title,
    source: article.source,
    sourceId: article.source.toLowerCase().replace(/\s+/g, "-"),
    country: "US",
    credibility: "medium" as const,
    bias: "center" as const,
    summary: article.summary || clusterLabel || "",
    image: article.image_url || "",
    publishedAt: article.published_at || new Date().toISOString(),
    category: "trending",
    url: article.url,
    tags: [],
    originalLanguage: "en",
    translated: false,
  };
}

export function TrendingFeed() {
  const [selectedCluster, setSelectedCluster] = useState<TrendingCluster | BreakingCluster | null>(null);
  const [isBreakingCluster, setIsBreakingCluster] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { likedIds, toggleLike } = useLikedArticles();
  const [trendingWindow, setTrendingWindow] = useState<"1d" | "1w" | "1m">("1d");
  
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();

  const trendingQuery = useQuery<TrendingResponse>({
    queryKey: ["trending-feed", trendingWindow, 10],
    queryFn: () => fetchTrending(trendingWindow, 10),
    retry: 1,
    refetchInterval: 60000 * 5,
  });
  const breakingQuery = useQuery<BreakingResponse>({
    queryKey: ["breaking-feed", 5],
    queryFn: () => fetchBreaking(5),
    retry: 1,
    refetchInterval: 60000 * 5,
  });
  const trendingData = trendingQuery.data ?? null;
  const breakingData = breakingQuery.data ?? null;
  const loading = trendingQuery.isLoading || breakingQuery.isLoading;

  const handleClusterClick = useCallback((cluster: TrendingCluster | BreakingCluster, isBreaking: boolean) => {
    setSelectedCluster(cluster);
    setIsBreakingCluster(isBreaking);
    setIsModalOpen(true);
  }, []);

  const handleQueueToggle = useCallback(
    (article: NewsArticle, e: React.MouseEvent) => {
      e.stopPropagation();
      if (isArticleInQueue(article.url)) {
        removeArticleFromQueue(article.url);
      } else {
        addArticleToQueue(article);
      }
    },
    [isArticleInQueue, removeArticleFromQueue, addArticleToQueue]
  );

  const handleLike = useCallback((articleId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleLike(articleId);
  }, [toggleLike]);

  if (loading && !trendingData) {
    return <TrendingSkeleton />;
  }

  const rawBreaking = breakingData?.clusters || [];
  const rawTrending = trendingData?.clusters || [];
  
  const breakingClusters = deduplicateClusters(rawBreaking);
  const trendingClusters = deduplicateClusters(
    filterTrendingClusters(rawTrending, breakingClusters)
  );

  return (
    <>
      <div 
        className="flex flex-col space-y-3 sm:space-y-6"
      >
        {/* Section Header */}
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
              <Select value={trendingWindow} onValueChange={(value) => setTrendingWindow(value as "1d" | "1w" | "1m")}>
                <SelectTrigger
                  className="h-6 border-none bg-transparent px-2 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/80 focus:ring-0"
                  title="Filter by time"
                >
                  <SelectValue placeholder="Window" />
                </SelectTrigger>
                <SelectContent className="bg-[#0a0a0a] border-white/10">
                  <SelectItem value="1d" className="text-[9px] font-mono uppercase tracking-widest">Last 24h</SelectItem>
                  <SelectItem value="1w" className="text-[9px] font-mono uppercase tracking-widest">Last 7d</SelectItem>
                  <SelectItem value="1m" className="text-[9px] font-mono uppercase tracking-widest">Last 30d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
              {trendingClusters.length + breakingClusters.length} updates
            </span>
          </div>
        </div>

        {/* Vertical Grid */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {/* Breaking stories first */}
          {breakingClusters.map((cluster) => (
            <BreakingCard
              key={`breaking-${cluster.cluster_id}`}
              cluster={cluster}
              onClusterClick={handleClusterClick}
              onQueueToggle={handleQueueToggle}
              onLike={handleLike}
              isInQueue={isArticleInQueue}
              isLiked={likedIds}
            />
          ))}
          {/* Then trending stories */}
          {trendingClusters.map((cluster, idx) => (
            <TrendingCard
              key={`trending-${cluster.cluster_id}`}
              cluster={cluster}
              rank={idx + 1}
              onClusterClick={handleClusterClick}
              onQueueToggle={handleQueueToggle}
              onLike={handleLike}
              isInQueue={isArticleInQueue}
              isLiked={likedIds}
            />
          ))}
        </div>
      </div>

      {/* Cluster Detail Modal */}
      <ClusterDetailModal
        cluster={selectedCluster}
        isBreaking={isBreakingCluster}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCluster(null);
        }}
      />
    </>
  );
}

function BreakingCard({
  cluster,
  onClusterClick,
  onQueueToggle,
  onLike,
  isInQueue,
  isLiked,
}: {
  cluster: BreakingCluster;
  onClusterClick: (cluster: TrendingCluster | BreakingCluster, isBreaking: boolean) => void;
  onQueueToggle: (article: NewsArticle, e: React.MouseEvent) => void;
  onLike: (articleId: number, e: React.MouseEvent) => void;
  isInQueue: (url: string) => boolean;
  isLiked: Set<number>;
}) {
  const article = cluster.representative_article;
  const label = cluster.label || cluster.keywords.slice(0, 3).join(" ");
  const imageUrl = pickClusterImageUrl(cluster);
  const showImage = hasRealImage(imageUrl);

  if (!article) return null;

  const newsArticle = trendingArticleToNewsArticle(article, label);
  const inQueue = isInQueue(article.url);
  const liked = isLiked.has(article.id);

  const handleClick = () => {
    onClusterClick(cluster, true);
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => handleCardKeyDown(event, handleClick)}
      className="group relative flex min-h-48 w-full flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 text-left shadow-xl transition-all duration-500 ease-out hover:bg-white/[0.03] hover:shadow-2xl sm:min-h-0 sm:rounded-2xl"
    >
      <div className="absolute top-0 left-0 w-px h-full bg-red-500/40 z-10 shadow-[0_0_20px_rgba(239,68,68,0.4)]" />
      
      <div className="relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-xl">
        {showImage ? (
          <SafeImage
            src={imageUrl!}
            alt={article.title || label}
            fill
            className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.15),transparent_70%)]" />
        )}
        
        <div className="absolute right-1 top-1 flex gap-1 opacity-100 transition-opacity sm:right-2 sm:top-2 sm:opacity-0 sm:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onQueueToggle(newsArticle, e)}
            className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
          >
            {inQueue ? (
              <MinusCircle className="w-2.5 h-2.5 text-foreground/70 sm:h-3 sm:w-3" />
            ) : (
              <PlusCircle className="w-2.5 h-2.5 text-foreground sm:h-3 sm:w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onLike(article.id, e)}
            className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
          >
            <Heart
              className={`h-2.5 w-2.5 sm:h-3 sm:w-3 ${
                liked ? "fill-current text-foreground" : "text-muted-foreground"
              }`}
            />
          </Button>
        </div>

        <div className="absolute bottom-1 left-1 sm:bottom-2 sm:left-2">
          <span className="bg-red-500 px-1.5 py-0.5 text-xs font-bold tracking-normal text-white shadow-lg sm:font-mono sm:text-[8px] sm:uppercase sm:tracking-[0.18em]">
            Breaking
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col space-y-1.5 p-1.5 sm:space-y-3 sm:p-4">
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
}

function TrendingCard({
  cluster,
  rank,
  onClusterClick,
  onQueueToggle,
  onLike,
  isInQueue,
  isLiked,
}: {
  cluster: TrendingCluster;
  rank: number;
  onClusterClick: (cluster: TrendingCluster | BreakingCluster, isBreaking: boolean) => void;
  onQueueToggle: (article: NewsArticle, e: React.MouseEvent) => void;
  onLike: (articleId: number, e: React.MouseEvent) => void;
  isInQueue: (url: string) => boolean;
  isLiked: Set<number>;
}) {
  const article = cluster.representative_article;
  const label = cluster.label || cluster.keywords.slice(0, 3).join(" ");
  const imageUrl = pickClusterImageUrl(cluster);
  const showImage = hasRealImage(imageUrl);

  if (!article) return null;

  const newsArticle = trendingArticleToNewsArticle(article, label);
  const inQueue = isInQueue(article.url);
  const liked = isLiked.has(article.id);

  const handleClick = () => {
    onClusterClick(cluster, false);
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => handleCardKeyDown(event, handleClick)}
      className="group relative flex min-h-48 w-full flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 text-left shadow-xl transition-all duration-500 ease-out hover:bg-white/[0.03] hover:shadow-2xl sm:min-h-0 sm:rounded-2xl"
    >
      <div className="relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-xl">
        {showImage ? (
          <SafeImage
            src={imageUrl!}
            alt={article.title || label}
            fill
            className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]" />
        )}
        
        <div className="absolute right-1 top-1 flex gap-1 opacity-100 transition-opacity sm:right-2 sm:top-2 sm:opacity-0 sm:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onQueueToggle(newsArticle, e)}
            className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
          >
            {inQueue ? (
              <MinusCircle className="w-2.5 h-2.5 text-foreground/70 sm:h-3 sm:w-3" />
            ) : (
              <PlusCircle className="w-2.5 h-2.5 text-foreground sm:h-3 sm:w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onLike(article.id, e)}
            className="h-5 w-5 p-0 bg-black/60 hover:bg-black/80 sm:h-6 sm:w-6"
          >
            <Heart
              className={`h-2.5 w-2.5 sm:h-3 sm:w-3 ${
                liked ? "fill-current text-foreground" : "text-muted-foreground"
              }`}
            />
          </Button>
        </div>

        <div className="absolute left-1 top-1 border border-white/10 bg-black/60 px-1 py-0.5 text-xs text-white/80 backdrop-blur-sm sm:left-2 sm:top-2 sm:px-1.5 sm:font-mono sm:text-[9px]">
          #{rank}
        </div>
      </div>

      <div className="flex flex-1 flex-col space-y-1.5 p-1.5 sm:space-y-3 sm:p-4">
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
}

function TrendingSkeleton() {
  return (
    <div className="flex flex-col space-y-3 sm:space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-3 sm:pb-6">
        <div className="flex items-center gap-4">
          <Skeleton className="w-6 h-6" />
          <Skeleton className="h-8 w-44 sm:h-10 sm:w-64" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-white/5 bg-black/20 sm:rounded-2xl">
            <div className="m-1.5 sm:m-2">
              <Skeleton className="aspect-[4/3] w-full rounded-md sm:aspect-video sm:rounded-xl" />
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
}
