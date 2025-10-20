"use client";

import { useReadingQueue } from "@/hooks/useReadingQueue";
import { useFavorites } from "@/hooks/useFavorites";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  List,
  ChevronDown,
  Trash2,
  X,
  ExternalLink,
  Heart,
  Star,
  Bookmark,
  Sparkles,
  AlertTriangle,
  DollarSign,
  Bug,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  type NewsArticle,
  analyzeArticle,
  type ArticleAnalysis,
  API_BASE_URL,
  getSourceById,
  type NewsSource,
  fetchSourceDebugData,
  type SourceDebugData,
} from "@/lib/api";

export function ReadingQueueSidebar() {
  const { queuedArticles, removeArticleFromQueue, isLoaded } =
    useReadingQueue();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [selectedArticleUrl, setSelectedArticleUrl] = useState<string | null>(
    null
  );
  const [isLiked, setIsLiked] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
  const [source, setSource] = useState<NewsSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState<SourceDebugData | null>(null);
  const [fullArticleText, setFullArticleText] = useState<string | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);

  const handleRemove = (articleUrl: string) => {
    removeArticleFromQueue(articleUrl);
  };

  const loadAiAnalysis = async (article: NewsArticle) => {
    try {
      setAiAnalysisLoading(true);
      const analysis = await analyzeArticle(article.url, article.source);
      setAiAnalysis(analysis);
    } catch (e) {
      console.error("Failed to analyze article:", e);
      setAiAnalysis({
        success: false,
        article_url: article.url,
        error: e instanceof Error ? e.message : "Failed to analyze article",
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  };

  const loadSource = async (article: NewsArticle) => {
    setSourceLoading(true);
    try {
      const fetchedSource = await getSourceById(article.sourceId);
      setSource(fetchedSource || null);
    } catch (error) {
      console.error("Failed to load source:", error);
      setSource(null);
    } finally {
      setSourceLoading(false);
    }
  };

  const loadDebugData = async (article: NewsArticle) => {
    try {
      setDebugLoading(true);
      const data = await fetchSourceDebugData(article.source);
      setDebugData(data);
    } catch (e) {
      console.error("Failed to fetch debug data:", e);
      setDebugData(null);
    } finally {
      setDebugLoading(false);
    }
  };

  const loadFullArticle = async (article: NewsArticle) => {
    try {
      setArticleLoading(true);
      setFullArticleText(null);
      const response = await fetch(
        `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`
      );
      if (response.ok) {
        const data = await response.json();
        setFullArticleText(data.text || data.full_text || null);
      }
    } catch (e) {
      console.error("Failed to fetch full article:", e);
    } finally {
      setArticleLoading(false);
    }
  };

  const selectedArticle =
    selectedArticleUrl && queuedArticles
      ? queuedArticles.find((a) => a.url === selectedArticleUrl)
      : null;
  const selectedArticleIndex = selectedArticle
    ? queuedArticles.findIndex((a) => a.url === selectedArticleUrl)
    : -1;

  // Load AI analysis and source when article is selected
  useEffect(() => {
    if (selectedArticle) {
      setIsLiked(false);
      setIsBookmarked(false);
      setAiAnalysis(null);
      setSource(null);
      setShowSourceDetails(false);
      setDebugOpen(false);
      setDebugData(null);
      setFullArticleText(null);

      loadAiAnalysis(selectedArticle);
      loadSource(selectedArticle);
      loadFullArticle(selectedArticle);
    }
  }, [selectedArticleUrl, selectedArticle]);

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow"
            style={{
              backgroundColor: "var(--primary)",
              borderColor: "var(--primary)",
            }}
          >
            <List className="h-6 w-6 text-primary-foreground" />
            {isLoaded && queuedArticles.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-semibold">
                {queuedArticles.length}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent
          className="flex flex-col p-0"
          style={{
            backgroundColor: "var(--news-bg-primary)",
            width: selectedArticle ? "70vw" : "540px",
            maxWidth: selectedArticle ? "70vw" : "100%",
          }}
        >
          {/* Full-screen article detail view */}
          {selectedArticle ? (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Detail Header */}
              <div
                className="flex items-center justify-between p-6 border-b flex-shrink-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex-1 mr-4">
                  <h1 className="font-bold text-2xl leading-tight font-serif">
                    {selectedArticle.title}
                  </h1>
                  <p
                    className="text-sm mt-2"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {selectedArticle.source}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedArticleUrl(null)}
                  className="flex-shrink-0"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Detail Content - Two Column Layout */}
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                  {/* Main Content - 2/3 width */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Featured Image */}
                    {selectedArticle.image && (
                      <div className="rounded-lg overflow-hidden">
                        <img
                          src={selectedArticle.image}
                          alt={selectedArticle.title}
                          className="w-full h-96 object-cover"
                        />
                      </div>
                    )}

                    {/* Metadata Bar */}
                    <div
                      className="flex flex-wrap gap-4 text-sm pb-4 border-b"
                      style={{
                        color: "var(--muted-foreground)",
                        borderColor: "var(--border)",
                      }}
                    >
                      {selectedArticle.publishedAt && (
                        <div>
                          <span className="font-semibold">Published:</span>{" "}
                          {new Date(
                            selectedArticle.publishedAt
                          ).toLocaleDateString()}
                        </div>
                      )}
                      <div>
                        <span className="font-semibold">Source:</span>{" "}
                        {selectedArticle.source}
                      </div>
                    </div>

                    {/* Summary/Content */}
                    <div
                      className="space-y-4 text-base leading-relaxed"
                      style={{ color: "var(--foreground)" }}
                    >
                      {selectedArticle.summary && (
                        <div>
                          <h3 className="font-bold text-lg mb-2">Summary</h3>
                          <p>{selectedArticle.summary}</p>
                        </div>
                      )}

                      {/* Full Article Text */}
                      <div>
                        <h3 className="font-bold text-lg mb-2">Full Article</h3>
                        {articleLoading ? (
                          <div className="flex items-center gap-3 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-400"></div>
                            <p className="text-gray-400 text-sm">
                              Loading full article text...
                            </p>
                          </div>
                        ) : fullArticleText ? (
                          <div
                            className="text-gray-300 leading-relaxed whitespace-pre-wrap text-sm"
                            style={{ color: "var(--foreground)" }}
                          >
                            {fullArticleText}
                          </div>
                        ) : (
                          <div
                            className="text-gray-300 leading-relaxed text-sm"
                            style={{ color: "var(--foreground)" }}
                          >
                            {selectedArticle.content || selectedArticle.summary}
                          </div>
                        )}
                      </div>

                      {selectedArticle.content &&
                        !fullArticleText &&
                        !articleLoading && (
                          <div>
                            <h3 className="font-bold text-lg mb-2">
                              Article Text
                            </h3>
                            <p className="whitespace-pre-wrap text-sm">
                              {selectedArticle.content}
                            </p>
                          </div>
                        )}

                      {!selectedArticle.summary &&
                        !selectedArticle.content &&
                        !fullArticleText && (
                          <p>No content available for this article.</p>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div
                      className="flex gap-2 pt-4 border-t flex-wrap"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsLiked(!isLiked)}
                        className={
                          isLiked ? "text-red-400" : "text-gray-400"
                        }
                      >
                        <Heart
                          className={`h-4 w-4 mr-2 ${
                            isLiked ? "fill-current" : ""
                          }`}
                        />
                        Like
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          selectedArticle &&
                          toggleFavorite(selectedArticle.sourceId)
                        }
                        className={
                          selectedArticle &&
                          isFavorite(selectedArticle.sourceId)
                            ? "text-yellow-400"
                            : "text-gray-400"
                        }
                      >
                        <Star
                          className={`h-4 w-4 mr-2 ${
                            selectedArticle &&
                            isFavorite(selectedArticle.sourceId)
                              ? "fill-current"
                              : ""
                          }`}
                        />
                        Favorite
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsBookmarked(!isBookmarked)}
                        className={
                          isBookmarked ? "text-yellow-400" : "text-gray-400"
                        }
                      >
                        <Bookmark
                          className={`h-4 w-4 ${
                            isBookmarked ? "fill-current" : ""
                          }`}
                        />
                        Bookmark
                      </Button>
                    </div>
                  </div>

                  {/* AI Analysis Sidebar - 1/3 width */}
                  <div className="lg:col-span-1 space-y-4">
                    {/* AI Summary */}
                    {aiAnalysisLoading ? (
                      <div
                        className="flex items-center justify-center p-4 rounded-lg border"
                        style={{
                          backgroundColor: "var(--card)",
                          borderColor: "var(--border)",
                        }}
                      >
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-400"></div>
                      </div>
                    ) : aiAnalysis?.success && aiAnalysis.summary ? (
                      <div
                        className="rounded-lg p-4 border"
                        style={{
                          backgroundColor:
                            "rgba(168, 85, 247, 0.1)",
                          borderColor: "rgba(168, 85, 247, 0.3)",
                        }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <Sparkles className="h-4 w-4 text-purple-400" />
                          <h3 className="font-semibold text-sm text-white">
                            AI Summary
                          </h3>
                        </div>
                        <p
                          className="text-sm leading-relaxed"
                          style={{
                            color: "var(--foreground)",
                          }}
                        >
                          {aiAnalysis.summary}
                        </p>
                      </div>
                    ) : null}

                    {/* Bias Analysis */}
                    {aiAnalysis?.success && aiAnalysis.bias_analysis && (
                      <div
                        className="rounded-lg p-4 border"
                        style={{
                          backgroundColor: "var(--card)",
                          borderColor: "var(--border)",
                        }}
                      >
                        <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-400" />
                          Bias Analysis
                        </h3>
                        {aiAnalysis.bias_analysis.overall_bias_score && (
                          <Badge className="mb-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                            Score: {aiAnalysis.bias_analysis.overall_bias_score}/10
                          </Badge>
                        )}
                        <div className="space-y-2 text-xs">
                          {aiAnalysis.bias_analysis.tone_bias && (
                            <div>
                              <span style={{ color: "var(--muted-foreground)" }}>
                                Tone:
                              </span>
                              <p style={{ color: "var(--foreground)" }}>
                                {aiAnalysis.bias_analysis.tone_bias}
                              </p>
                            </div>
                          )}
                          {aiAnalysis.bias_analysis.framing_bias && (
                            <div>
                              <span style={{ color: "var(--muted-foreground)" }}>
                                Framing:
                              </span>
                              <p style={{ color: "var(--foreground)" }}>
                                {aiAnalysis.bias_analysis.framing_bias}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Source Info */}
                    <div
                      className="rounded-lg p-4 border"
                      style={{
                        backgroundColor: "var(--card)",
                        borderColor: "var(--border)",
                      }}
                    >
                      <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-3">
                        <AlertTriangle className="h-4 w-4 text-yellow-400" />
                        Source
                      </h3>
                      {sourceLoading ? (
                        <div className="flex items-center justify-center p-4">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                        </div>
                      ) : source ? (
                        <div className="space-y-2 text-xs">
                          {source.funding && source.funding.length > 0 && (
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-green-400" />
                              <span
                                style={{
                                  color: "var(--foreground)",
                                }}
                              >
                                {source.funding.join(", ")}
                              </span>
                            </div>
                          )}
                          {showSourceDetails && source.url && (
                            <div
                              className="pt-2 border-t space-y-2"
                              style={{ borderColor: "var(--border)" }}
                            >
                              <div>
                                <span
                                  style={{
                                    color: "var(--muted-foreground)",
                                  }}
                                >
                                  Website:
                                </span>
                                <p
                                  style={{
                                    color: "var(--foreground)",
                                  }}
                                >
                                  {source.url}
                                </p>
                              </div>
                              <div>
                                <span
                                  style={{
                                    color: "var(--muted-foreground)",
                                  }}
                                >
                                  Category:
                                </span>
                                <p
                                  style={{
                                    color: "var(--foreground)",
                                  }}
                                >
                                  {source.category.join(", ")}
                                </p>
                              </div>
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setShowSourceDetails(!showSourceDetails)
                            }
                            className="w-full mt-2 text-xs"
                          >
                            {showSourceDetails ? "Hide" : "Show"} Details
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="text-xs"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          Source info unavailable
                        </p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDebugOpen(!debugOpen);
                          if (!debugOpen) loadDebugData(selectedArticle);
                        }}
                        className="w-full mt-2 text-xs"
                      >
                        <Bug className="h-3 w-3 mr-1" />{" "}
                        {debugOpen ? "Hide" : "Show"} Debug
                      </Button>
                      {debugOpen && (
                        <div
                          className="mt-2 p-2 rounded text-xs"
                          style={{
                            backgroundColor: "rgba(0, 0, 0, 0.4)",
                            borderColor: "var(--border)",
                          }}
                        >
                          {debugLoading ? (
                            <div className="flex items-center justify-center">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                            </div>
                          ) : debugData ? (
                            <div
                              style={{
                                color: "var(--foreground)",
                              }}
                            >
                              Feed has{" "}
                              {debugData.parsed_entries?.length || 0} entries
                            </div>
                          ) : (
                            <div
                              style={{
                                color: "var(--muted-foreground)",
                              }}
                            >
                              No debug data
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Detail Footer Actions */}
              <div
                className="flex gap-3 p-6 border-t flex-shrink-0"
                style={{ borderColor: "var(--border)" }}
              >
                <Button
                  className="flex-1"
                  asChild
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-foreground)",
                  }}
                >
                  <a
                    href={selectedArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Read on Source
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    handleRemove(selectedArticle.url);
                    setSelectedArticleUrl(null);
                  }}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            /* List View */
            <>
              <SheetHeader
                className="px-6 pt-6 pb-4 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-4xl font-bold font-serif">
                    Articles to Read
                  </SheetTitle>
                  <span
                    className="text-sm font-medium px-3 py-1 rounded-full"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }}
                  >
                    {queuedArticles.length}
                  </span>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto flex flex-col px-6 py-6">
                {isLoaded && queuedArticles.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div className="space-y-2">
                  <p
                    className="text-lg font-semibold"
                    style={{ color: "var(--foreground)" }}
                  >
                    Your queue is empty
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    Start adding articles to build your reading list
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Articles List */}
                {queuedArticles.map((article, index) => {
                  const isExpanded = expandedIndex === index;

                  return (
                    <button
                      key={article.url}
                      onClick={() =>
                        setExpandedIndex(isExpanded ? null : index)
                      }
                      className={cn(
                        "w-full transition-all duration-300 ease-out cursor-pointer text-left group",
                        "transform hover:scale-105"
                      )}
                      style={{
                        marginLeft: `${Math.min(index * 4, 16)}px`,
                        marginTop: index > 0 ? "-8px" : "0px",
                      }}
                    >
                      <div
                        className={cn(
                          "relative rounded-2xl border overflow-hidden backdrop-blur-sm",
                          "transition-all duration-300",
                          "p-4 flex flex-col",
                          isExpanded
                            ? "shadow-2xl ring-2"
                            : "shadow-lg group-hover:shadow-xl"
                        )}
                        style={{
                          backgroundColor: isExpanded
                            ? "var(--news-bg-secondary)"
                            : "var(--card)",
                          borderColor: isExpanded
                            ? "var(--primary)"
                            : "var(--border)",
                          outlineColor: isExpanded
                            ? "var(--primary)"
                            : undefined,
                          outlineWidth: isExpanded ? "2px" : "0px",
                          outlineOffset: isExpanded ? "0px" : "0px",
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Index Badge */}
                          <div
                            className="flex-shrink-0 text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center"
                            style={{
                              backgroundColor: "var(--primary)",
                              color: "var(--primary-foreground)",
                            }}
                          >
                            {index + 1}
                          </div>

                          {/* Title and Source */}
                          <div className="flex-1 min-w-0">
                            <h3
                              className={cn(
                                "font-bold leading-tight group-hover:text-primary transition-colors",
                                isExpanded
                                  ? "text-base"
                                  : "text-sm line-clamp-2"
                              )}
                              style={{
                                color: isExpanded
                                  ? "var(--foreground)"
                                  : "var(--foreground)",
                              }}
                            >
                              {article.title}
                            </h3>
                            <p
                              className="text-xs mt-1"
                              style={{
                                color: "var(--muted-foreground)",
                              }}
                            >
                              {article.source}
                            </p>
                          </div>

                          {/* Image Thumbnail - Right Side */}
                          {article.image && !isExpanded && (
                            <div
                              className="flex-shrink-0 h-12 w-16 rounded-lg overflow-hidden border"
                              style={{ borderColor: "var(--border)" }}
                            >
                              <img
                                src={article.image}
                                alt={article.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}

                          {/* Expand Indicator */}
                          <div
                            className="flex-shrink-0 transition-transform"
                            style={{
                              color: "var(--muted-foreground)",
                              transform: isExpanded
                                ? "rotate(180deg)"
                                : "rotate(0deg)",
                            }}
                          >
                            <ChevronDown className="h-5 w-5" />
                          </div>
                        </div>

                        {/* Expandable Content */}
                        {isExpanded && (
                          <div
                            className="space-y-3 pt-3 mt-3 border-t animate-in fade-in slide-in-from-top-2 duration-200"
                            style={{ borderColor: "var(--border)" }}
                          >
                            {article.image && (
                              <img
                                src={article.image}
                                alt={article.title}
                                className="w-full h-40 object-cover rounded-lg"
                              />
                            )}
                            <p
                              className="text-sm"
                              style={{
                                color: "var(--foreground)",
                              }}
                            >
                              {article.summary ||
                                article.content ||
                                "No description available"}
                            </p>
                            <div className="flex gap-2 pt-2">
                              <Button
                                size="sm"
                                className="flex-1"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSelectedArticleUrl(article.url);
                                }}
                                style={{
                                  backgroundColor: "var(--primary)",
                                  color: "var(--primary-foreground)",
                                }}
                              >
                                Read Article
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleRemove(article.url);
                                }}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
