"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  Zap,
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
import { get_logger } from "@/lib/utils";
import { ClusterDetailModal } from "./cluster-detail-modal";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { useLikedArticles } from "@/hooks/useLikedArticles";

const logger = get_logger("TrendingFeed");

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
        className="flex flex-col space-y-6"
      >
        {/* Section Header */}
        <div className="flex items-center justify-between pb-6">
          <div className="flex items-center gap-4">
            <TrendingUp className="w-6 h-6 text-primary/80" />
            <h3 className="font-serif text-4xl md:text-5xl font-bold tracking-tight text-foreground/90">
              Latest & Trending
            </h3>
            {breakingClusters.length > 0 && (
              <span className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 text-[10px] font-mono text-red-500 uppercase tracking-widest animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {breakingClusters.length} Breaking
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
    <button
      onClick={handleClick}
      className="group relative flex flex-col w-full text-left bg-black/20 rounded-2xl transition-all duration-500 ease-out hover:bg-white/[0.03] shadow-xl hover:shadow-2xl overflow-hidden"
    >
      <div className="absolute top-0 left-0 w-px h-full bg-red-500/40 z-10 shadow-[0_0_20px_rgba(239,68,68,0.4)]" />
      
      <div className="relative m-2 aspect-video overflow-hidden rounded-xl bg-white/5">
        {showImage ? (
          <img
            src={imageUrl!}
            alt={article.title || label}
            className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.15),transparent_70%)]" />
        )}
        
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onQueueToggle(newsArticle, e)}
            className="h-6 w-6 p-0 bg-black/60 hover:bg-black/80"
          >
            {inQueue ? (
              <MinusCircle className="w-3 h-3 text-foreground/70" />
            ) : (
              <PlusCircle className="w-3 h-3 text-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onLike(article.id, e)}
            className="h-6 w-6 p-0 bg-black/60 hover:bg-black/80"
          >
            <Heart
              className={`w-3 h-3 ${
                liked ? "fill-current text-foreground" : "text-muted-foreground"
              }`}
            />
          </Button>
        </div>

        <div className="absolute bottom-2 left-2">
          <span className="px-1.5 py-0.5 bg-red-500 text-[8px] font-mono text-white uppercase tracking-[0.2em] font-bold shadow-lg">
            Breaking
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4 space-y-3">
        <div className="space-y-2">
          <h3 className="font-serif text-[15px] leading-tight text-foreground/90 group-hover:text-white transition-colors line-clamp-3">
            {article.title || label}
          </h3>
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed font-mono uppercase tracking-wider">
            {cluster.article_count_3h} updates in 3H
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40">
            <Clock className="w-3 h-3 opacity-50" />
            <span>{formatTimeAgo(article.published_at)}</span>
          </div>
          <span className="text-red-400/60 text-[9px] font-mono font-bold tracking-widest">
            {cluster.spike_magnitude.toFixed(1)}x SPIKE
          </span>
        </div>
      </div>
    </button>
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
    <button
      onClick={handleClick}
      className="group relative flex flex-col w-full text-left bg-black/20 rounded-2xl transition-all duration-500 ease-out hover:bg-white/[0.03] shadow-xl hover:shadow-2xl overflow-hidden"
    >
      <div className="relative m-2 aspect-video overflow-hidden rounded-xl bg-white/5">
        {showImage ? (
          <img
            src={imageUrl!}
            alt={article.title || label}
            className="w-full h-full object-cover grayscale opacity-80 transition duration-700 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_70%)]" />
        )}
        
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onQueueToggle(newsArticle, e)}
            className="h-6 w-6 p-0 bg-black/60 hover:bg-black/80"
          >
            {inQueue ? (
              <MinusCircle className="w-3 h-3 text-foreground/70" />
            ) : (
              <PlusCircle className="w-3 h-3 text-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => onLike(article.id, e)}
            className="h-6 w-6 p-0 bg-black/60 hover:bg-black/80"
          >
            <Heart
              className={`w-3 h-3 ${
                liked ? "fill-current text-foreground" : "text-muted-foreground"
              }`}
            />
          </Button>
        </div>

        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-mono text-white/80 border border-white/10">
          #{rank}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4 space-y-3">
        <div className="space-y-2">
          <h3 className="font-serif text-[15px] leading-tight text-foreground/90 group-hover:text-white transition-colors line-clamp-3">
            {article.title || label}
          </h3>
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed font-mono uppercase tracking-wider">
            {cluster.source_diversity} Sources
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40">
            <Clock className="w-3 h-3 opacity-50" />
            <span>{formatTimeAgo(article.published_at)}</span>
          </div>
          <span className="text-[9px] font-mono tabular-nums text-muted-foreground/30 uppercase tracking-widest">
            {cluster.article_count} Stories
          </span>
        </div>
      </div>
    </button>
  );
}

function TrendingSkeleton() {
  return (
    <div className="flex flex-col space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-6">
        <div className="flex items-center gap-4">
          <Skeleton className="w-6 h-6" />
          <Skeleton className="h-10 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl border border-white/5 bg-black/20 overflow-hidden">
            <div className="m-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
            </div>
            <div className="p-4 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
