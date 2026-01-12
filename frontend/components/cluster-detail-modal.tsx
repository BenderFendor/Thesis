"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  X,
  ExternalLink,
  Loader2,
  TrendingUp,
  Zap,
  Clock,
  Newspaper,
  PlusCircle,
  MinusCircle,
  Heart,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchClusterDetail,
  ClusterDetail,
  TrendingCluster,
  BreakingCluster,
  NewsArticle,
  API_BASE_URL,
} from "@/lib/api";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { ArticleContent } from "@/components/article-content";
import { toast } from "sonner";

interface ClusterArticle {
  id: number;
  title: string;
  source: string;
  url: string;
  image_url?: string;
  published_at?: string;
  similarity: number;
}

interface ClusterDetailModalProps {
  cluster: (TrendingCluster | BreakingCluster) | null;
  isBreaking: boolean;
  isOpen: boolean;
  onClose: () => void;
}

const fullArticleCache = new Map<string, string | null>();

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hasRealImage(src?: string | null): boolean {
  if (!src) return false;
  const trimmed = src.trim();
  if (!trimmed || trimmed === "none") return false;
  const lower = trimmed.toLowerCase();
  return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg");
}

export function ClusterDetailModal({
  cluster,
  isBreaking,
  isOpen,
  onClose,
}: ClusterDetailModalProps) {
  const [clusterDetail, setClusterDetail] = useState<ClusterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [articleContents, setArticleContents] = useState<Map<number, string | null>>(new Map());
  const [loadingArticle, setLoadingArticle] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set());
  const [comparisonMode, setComparisonMode] = useState(false);
  const articleContentRef = useRef<HTMLDivElement>(null);

  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();

  useEffect(() => {
    if (!isOpen || !cluster) {
      setClusterDetail(null);
      setActiveArticleId(null);
      setArticleContents(new Map());
      return;
    }

    const loadClusterDetail = async () => {
      setLoading(true);
      try {
        const detail = await fetchClusterDetail(cluster.cluster_id);
        setClusterDetail(detail);
        if (detail.articles.length > 0) {
          setActiveArticleId(detail.articles[0].id.toString());
        }
      } catch (err) {
        console.error("Failed to load cluster detail:", err);
      } finally {
        setLoading(false);
      }
    };

    loadClusterDetail();
  }, [isOpen, cluster?.cluster_id]);

  const loadArticleContent = useCallback(async (article: ClusterArticle) => {
    const cached = fullArticleCache.get(article.url);
    if (cached !== undefined) {
      setArticleContents((prev) => new Map(prev).set(article.id, cached));
      return;
    }

    setLoadingArticle(article.id);
    try {
      const response = await fetch(
        `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`
      );
      if (response.ok) {
        const data = await response.json();
        const text = data.text || data.full_text || null;
        fullArticleCache.set(article.url, text);
        setArticleContents((prev) => new Map(prev).set(article.id, text));
      }
    } catch (err) {
      console.error("Failed to extract article:", err);
    } finally {
      setLoadingArticle(null);
    }
  }, []);

  useEffect(() => {
    if (!activeArticleId || !clusterDetail) return;
    const article = clusterDetail.articles.find((a) => a.id.toString() === activeArticleId);
    if (article && !articleContents.has(article.id)) {
      loadArticleContent(article);
    }
  }, [activeArticleId, clusterDetail, articleContents, loadArticleContent]);

  const handleLike = useCallback((articleId: number) => {
    setLikedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  }, []);

  const handleQueueToggle = useCallback(
    (article: ClusterArticle) => {
      const newsArticle: NewsArticle = {
        id: article.id,
        title: article.title,
        source: article.source,
        sourceId: article.source.toLowerCase().replace(/\s+/g, "-"),
        country: "US",
        credibility: "medium",
        bias: "center",
        summary: "",
        image: article.image_url || "",
        publishedAt: article.published_at || new Date().toISOString(),
        category: "trending",
        url: article.url,
        tags: [],
        originalLanguage: "en",
        translated: false,
      };

      if (isArticleInQueue(article.url)) {
        removeArticleFromQueue(article.url);
      } else {
        addArticleToQueue(newsArticle);
      }
    },
    [isArticleInQueue, removeArticleFromQueue, addArticleToQueue]
  );



  if (!isOpen || !cluster) return null;

  const activeArticle = clusterDetail?.articles.find(
    (a) => a.id.toString() === activeArticleId
  );
  const activeContent = activeArticle ? articleContents.get(activeArticle.id) : null;
  const label = cluster.label || cluster.keywords.slice(0, 3).join(", ");
  const breakingCluster = cluster as BreakingCluster;
  const trendingCluster = cluster as TrendingCluster;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200">
      <div
        className={`bg-[var(--news-bg-primary)] border border-border/60 rounded-xl shadow-2xl shadow-black/40 transition-all duration-300 animate-in zoom-in-95 fade-in-0 duration-200 flex flex-col ${
          isExpanded
            ? "w-full h-full max-w-none max-h-none"
            : "max-w-5xl w-full max-h-[90vh]"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            {isBreaking ? (
              <Zap className="w-5 h-5 text-red-500" />
            ) : (
              <TrendingUp className="w-5 h-5 text-primary" />
            )}
            <div>
              <h2 className="font-serif text-xl font-bold">{label}</h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                {isBreaking ? (
                  <>
                    <Badge variant="destructive" className="text-[9px]">
                      BREAKING
                    </Badge>
                    <span>{breakingCluster.article_count_3h} articles in 3h</span>
                    <span>|</span>
                    <span>{breakingCluster.spike_magnitude?.toFixed(1)}x spike</span>
                  </>
                ) : (
                  <>
                    <Badge variant="outline" className="text-[9px]">
                      TRENDING
                    </Badge>
                    <span>{trendingCluster.article_count} articles</span>
                    <span>|</span>
                    <span>{trendingCluster.source_diversity} sources</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="bg-[var(--news-bg-secondary)]/70 hover:bg-[var(--news-bg-secondary)] border border-border/60"
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="bg-[var(--news-bg-secondary)]/70 hover:bg-[var(--news-bg-secondary)] border border-border/60"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Loading sources...</span>
            </div>
          ) : clusterDetail && clusterDetail.articles.length > 0 ? (
            <Tabs
              value={activeArticleId || ""}
              onValueChange={setActiveArticleId}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Source Tabs */}
              <div className="border-b border-border/60 px-4 flex-shrink-0 overflow-x-auto">
                <TabsList className="h-auto p-1 bg-transparent gap-1">
                  {clusterDetail.articles.map((article) => (
                    <TabsTrigger
                      key={article.id}
                      value={article.id.toString()}
                      className="data-[state=active]:bg-[var(--news-bg-secondary)] data-[state=active]:border-primary/40 border border-transparent px-4 py-2 text-xs font-medium"
                    >
                      <Newspaper className="w-3 h-3 mr-2" />
                      {article.source}
                    </TabsTrigger>
                  ))}
                  <TabsTrigger
                    value="compare"
                    className="data-[state=active]:bg-[var(--news-bg-secondary)] data-[state=active]:border-primary/40 border border-transparent px-4 py-2 text-xs font-medium"
                    onClick={() => setComparisonMode(true)}
                  >
                    <span className="mr-2">⚖️</span>
                    Compare Sources
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Article Content */}
              {clusterDetail.articles.map((article) => (
                <TabsContent
                  key={article.id}
                  value={article.id.toString()}
                  className="flex-1 overflow-y-auto m-0 p-0"
                >
                  <div className="p-6 space-y-6">
                    {/* Article Header */}
                    <div>
                      {hasRealImage(article.image_url) && (
                        <div className="relative aspect-video max-h-[300px] overflow-hidden rounded-lg mb-6">
                          <img
                            src={article.image_url!}
                            alt={article.title}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        </div>
                      )}
                      <h3 className="font-serif text-2xl font-bold mb-3">
                        {article.title}
                      </h3>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Link
                          href={`/source/${encodeURIComponent(
                            article.source.toLowerCase().replace(/\s+/g, "-")
                          )}`}
                          className="font-medium hover:text-primary transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                          }}
                        >
                          {article.source}
                        </Link>
                        <span>|</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(article.published_at)}
                        </span>
                        <Badge variant="outline" className="text-[9px]">
                          {Math.round(article.similarity * 100)}% match
                        </Badge>
                      </div>
                    </div>

                    {/* Article Body */}
                    <div
                      ref={articleContentRef}
                      className="prose prose-invert max-w-none"
                    >
                      {loadingArticle === article.id ? (
                        <div className="flex items-center gap-3 p-6 bg-[var(--news-bg-secondary)]/60 rounded-lg border border-border/60">
                          <Loader2 className="w-5 h-5 animate-spin text-primary" />
                          <span className="text-muted-foreground">
                            Loading full article...
                          </span>
                        </div>
                      ) : (
                        <ArticleContent
                          content={activeContent || "Loading article content..."}
                          highlights={[]}
                          className="text-base space-y-4"
                        />
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-6 border-t border-border/60">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleLike(article.id)}
                          className={
                            likedArticles.has(article.id)
                              ? "text-red-400"
                              : "text-gray-400"
                          }
                        >
                          <Heart
                            className={`h-4 w-4 mr-2 ${
                              likedArticles.has(article.id) ? "fill-current" : ""
                            }`}
                          />
                          Like
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleQueueToggle(article)}
                          className={
                            isArticleInQueue(article.url)
                              ? "text-blue-400"
                              : "text-gray-400"
                          }
                        >
                          {isArticleInQueue(article.url) ? (
                            <MinusCircle className="h-4 w-4 mr-2" />
                          ) : (
                            <PlusCircle className="h-4 w-4 mr-2" />
                          )}
                          {isArticleInQueue(article.url) ? "Remove" : "Add to Queue"}
                        </Button>

                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Read Original
                        </a>
                      </Button>
                     </div>
                   </div>
                 </TabsContent>
               ))}

              {/* Compare Sources Tab */}
              <TabsContent value="compare" className="flex-1 overflow-y-auto m-0 p-0">
                {comparisonMode && clusterDetail.articles.length >= 2 ? (
                  <div className="p-6 space-y-6">
                    {/* Comparison Header */}
                    <div className="text-center mb-6">
                      <h3 className="font-serif text-2xl font-bold mb-2">
                        Compare: {clusterDetail.articles[0].source} vs {clusterDetail.articles[1].source}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        How different sources report the same story
                      </p>
                    </div>

                    {/* Side-by-side comparison */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {clusterDetail.articles.slice(0, 2).map((article, idx) => {
                        const content = articleContents.get(article.id);
                        return (
                          <div key={article.id} className="space-y-4">
                            {/* Article Header */}
                            <div>
                              {hasRealImage(article.image_url) && (
                                <div className="relative aspect-video max-h-[200px] overflow-hidden rounded-lg mb-4">
                                  <img
                                    src={article.image_url}
                                    alt={article.title}
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                </div>
                              )}
                              <h4 className="font-serif text-lg font-bold">
                                {article.source}
                              </h4>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                {formatDate(article.published_at)}
                                <Badge variant="outline" className="text-[9px]">
                                  {Math.round(article.similarity * 100)}% match
                                </Badge>
                              </div>
                            </div>

                            {/* Content Preview */}
                            <div>
                              <h5 className="font-bold mb-2">{article.title}</h5>
                              {loadingArticle === article.id ? (
                                <div className="flex items-center gap-2 p-4 bg-[var(--news-bg-secondary)]/60 rounded-lg border border-border/60">
                                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                  <span className="text-muted-foreground">Loading...</span>
                                </div>
                              ) : content ? (
                                <div className="prose prose-invert max-w-none text-sm">
                                  <ArticleContent
                                    content={content}
                                    highlights={[]}
                                    className="line-clamp-10"
                                  />
                                </div>
                              ) : (
                                <div className="text-sm text-muted-foreground">
                                  No content available
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                className="text-xs"
                              >
                                <a
                                  href={article.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  Original
                                </a>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Comparison Summary */}
                    <div className="mt-6 pt-6 border-t border-border/60">
                      <h4 className="font-bold mb-4">Comparison Summary</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        {clusterDetail.articles.slice(0, 2).map((article, idx) => {
                          const content = articleContents.get(article.id);
                          const wordCount = content ? content.split(/\s+/).length : 0;
                          return (
                            <div key={article.id} className="bg-[var(--news-bg-secondary)] p-4 rounded-lg border border-border/60">
                              <div className="font-bold mb-2">{article.source}</div>
                              <div className="space-y-1 text-muted-foreground">
                                <div>Word count: {wordCount}</div>
                                <div>Published: {formatDate(article.published_at)}</div>
                                <div>Similarity: {Math.round(article.similarity * 100)}%</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    {clusterDetail.articles.length < 2
                      ? "Need at least 2 sources to compare"
                      : "Loading comparison..."}
                  </div>
                )}
              </TabsContent>
             </Tabs>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              No articles found for this cluster.
            </div>
          )}
        </div>

        {/* Keywords Footer */}
        {cluster.keywords.length > 0 && (
          <div className="border-t border-border/60 px-4 py-3 flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Keywords:</span>
              {cluster.keywords.slice(0, 8).map((keyword) => (
                <Badge
                  key={keyword}
                  variant="outline"
                  className="text-[10px] bg-[var(--news-bg-secondary)]"
                >
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
