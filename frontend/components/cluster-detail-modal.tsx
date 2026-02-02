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

interface ComparisonData {
  similarity: {
    content_similarity: number;
    title_similarity: number;
    overall_match_percent: number;
  };
  entities: {
    source_1: {
      persons: string[];
      organizations: string[];
      locations: string[];
      dates: string[];
    };
    source_2: {
      persons: string[];
      organizations: string[];
      locations: string[];
      dates: string[];
    };
    comparison: {
      common_entities: {
        persons: string[];
        organizations: string[];
        locations: string[];
        dates: string[];
      };
      unique_to_source_1: {
        persons: string[];
        organizations: string[];
        locations: string[];
        dates: string[];
      };
      unique_to_source_2: {
        persons: string[];
        organizations: string[];
        locations: string[];
        dates: string[];
      };
    };
  };
  keywords: {
    source_1_top: Array<{ word: string; count: number }>;
    source_2_top: Array<{ word: string; count: number }>;
    comparison: {
      common_keywords: Array<{
        keyword: string;
        source_1_freq: number;
        source_2_freq: number;
        difference: number;
        emphasis: string;
      }>;
      unique_to_source_1: Array<{ keyword: string; frequency: number }>;
      unique_to_source_2: Array<{ keyword: string; frequency: number }>;
    };
  };
  diff: {
    added: Array<{ index: number; text: string; type: string }>;
    removed: Array<{ index: number; text: string; type: string }>;
    similar: Array<{
      source_1_index: number;
      source_2_index: number;
      source_1_text: string;
      source_2_text: string;
      similarity: number;
    }>;
  };
  summary: {
    common_entities_count: number;
    unique_entities_source_1: number;
    unique_entities_source_2: number;
    common_keywords_count: number;
    unique_keywords_source_1: number;
    unique_keywords_source_2: number;
  };
}

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
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [selectedArticlesForComparison, setSelectedArticlesForComparison] = useState<number[]>([]);
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

  const loadComparisonData = useCallback(async (articleIds: number[]) => {
    if (articleIds.length < 2 || !clusterDetail) return;
    
    setComparisonLoading(true);
    try {
      const articles = clusterDetail.articles.filter(a => articleIds.includes(a.id));
      if (articles.length < 2) return;

      // Load content for both articles if not already loaded
      for (const article of articles) {
        if (!articleContents.has(article.id)) {
          await loadArticleContent(article);
        }
      }

      const content1 = articleContents.get(articles[0].id) || "";
      const content2 = articleContents.get(articles[1].id) || "";

      const response = await fetch(`${API_BASE_URL}/compare/articles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_1: content1,
          content_2: content2,
          title_1: articles[0].title,
          title_2: articles[1].title,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setComparisonData(data);
      }
    } catch (err) {
      console.error("Failed to load comparison:", err);
    } finally {
      setComparisonLoading(false);
    }
  }, [clusterDetail, articleContents, loadArticleContent]);

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
                    onClick={() => {
                      setComparisonMode(true);
                      if (clusterDetail && clusterDetail.articles.length >= 2 && selectedArticlesForComparison.length === 0) {
                        // Auto-select first two articles
                        const firstTwo = clusterDetail.articles.slice(0, 2).map(a => a.id);
                        setSelectedArticlesForComparison(firstTwo);
                        loadComparisonData(firstTwo);
                      }
                    }}
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
                          {/* Source Badge */}
                          <div className="absolute top-3 left-3">
                            <Badge
                              variant="outline"
                              className="text-[10px] font-semibold px-2 py-0.5 bg-black/70 text-white border-white/30 uppercase tracking-wider"
                            >
                              {article.source}
                            </Badge>
                          </div>
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
                      {comparisonData && (
                        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-[var(--news-bg-secondary)] rounded-full text-xs">
                          <span>Content Similarity:</span>
                          <span className={`font-bold ${comparisonData.similarity.overall_match_percent > 70 ? 'text-green-400' : comparisonData.similarity.overall_match_percent > 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {comparisonData.similarity.overall_match_percent}%
                          </span>
                        </div>
                      )}
                    </div>

                    {comparisonLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="ml-3 text-muted-foreground">Analyzing articles...</span>
                      </div>
                    ) : comparisonData ? (
                      <>
                        {/* Entity Extraction Comparison */}
                        <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
                          <h4 className="font-bold mb-4 flex items-center gap-2">
                            <span>Named Entities</span>
                            <Badge variant="outline" className="text-[10px]">
                              {comparisonData.summary.common_entities_count} shared
                            </Badge>
                          </h4>
                          
                          {/* Common Entities */}
                          {comparisonData.entities.comparison.common_entities.persons.length > 0 && (
                            <div className="mb-3">
                              <span className="text-xs text-muted-foreground">Common People:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {comparisonData.entities.comparison.common_entities.persons.map((person, idx) => (
                                  <Badge key={idx} className="text-[10px] bg-green-500/20 text-green-400 border-green-500/40">
                                    {person}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {comparisonData.entities.comparison.common_entities.organizations.length > 0 && (
                            <div className="mb-3">
                              <span className="text-xs text-muted-foreground">Common Organizations:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {comparisonData.entities.comparison.common_entities.organizations.map((org, idx) => (
                                  <Badge key={idx} className="text-[10px] bg-green-500/20 text-green-400 border-green-500/40">
                                    {org}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Unique Entities */}
                          <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border/60">
                            <div>
                              <span className="text-xs text-muted-foreground block mb-2">
                                Unique to {clusterDetail.articles[0].source}:
                              </span>
                              <div className="space-y-1">
                                {[...comparisonData.entities.comparison.unique_to_source_1.persons.slice(0, 3), 
                                  ...comparisonData.entities.comparison.unique_to_source_1.organizations.slice(0, 3)].map((entity, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[9px] mr-1">
                                    {entity}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground block mb-2">
                                Unique to {clusterDetail.articles[1].source}:
                              </span>
                              <div className="space-y-1">
                                {[...comparisonData.entities.comparison.unique_to_source_2.persons.slice(0, 3), 
                                  ...comparisonData.entities.comparison.unique_to_source_2.organizations.slice(0, 3)].map((entity, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[9px] mr-1">
                                    {entity}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Keyword Frequency Comparison */}
                        <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
                          <h4 className="font-bold mb-4">Keyword Analysis</h4>
                          
                          {/* Common Keywords with emphasis */}
                          {comparisonData.keywords.comparison.common_keywords.length > 0 && (
                            <div className="mb-4">
                              <span className="text-xs text-muted-foreground">Common Keywords (with emphasis):</span>
                              <div className="mt-2 space-y-1">
                                {comparisonData.keywords.comparison.common_keywords.slice(0, 8).map((kw, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs">
                                    <span className="w-20 font-medium">{kw.keyword}</span>
                                    <div className="flex-1 h-4 bg-[var(--news-bg-primary)] rounded-full overflow-hidden flex">
                                      <div 
                                        className="h-full bg-blue-500/60" 
                                        style={{ width: `${(kw.source_1_freq / (kw.source_1_freq + kw.source_2_freq || 1)) * 100}%` }}
                                      />
                                      <div 
                                        className="h-full bg-orange-500/60" 
                                        style={{ width: `${(kw.source_2_freq / (kw.source_1_freq + kw.source_2_freq || 1)) * 100}%` }}
                                      />
                                    </div>
                                    <span className="w-8 text-right text-[10px] text-muted-foreground">
                                      {kw.source_1_freq} vs {kw.source_2_freq}
                                    </span>
                                    {kw.emphasis !== 'equal' && (
                                      <Badge className={`text-[9px] ${kw.emphasis === 'source_1' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                        {kw.emphasis === 'source_1' ? clusterDetail.articles[0].source.slice(0, 8) : clusterDetail.articles[1].source.slice(0, 8)}
                                      </Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Unique Keywords */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="text-xs text-muted-foreground">Unique to {clusterDetail.articles[0].source}:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {comparisonData.keywords.comparison.unique_to_source_1.slice(0, 6).map((kw, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[9px]">
                                    {kw.keyword} ({kw.frequency})
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">Unique to {clusterDetail.articles[1].source}:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {comparisonData.keywords.comparison.unique_to_source_2.slice(0, 6).map((kw, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[9px]">
                                    {kw.keyword} ({kw.frequency})
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Side-by-side Content with Diff Highlights */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {clusterDetail.articles.slice(0, 2).map((article, idx) => {
                            const content = articleContents.get(article.id);
                            const isFirst = idx === 0;
                            return (
                              <div key={article.id} className="space-y-4">
                                {/* Article Header */}
                                <div className="bg-[var(--news-bg-secondary)] p-4 rounded-lg border border-border/60">
                                  {hasRealImage(article.image_url) && (
                                    <div className="relative aspect-video max-h-[150px] overflow-hidden rounded-lg mb-3">
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

                                {/* Content with Visual Diff */}
                                <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
                                  <h5 className="font-bold mb-3 text-sm">{article.title}</h5>
                                  {loadingArticle === article.id ? (
                                    <div className="flex items-center gap-2 p-4">
                                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                      <span className="text-muted-foreground text-sm">Loading...</span>
                                    </div>
                                  ) : content ? (
                                    <div className="space-y-2 text-sm">
                                      {/* Show similar sentences with highlighting */}
                                      {comparisonData.diff.similar.slice(0, 5).map((item, sidx) => (
                                        <div 
                                          key={sidx} 
                                          className={`p-2 rounded border-l-2 ${isFirst ? 'border-l-green-500 bg-green-500/5' : 'border-l-orange-500 bg-orange-500/5'}`}
                                        >
                                          <div className="text-[10px] text-muted-foreground mb-1">
                                            Similarity: {Math.round(item.similarity * 100)}%
                                          </div>
                                          <p className="text-sm">
                                            {isFirst ? item.source_1_text : item.source_2_text}
                                          </p>
                                        </div>
                                      ))}
                                      
                                      {/* Show unique content */}
                                      {comparisonData.diff[isFirst ? 'removed' : 'added'].slice(0, 3).map((item, uidx) => (
                                        <div 
                                          key={`unique-${uidx}`}
                                          className="p-2 rounded border-l-2 border-l-gray-500 bg-gray-500/5 opacity-70"
                                        >
                                          <div className="text-[10px] text-muted-foreground mb-1">
                                            Unique content
                                          </div>
                                          <p className="text-sm">{item.text}</p>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-sm text-muted-foreground">
                                      No content available
                                    </div>
                                  )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2">
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
                                      Read Original
                                    </a>
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Comparison Summary Stats */}
                        <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
                          <h4 className="font-bold mb-4">Comparison Summary</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-green-400">
                                {comparisonData.summary.common_entities_count}
                              </div>
                              <div className="text-xs text-muted-foreground">Common Entities</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-blue-400">
                                {comparisonData.summary.unique_entities_source_1}
                              </div>
                              <div className="text-xs text-muted-foreground">Unique to {clusterDetail.articles[0].source}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-orange-400">
                                {comparisonData.summary.unique_entities_source_2}
                              </div>
                              <div className="text-xs text-muted-foreground">Unique to {clusterDetail.articles[1].source}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-primary">
                                {comparisonData.summary.common_keywords_count}
                              </div>
                              <div className="text-xs text-muted-foreground">Common Keywords</div>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center py-12 text-muted-foreground">
                        Failed to load comparison data. Please try again.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    {clusterDetail.articles.length < 2
                      ? "Need at least 2 sources to compare"
                      : "Select articles to compare"}
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
