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

function formatTimeAgo(dateStr?: string): string {
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

  if (breakingClusters.length === 0 && trendingClusters.length === 0) {
    return null;
  }

  return (
    <>
      <div 
        className="bg-black/20 hover:bg-white/[0.02] transition-colors duration-500 border border-white/5 rounded-2xl overflow-hidden snap-start scroll-mt-6"
        style={{ scrollSnapStop: "normal" }}
      >
        {/* Section Header */}
        <div className="bg-white/[0.02] px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-primary" />
            <span className="font-serif text-lg font-bold tracking-tight">
              Trending & Breaking
            </span>
            {breakingClusters.length > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0 h-4 animate-pulse">
                {breakingClusters.length} BREAKING
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Select value={trendingWindow} onValueChange={(value) => setTrendingWindow(value as "1d" | "1w" | "1m")}>
              <SelectTrigger
                className="h-8 px-2 text-xs bg-background border border-border rounded-none"
                title="Trending window"
              >
                <SelectValue placeholder="Window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Last 24h</SelectItem>
                <SelectItem value="1w">Last 7d</SelectItem>
                <SelectItem value="1m">Last 30d</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {trendingClusters.length + breakingClusters.length} stories
            </span>
          </div>
        </div>

        {/* Vertical Grid */}
        <div className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
    <div
      onClick={handleClick}
      className="group w-full text-left transition-all duration-500 ease-out cursor-pointer hover:-translate-y-1"
    >
      <Card className="h-full overflow-hidden flex flex-col border border-white/5 bg-black/20 transition-all duration-500 group-hover:bg-white/[0.03] group-hover:border-red-500/30 rounded-2xl shadow-lg hover:shadow-xl relative">
        {/* Red accent for breaking */}
        <div className="absolute top-0 left-0 w-1 h-full bg-red-500/80 z-10" />
        
        {/* Image or fallback */}
        <div className="relative aspect-video overflow-hidden bg-white/5 m-2 rounded-xl flex-shrink-0">
          {showImage ? (
            <>
              <img
                src={imageUrl!}
                alt={article.title || label}
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-muted/20 to-background" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent_60%)]" />
              <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center">
                <Zap className="w-8 h-8 text-red-500/40 mb-2" />
                <h3 className="text-lg md:text-xl font-bold text-foreground/90 leading-snug line-clamp-4 font-serif tracking-tight drop-shadow-sm">
                  {article.title || label}
                </h3>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="absolute top-1 right-1 flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => onQueueToggle(newsArticle, e)}
              className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
              title={inQueue ? "Remove from queue" : "Add to queue"}
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
              className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
              title={liked ? "Unlike" : "Like"}
            >
              <Heart
                className={`w-3 h-3 ${
                  liked ? "fill-current text-foreground" : "text-muted-foreground"
                }`}
              />
            </Button>
          </div>

          {/* Breaking Badge */}
          <div className="absolute bottom-2 left-2">
            <Badge
              variant="destructive"
              className="text-xs font-semibold px-1.5 py-0 uppercase tracking-widest"
            >
              BREAKING
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardContent className="flex-1 flex flex-col p-6">
          {showImage && (
            <>
              <h3 className="text-base font-bold text-foreground leading-snug line-clamp-3 mb-2 font-serif">
                {article.title || label}
              </h3>
              <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2 mb-3">
                {cluster.article_count_3h} articles in the last 3 hours
              </p>
            </>
          )}

          {!showImage && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-4 mb-2 mt-1">
              {cluster.article_count_3h} articles covering this story in the last 3 hours. {cluster.spike_magnitude.toFixed(1)}x above normal volume.
            </p>
          )}

          {/* Meta Info */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-auto pt-3 border-t border-border">
            <Clock className="w-3 h-3" />
            <span>{formatTimeAgo(article.published_at)}</span>
            <span className="ml-auto text-red-400 text-xs font-mono">
              {cluster.spike_magnitude.toFixed(1)}x spike
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
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
    <div
      onClick={handleClick}
      className="group w-full text-left transition-all duration-500 ease-out cursor-pointer hover:-translate-y-1"
    >
      <Card className="h-full overflow-hidden flex flex-col border border-white/5 bg-black/20 transition-all duration-500 group-hover:bg-white/[0.03] group-hover:border-primary/30 rounded-2xl shadow-lg hover:shadow-xl">
        {/* Image or fallback */}
        <div className="relative aspect-video overflow-hidden bg-white/5 m-2 rounded-xl flex-shrink-0">
          {showImage ? (
            <>
              <img
                src={imageUrl!}
                alt={article.title || label}
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-muted/20 to-background" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent_60%)]" />
              <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center">
                <TrendingUp className="w-8 h-8 text-white/20 mb-2" />
                <h3 className="text-lg md:text-xl font-bold text-foreground/90 leading-snug line-clamp-4 font-serif tracking-tight drop-shadow-sm">
                  {article.title || label}
                </h3>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="absolute top-1 right-1 flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => onQueueToggle(newsArticle, e)}
              className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
              title={inQueue ? "Remove from queue" : "Add to queue"}
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
              className="h-6 w-6 p-0 bg-black/50 hover:bg-black/70"
              title={liked ? "Unlike" : "Like"}
            >
              <Heart
                className={`w-3 h-3 ${
                  liked ? "fill-current text-foreground" : "text-muted-foreground"
                }`}
              />
            </Button>
          </div>

          {/* Rank Badge */}
          <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-0.5 text-xs font-mono text-white border border-border">
            #{rank}
          </div>

          {/* Category Badge */}
          <div className="absolute bottom-2 left-2">
            <Badge
              variant="outline"
              className="text-xs font-semibold px-1.5 py-0 bg-black/70 text-foreground border-white/20 uppercase tracking-widest"
            >
              TRENDING
            </Badge>
          </div>
        </div>

        {/* Content */}
        <CardContent className="flex-1 flex flex-col p-6">
          {showImage && (
            <>
              <h3 className="text-base font-bold text-foreground leading-snug line-clamp-3 mb-2 font-serif">
                {article.title || label}
              </h3>
              <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2 mb-3">
                {cluster.article_count} articles from {cluster.source_diversity} sources
              </p>
            </>
          )}

          {!showImage && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-4 mb-2 mt-1">
              {cluster.article_count} articles covering this topic from {cluster.source_diversity} different sources.
            </p>
          )}

          {/* Meta Info */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-auto pt-3 border-t border-border">
            <Clock className="w-3 h-3" />
            <span>{formatTimeAgo(article.published_at)}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {cluster.source_diversity} sources
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div className="bg-card border border-border overflow-hidden">
      <div className="bg-background px-5 py-4 border-b border-border flex items-center gap-3">
        <Skeleton className="w-5 h-5" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="border border-border">
              <div className="aspect-video bg-white/5" />
              <div className="p-4 space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
