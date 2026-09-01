"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, Dispatch, RefObject,SetStateAction } from 'react';
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRightLeft,
  Clock,
  ExternalLink,
  Heart,
  Loader2,
  Maximize2,
  Minimize2,
  MinusCircle,
  Newspaper,
  PlusCircle,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SafeImage } from "@/components/safe-image";
import type {
  AllCluster,
  BreakingCluster,
  GdeltContext,
  NewsArticle,
  TrendingCluster} from "@/lib/api";
import {
  API_BASE_URL,
  fetchClusterDetail,
} from "@/lib/api";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { ArticleContent } from "@/components/article-content";
import { buildComparisonSourceOptions, getDefaultComparisonArticleIds, getSelectedComparisonArticles } from '@/lib/cluster-comparison';
import type { ComparisonSourceOption } from '@/lib/cluster-comparison';
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ClusterArticle {
  id: number;
  title: string;
  source: string;
  source_id?: string | null;
  url: string;
  image_url?: string | null;
  published_at?: string | null;
  summary?: string | null;
  similarity: number;
  author?: string | null;
  authors?: string[];
  gdelt_context?: GdeltContext | null;
}

type ComparisonArticle = Omit<ClusterArticle, "source_id"> & {
  source_id?: string;
};

function normalizeComparisonArticle(article: ClusterArticle): ComparisonArticle {
  return {
    ...article,
    source_id: article.source_id?.trim() || undefined,
  };
}

interface ClusterDetailModalProps {
  cluster: (TrendingCluster | BreakingCluster | AllCluster) | null;
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
    source_1_top: { word: string; count: number }[];
    source_2_top: { word: string; count: number }[];
    comparison: {
      common_keywords: {
        keyword: string;
        source_1_freq: number;
        source_2_freq: number;
        difference: number;
        emphasis: string;
      }[];
      unique_to_source_1: { keyword: string; frequency: number }[];
      unique_to_source_2: { keyword: string; frequency: number }[];
    };
  };
  diff: {
    added: { index: number; text: string; type: string }[];
    removed: { index: number; text: string; type: string }[];
    similar: {
      source_1_index: number;
      source_2_index: number;
      source_1_text: string;
      source_2_text: string;
      similarity: number;
    }[];
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

function buildComparisonRequestKey(articleIds:readonly  number[]): string {
  return [...articleIds].sort((a, b) => a - b).join(":");
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) {return "";}
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {return dateStr;}
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSignedNumber(value?: number | null, digits = 1): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}`;
}

function toPct(value: number, min = -10, max = 10): number {
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
}

function clusterContextOf(
  clusterDetail: { gdelt_context?: GdeltContext | null } | null | undefined,
  cluster:Readonly< { gdelt_context?: GdeltContext | null }>,
): GdeltContext | null {
  return clusterDetail?.gdelt_context ?? cluster.gdelt_context ?? null;
}

function resolveToneView(
  activeContext: GdeltContext | null | undefined,
  clusterContext: GdeltContext | null,
): { toneDelta: number | null; toneAvg: number | null } {
  return {
    toneAvg: activeContext?.tone_avg ?? clusterContext?.tone_avg ?? null,
    toneDelta: activeContext?.tone_delta_vs_cluster ?? null,
  };
}

function getCameoSummary(context?: GdeltContext | null): string | null {
  const cameo = context?.top_cameo?.[0];
  if (!cameo) {return null;}
  const label = cameo.label || cameo.code || "CAMEO";
  return cameo.count > 1 ? `${label} · ${cameo.count}` : label;
}

function hasRealImage(src?: string | null): boolean {
  if (!src) {return false;}
  const trimmed = src.trim();
  if (!trimmed || trimmed === "none") {return false;}
  const lower = trimmed.toLowerCase();
  return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg");
}

async function fetchArticleContentText(
  article: Pick<ClusterArticle, "url">,
): Promise<string | null> {
  const cached = fullArticleCache.get(article.url);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(
    `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`,
  );
  if (!response.ok) {
    throw new Error(`Article extraction failed (${response.status})`);
  }

  const data: { text?: string | null; full_text?: string | null } =
    await response.json(),
   text = data.text || data.full_text || null;
  fullArticleCache.set(article.url, text);
  return text;
}

interface ComparisonRequestResult {
  contentEntries: readonly (readonly [number, string | null])[];
  data: ComparisonData;
}

async function requestComparison(
  comparisonArticles: readonly ComparisonArticle[],
  articleContents: ReadonlyMap<number, string | null>,
): Promise<ComparisonRequestResult> {
  const contentEntries = await Promise.all(
    comparisonArticles.map((article) => {
      const cachedContent = articleContents.get(article.id);
      if (cachedContent !== undefined) {
        return Promise.resolve([article.id, cachedContent] as const);
      }

      return fetchArticleContentText(article)
        .then((text) => [article.id, text] as const)
        .catch((error: unknown) => {
          console.error("Failed to extract comparison article:", error);
          return [article.id, null] as const;
        });
    }),
  ),
   contentById = new Map(contentEntries),
   [sourceOne, sourceTwo] = comparisonArticles,
   content1 = contentById.get(sourceOne!.id) || "",
   content2 = contentById.get(sourceTwo!.id) || "";
  if (!content1 || !content2) {
    throw new Error("Compare Sources needs full text from two articles.");
  }

  const response = await fetch(`${API_BASE_URL}/compare/articles`, {
    body: JSON.stringify({
      content_1: content1,
      content_2: content2,
      title_1: sourceOne!.title,
      title_2: sourceTwo!.title,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Comparison failed (${response.status})`);
  }

  const data: ComparisonData = await response.json();
  return { contentEntries, data };
}

export function ClusterDetailModal({
  cluster,
  isBreaking,
  isOpen,
  onClose,
}: ClusterDetailModalProps) {
  if (!isOpen || !cluster) {return;}

  return (
    <ClusterDetailModalContent
      key={`${cluster.cluster_id}-${isOpen ? "open" : "closed"}`}
      cluster={cluster}
      isBreaking={isBreaking}
      onClose={onClose}
    />
  );
}

interface ClusterDetailModalContentProps {
  cluster: TrendingCluster | BreakingCluster | AllCluster;
  isBreaking: boolean;
  onClose: () => void;
}

type ClusterDetailResponse = Awaited<ReturnType<typeof fetchClusterDetail>>

const useClusterArticleController = (clusterDetail: ClusterDetailResponse | undefined) => {
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null),
   [articleContents, setArticleContents] = useState<Map<number, string | null>>(new Map()),
   [loadingArticle, setLoadingArticle] = useState<number | null>(null),
   articleContentRef = useRef<HTMLDivElement>(null),
   resolvedActiveArticleId = activeArticleId ?? clusterDetail?.articles[0]?.id.toString() ?? null,

   loadArticleContent = useCallback(async (article: ClusterArticle) => {
    setLoadingArticle(article.id)
    try {
      const text = await fetchArticleContentText(article)
      setArticleContents((previous) => new Map(previous).set(article.id, text))
    } catch (error) {
      console.error("Failed to extract article:", error)
      setArticleContents((previous) => new Map(previous).set(article.id, null))
    } finally {
      setLoadingArticle(null)
    }
  }, [])

  useEffect(() => {
    if (!resolvedActiveArticleId || !clusterDetail) {return}
    const article = clusterDetail.articles.find((item) => item.id.toString() === resolvedActiveArticleId)
    if (article && !articleContents.has(article.id)) {
      void loadArticleContent(article)
    }
  }, [articleContents, clusterDetail, loadArticleContent, resolvedActiveArticleId])

  const activeArticle = clusterDetail?.articles.find((item) => item.id.toString() === resolvedActiveArticleId)
  return {
    activeArticle,
    activeContent: activeArticle ? articleContents.get(activeArticle.id) : null,
    articleContentRef,
    articleContents,
    loadingArticle,
    resolvedActiveArticleId,
    setActiveArticleId,
    setArticleContents,
  }
}

interface ClusterComparisonControllerOptions {
  articleContents: Map<number, string | null>
  clusterDetail: ClusterDetailResponse | undefined
  setArticleContents: Dispatch<SetStateAction<Map<number, string | null>>>
}

const useClusterComparisonController = ({
  articleContents,
  clusterDetail,
  setArticleContents,
}: ClusterComparisonControllerOptions) => {
  const [comparisonMode, setComparisonMode] = useState(false),
   [comparisonData, setComparisonData] = useState<ComparisonData | null>(null),
   [comparisonLoading, setComparisonLoading] = useState(false),
   [selectedArticlesForComparison, setSelectedArticlesForComparison] = useState<number[]>([]),
   [comparisonError, setComparisonError] = useState<string | null>(null),
   comparisonRequestKeyRef = useRef<string | null>(null),
   comparisonClusterArticles: ComparisonArticle[] = useMemo(
    () => clusterDetail?.articles.map(normalizeComparisonArticle) ?? [],
    [clusterDetail],
  ),

   loadComparisonData = useCallback(async (articleIds: readonly number[]) => {
    if (articleIds.length < 2 || !clusterDetail) {return}
    const requestKey = buildComparisonRequestKey(articleIds)
    if (comparisonRequestKeyRef.current === requestKey) {return}

    setComparisonError(null)
    const selectedArticles = getSelectedComparisonArticles(comparisonClusterArticles, articleIds)
    if (selectedArticles.length < 2) {
      setComparisonData(null)
      setComparisonError("Select one article from two distinct outlets.")
      return
    }

    const [sourceOne, sourceTwo] = selectedArticles
    if (sourceOne!.source.trim().toLowerCase() === sourceTwo!.source.trim().toLowerCase()) {
      setComparisonData(null)
      const message = "Compare Sources needs coverage from at least two outlets."
      setComparisonError(message)
      toast.error(message)
      return
    }

    comparisonRequestKeyRef.current = requestKey
    setComparisonLoading(true)
    try {
      const { contentEntries, data } = await requestComparison(selectedArticles, articleContents)
      setArticleContents((previous) => {
        const next = new Map(previous)
        for (const [articleId, text] of contentEntries) {next.set(articleId, text)}
        return next
      })
      setComparisonData(data)
    } catch (error) {
      console.error("Failed to load comparison:", error)
      setComparisonData(null)
      const message = error instanceof Error ? error.message : "Failed to compare the selected sources."
      setComparisonError(message)
      toast.error(message)
    } finally {
      setComparisonLoading(false)
    }
  }, [articleContents, clusterDetail, comparisonClusterArticles, setArticleContents]),

   handleTabChange = useCallback((value: string) => {
    setComparisonMode(value === "compare")
  }, []),
   handleOpenComparison = useCallback(() => {
    if (!clusterDetail) {return}
    setComparisonError(null)
    const comparisonIds = getDefaultComparisonArticleIds(comparisonClusterArticles)
    if (comparisonIds.length < 2) {
      setComparisonData(null)
      const message = "Compare Sources needs coverage from at least two outlets."
      setComparisonError(message)
      toast.error(message)
      return
    }
    setSelectedArticlesForComparison(comparisonIds)
    setComparisonData(null)
    setComparisonMode(true)
    comparisonRequestKeyRef.current = null
  }, [clusterDetail, comparisonClusterArticles]),
   handleComparisonSourceChange = useCallback((sourceId: string, nextArticleId: string) => {
    const parsedId = Number(nextArticleId)
    if (!Number.isFinite(parsedId)) {return}
    setSelectedArticlesForComparison((previous) => {
      const nextArticles = getSelectedComparisonArticles(comparisonClusterArticles, previous).filter((article) => {
        const articleSourceId = article.source_id || article.source.trim().toLowerCase().replaceAll(/\s+/gu, "-")
        return articleSourceId !== sourceId
      })
      comparisonRequestKeyRef.current = null
      return [...nextArticles.map((article) => article.id), parsedId]
    })
  }, [comparisonClusterArticles])

  useEffect(() => {
    if (comparisonMode && selectedArticlesForComparison.length >= 2) {
      void loadComparisonData(selectedArticlesForComparison)
    }
  }, [comparisonMode, loadComparisonData, selectedArticlesForComparison])

  return {
    comparisonArticles: clusterDetail
      ? getSelectedComparisonArticles(comparisonClusterArticles, selectedArticlesForComparison)
      : [],
    comparisonData,
    comparisonError,
    comparisonLoading,
    comparisonMode,
    comparisonSourceOptions: clusterDetail ? buildComparisonSourceOptions(comparisonClusterArticles) : [],
    handleComparisonSourceChange,
    handleOpenComparison,
    handleTabChange,
  }
}

interface ClusterDetailViewProps {
  cluster: TrendingCluster | BreakingCluster | AllCluster
  isBreaking: boolean
  label: string
  breakingCluster: BreakingCluster
  trendingCluster: TrendingCluster
  isExpanded: boolean
  onToggleExpand: () => void
  onClose: () => void
  context: ComponentProps<typeof GdeltContextStrip> | null
  loading: boolean
  clusterDetail: ClusterDetailResponse | undefined
  loadError: string | null
  resolvedActiveArticleId: string | null
  activeContent: string | null | undefined
  loadingArticle: number | null
  likedIds: Set<number>
  isArticleInQueue: (url: string) => boolean
  contentRef: RefObject<HTMLDivElement | null>
  onLike: (articleId: number) => void
  onQueueToggle: (article: ClusterArticle) => void
  onTabChange: (value: string) => void
  onOpenComparison: () => void
  comparison: ComparisonTabProps
}

function ClusterDetailView({
  cluster,
  isBreaking,
  label,
  breakingCluster,
  trendingCluster,
  isExpanded,
  onToggleExpand,
  onClose,
  context,
  loading,
  clusterDetail,
  loadError,
  resolvedActiveArticleId,
  activeContent,
  loadingArticle,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onTabChange,
  onOpenComparison,
  comparison,
}: ClusterDetailViewProps) {
  const detailArticles = clusterDetail?.articles ?? []
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200">
      <div
        className={`bg-[var(--news-bg-primary)] border border-border/60 rounded-xl shadow-2xl shadow-black/40 transition-all duration-300 animate-in zoom-in-95 fade-in-0 duration-200 flex flex-col ${
          isExpanded ? "w-full h-full max-w-none max-h-none" : "max-w-5xl w-full max-h-[90vh]"
        }`}
      >
        <ClusterHeader
          isBreaking={isBreaking}
          label={label}
          breakingCluster={breakingCluster}
          trendingCluster={trendingCluster}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onClose={onClose}
        />
        <div className="flex-1 overflow-hidden flex flex-col">
          {context ? <GdeltContextStrip {...context} /> : null}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Loading sources...</span>
            </div>
          ) : detailArticles.length > 0 ? (
            <Tabs
              value={resolvedActiveArticleId || ""}
              onValueChange={onTabChange}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="border-b border-border/60 px-4 flex-shrink-0 overflow-x-auto">
                <TabsList className="h-auto p-1 bg-transparent gap-1">
                  {detailArticles.map((article) => (
                    <TabsTrigger
                      key={`${article.id}-${article.url}`}
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
                    onClick={onOpenComparison}
                  >
                    <ArrowRightLeft className="w-3 h-3 mr-2" />
                    Compare Sources
                  </TabsTrigger>
                </TabsList>
              </div>
              {detailArticles.map((article) => (
                <ArticleTab
                  key={`${article.id}-${article.url}`}
                  article={article}
                  activeContent={activeContent}
                  loadingArticleId={loadingArticle}
                  likedIds={likedIds}
                  isArticleInQueue={isArticleInQueue}
                  contentRef={contentRef}
                  onLike={onLike}
                  onQueueToggle={onQueueToggle}
                  onClose={onClose}
                />
              ))}
              <ComparisonTab {...comparison} />
            </Tabs>
          ) : loadError ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">{loadError}</div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              No articles found for this cluster.
            </div>
          )}
        </div>
        <KeywordsFooter keywords={cluster.keywords} />
      </div>
    </div>
  )
}

interface ClusterHeaderProps {
  isBreaking: boolean;
  label: string;
  breakingCluster: BreakingCluster;
  trendingCluster: TrendingCluster;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}

function ClusterHeader({
  isBreaking,
  label,
  breakingCluster,
  trendingCluster,
  isExpanded,
  onToggleExpand,
  onClose,
}: ClusterHeaderProps) {
  return (
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
          onClick={onToggleExpand}
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
  );
}

interface GdeltContextStripProps {
  context: GdeltContext;
  cameoSummary: string | null;
  toneAvg: number | null;
  toneDelta: number | null;
}

function GdeltContextStrip({
  context,
  cameoSummary,
  toneAvg,
  toneDelta,
}: GdeltContextStripProps) {
  return (
    <div className="border-b border-border/60 bg-[var(--news-bg-secondary)]/40 px-4 py-4">
      <div className="grid gap-3 md:grid-cols-3">
        <GdeltCameoMetric context={context} summary={cameoSummary} />
        <GdeltGoldsteinMetric context={context} />
        <GdeltToneMetric context={context} toneAvg={toneAvg} toneDelta={toneDelta} />
      </div>
    </div>
  );
}

function GdeltCameoMetric({ context, summary }: { context: GdeltContext; summary: string | null }) {
  return (
    <div className="rounded-lg border border-border/50 bg-[var(--news-bg-primary)]/80 p-3">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">CAMEO</div>
      {summary ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-primary/15 text-primary hover:bg-primary/15">{summary}</Badge>
          <span className="text-xs text-muted-foreground">{context.total_events} events</span>
        </div>
      ) : <span className="text-sm text-muted-foreground">No event root data</span>}
    </div>
  )
}

function GdeltGoldsteinMetric({ context }: { context: GdeltContext }) {
  const hasRange = typeof context.goldstein_min === "number" && typeof context.goldstein_max === "number"
  return (
    <div className="rounded-lg border border-border/50 bg-[var(--news-bg-primary)]/80 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
        <span>Goldstein</span>
        {context.goldstein_bucket && <Badge variant="outline" className="border-border/60 text-[9px] uppercase tracking-[0.2em]">{context.goldstein_bucket}</Badge>}
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/5">
        {hasRange && <GdeltGoldsteinRange context={context} />}
        {typeof context.goldstein_avg === "number" && (
          <div className="absolute top-[-3px] h-4 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.45)]" style={{ left: `calc(${toPct(context.goldstein_avg)}% - 1px)` }} />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatMetricNumber(context.goldstein_min)}</span>
        <span className="font-medium text-foreground/80">{formatMetricNumber(context.goldstein_avg)}</span>
        <span>{formatMetricNumber(context.goldstein_max)}</span>
      </div>
    </div>
  )
}

function GdeltGoldsteinRange({ context }: { context: GdeltContext }) {
  if (typeof context.goldstein_min !== "number" || typeof context.goldstein_max !== "number") {return null}
  return (
    <div
      className="absolute top-0 h-full rounded-full bg-gradient-to-r from-red-500/60 via-amber-400/70 to-emerald-500/60"
      style={{
        left: `${toPct(context.goldstein_min)}%`,
        width: `${Math.max(toPct(context.goldstein_max) - toPct(context.goldstein_min), 2)}%`,
      }}
    />
  )
}

const formatMetricNumber = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toFixed(1) : "—"

function GdeltToneMetric({
  context,
  toneAvg,
  toneDelta,
}: {
  context: GdeltContext
  toneAvg: number | null
  toneDelta: number | null
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-[var(--news-bg-primary)]/80 p-3">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Tone</div>
      <div className="flex items-end gap-2">
        <span className="font-serif text-2xl text-foreground">{formatSignedNumber(toneAvg, 2)}</span>
        <span className="pb-1 text-xs text-muted-foreground">{toneDelta === null ? "cluster avg" : "vs cluster"}</span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {toneDelta === null ? (
          typeof context.tone_avg === "number" ? <span>Cluster avg {context.tone_avg.toFixed(2)}</span> : <span>No tone data</span>
        ) : (
          <span className={toneDelta >= 0 ? "text-emerald-400" : "text-red-400"}>{formatSignedNumber(toneDelta, 2)}</span>
        )}
      </div>
    </div>
  )
}

interface ArticleTabProps {
  article: ClusterArticle;
  activeContent: string | null | undefined;
  loadingArticleId: number | null;
  likedIds: Set<number>;
  isArticleInQueue: (url: string) => boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  onLike: (articleId: number) => void;
  onQueueToggle: (article: ClusterArticle) => void;
  onClose: () => void;
}

function ArticleTab({
  article,
  activeContent,
  loadingArticleId,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onClose,
}: ArticleTabProps) {
  return (
    <TabsContent
      value={article.id.toString()}
      className="flex-1 overflow-y-auto m-0 p-0"
    >
      <div className="p-6 space-y-6">
        <ArticleTabHeader article={article} onClose={onClose} />
        <ArticleTabBody
          article={article}
          activeContent={activeContent}
          contentRef={contentRef}
          loadingArticleId={loadingArticleId}
        />
        <ArticleTabActions
          article={article}
          isArticleInQueue={isArticleInQueue}
          likedIds={likedIds}
          onLike={onLike}
          onQueueToggle={onQueueToggle}
        />
       </div>
     </TabsContent>
  );
}

function ArticleTabHeader({
  article,
  onClose,
}: Readonly<Pick<ArticleTabProps, "article" | "onClose">>) {
  return (
    <div>
      {hasRealImage(article.image_url) && (
        <div className="relative aspect-video max-h-[300px] overflow-hidden rounded-lg mb-6">
          <SafeImage
            src={article.image_url}
            alt={article.title}
            fill
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
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
      <h3 className="font-serif text-2xl font-bold mb-3">{article.title}</h3>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link
          href={`/source/${encodeURIComponent(
            article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
          )}`}
          className="font-medium hover:text-primary transition-colors"
          onClick={(event) => {
            event.stopPropagation();
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
      {article.gdelt_context && <ArticleGdeltBadges context={article.gdelt_context} />}
    </div>
  );
}

function ArticleGdeltBadges({ context }: { context: GdeltContext }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className="border-border/60 text-[10px] uppercase tracking-[0.18em]"
      >
        {getCameoSummary(context) || "GDELT"}
      </Badge>
      {typeof context.tone_delta_vs_cluster === "number" && (
        <Badge
          className={`text-[10px] uppercase tracking-[0.18em] ${
            context.tone_delta_vs_cluster >= 0
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-red-500/15 text-red-300"
          }`}
        >
          Tone {formatSignedNumber(context.tone_delta_vs_cluster, 2)}
        </Badge>
      )}
    </div>
  );
}

function ArticleTabBody({
  article,
  activeContent,
  contentRef,
  loadingArticleId,
}: Readonly<{
  article: ClusterArticle;
  activeContent: string | null | undefined;
  contentRef: RefObject<HTMLDivElement | null>;
  loadingArticleId: number | null;
}>) {
  return (
    <div ref={contentRef} className="prose prose-invert max-w-none">
      {loadingArticleId === article.id ? (
        <div className="flex items-center gap-3 p-6 bg-[var(--news-bg-secondary)]/60 rounded-lg border border-border/60">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-muted-foreground">Loading full article...</span>
        </div>
      ) : (
        <ArticleContent
          content={activeContent || "Loading article content..."}
          highlights={[]}
          className="text-base space-y-4"
        />
      )}
    </div>
  );
}

function ArticleTabActions({
  article,
  isArticleInQueue,
  likedIds,
  onLike,
  onQueueToggle,
}: Readonly<Pick<
  ArticleTabProps,
  "article" | "isArticleInQueue" | "likedIds" | "onLike" | "onQueueToggle"
>>) {
  return (
    <div className="flex items-center justify-between pt-6 border-t border-border/60">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>{  onLike(article.id); }}
          className={likedIds.has(article.id) ? "text-red-400" : "text-gray-400"}
        >
          <Heart
            className={`h-4 w-4 mr-2 ${likedIds.has(article.id) ? "fill-current" : ""}`}
          />
          Like
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>{  onQueueToggle(article); }}
          className={
            isArticleInQueue(article.url) ? "text-blue-400" : "text-gray-400"
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
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4 mr-2" />
          Read Original
        </a>
      </Button>
    </div>
  );
}

interface ComparisonArticleColumnProps {
  article: ComparisonArticle;
  isFirst: boolean;
  content: string | null | undefined;
  loading: boolean;
  comparisonData: ComparisonData;
}

function ComparisonArticleColumn({
  article,
  isFirst,
  content,
  loading,
  comparisonData,
}: ComparisonArticleColumnProps) {
  return (
    <div className="space-y-4">
      {/* Article Header */}
      <div className="bg-[var(--news-bg-secondary)] p-4 rounded-lg border border-border/60">
        {hasRealImage(article.image_url) && (
          <div className="relative aspect-video max-h-[150px] overflow-hidden rounded-lg mb-3">
            <SafeImage
              src={article.image_url || undefined}
              alt={article.title}
              fill
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
        {loading ? (
          <div className="flex items-center gap-2 p-4">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : (content ? (
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
        ))}
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
}

interface EntitiesBlockProps {
  comparisonData: ComparisonData;
  primarySource: string;
  secondarySource: string;
}

function EntitiesBlock({
  comparisonData,
  primarySource,
  secondarySource,
}: EntitiesBlockProps) {
  const commonEntities = comparisonData.entities.comparison.common_entities;
  return (
    <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
      <h4 className="font-bold mb-4 flex items-center gap-2">
        <span>Named Entities</span>
        <Badge variant="outline" className="text-[10px]">
          {comparisonData.summary.common_entities_count} shared
        </Badge>
      </h4>

      {/* Common Entities */}
      {commonEntities.persons.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-muted-foreground">Common People:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {commonEntities.persons.map((person, idx) => (
              <Badge key={idx} className="text-[10px] bg-green-500/20 text-green-400 border-green-500/40">
                {person}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {commonEntities.organizations.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-muted-foreground">Common Organizations:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {commonEntities.organizations.map((org, idx) => (
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
            Unique to {primarySource}:
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
            Unique to {secondarySource}:
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
  );
}

interface KeywordsBlockProps {
  comparisonData: ComparisonData;
  primarySource: string;
  secondarySource: string;
}

function KeywordsBlock({
  comparisonData,
  primarySource,
  secondarySource,
}: KeywordsBlockProps) {
  return (
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
                    {kw.emphasis === 'source_1' ? primarySource.slice(0, 8) : secondarySource.slice(0, 8)}
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
          <span className="text-xs text-muted-foreground">Unique to {primarySource}:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {comparisonData.keywords.comparison.unique_to_source_1.slice(0, 6).map((kw, idx) => (
              <Badge key={idx} variant="outline" className="text-[9px]">
                {kw.keyword} ({kw.frequency})
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Unique to {secondarySource}:</span>
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
  );
}

interface ComparisonSummaryProps {
  comparisonData: ComparisonData;
  primarySource: string;
  secondarySource: string;
}

function ComparisonSummary({
  comparisonData,
  primarySource,
  secondarySource,
}: ComparisonSummaryProps) {
  return (
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
          <div className="text-xs text-muted-foreground">Unique to {primarySource}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-orange-400">
            {comparisonData.summary.unique_entities_source_2}
          </div>
          <div className="text-xs text-muted-foreground">Unique to {secondarySource}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">
            {comparisonData.summary.common_keywords_count}
          </div>
          <div className="text-xs text-muted-foreground">Common Keywords</div>
        </div>
      </div>
    </div>
  );
}

interface KeywordsFooterProps {
  keywords: string[];
}

function KeywordsFooter({ keywords }: KeywordsFooterProps) {
  if (keywords.length === 0) {return;}
  return (
    <div className="border-t border-border/60 px-4 py-3 flex-shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Keywords:</span>
        {keywords.slice(0, 8).map((keyword) => (
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
  );
}

interface ComparisonTabProps {
  comparisonMode: boolean;
  comparisonSourceOptions: ComparisonSourceOption<ComparisonArticle>[];
  comparisonArticles: ComparisonArticle[];
  comparisonError: string | null;
  comparisonData: ComparisonData | null;
  comparisonLoading: boolean;
  articleContents: Map<number, string | null>;
  loadingArticle: number | null;
  detailArticleCount: number | null;
  onSourceChange: (sourceId: string, articleId: string) => void;
}

function comparisonArticleSourceId(article: ComparisonArticle): string {
  return article.source_id || article.source.trim().toLowerCase().replaceAll(/\s+/gu, "-");
}

function ComparisonSourcePicker({
  articles,
  options,
  onSourceChange,
}:Readonly< {
  articles: ComparisonArticle[];
  options: ComparisonSourceOption<ComparisonArticle>[];
  onSourceChange: (sourceId: string, articleId: string) => void;
}>) {
  return (
    <div className="grid gap-4 border border-border/50 bg-[var(--news-bg-secondary)]/70 p-4 md:grid-cols-2">
      {options.slice(0, 2).map((sourceOption) => {
        const selectedArticleId = articles
          .find((article) => comparisonArticleSourceId(article) === sourceOption.sourceId)
          ?.id?.toString();
        return (
          <div key={sourceOption.sourceId} className="space-y-2">
            <div className="text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">Outlet</div>
            <div className="text-sm font-medium text-foreground">{sourceOption.sourceName}</div>
            <Select
              value={selectedArticleId}
              onValueChange={(value) =>{  onSourceChange(sourceOption.sourceId, value); }}
            >
              <SelectTrigger className="w-full border-border/60 bg-[var(--news-bg-primary)] text-left text-xs">
                <SelectValue placeholder="Choose article" />
              </SelectTrigger>
              <SelectContent>
                {sourceOption.articles.map((article) => (
                  <SelectItem key={`${article.id}-${article.url}`} value={article.id.toString()}>
                    {article.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

function ComparisonPairHeader({
  comparisonData,
  primaryArticle,
  secondaryArticle,
}:Readonly< {
  comparisonData: ComparisonData | null;
  primaryArticle: ComparisonArticle;
  secondaryArticle: ComparisonArticle;
}>) {
  return (
    <div className="mb-6 text-center">
      <h3 className="mb-2 font-serif text-2xl font-bold">
        Compare: {primaryArticle.source} vs {secondaryArticle.source}
      </h3>
      <p className="text-sm text-muted-foreground">How different sources report the same story</p>
      {comparisonData ? <ComparisonSimilarityBadge value={comparisonData.similarity.overall_match_percent} /> : null}
    </div>
  );
}

function ComparisonSimilarityBadge({ value }:Readonly< { value: number }>) {
  const color = value > 70 ? "text-green-400" : (value > 40 ? "text-yellow-400" : "text-red-400");
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--news-bg-secondary)] px-3 py-1 text-xs">
      <span>Content Similarity:</span>
      <span className={`font-bold ${color}`}>{value}%</span>
    </div>
  );
}

function ComparisonResults({
  comparisonData,
  comparisonError,
  comparisonLoading,
  articleContents,
  comparisonArticles,
  loadingArticle,
  primarySource,
  secondarySource,
}:Readonly< {
  comparisonData: ComparisonData | null;
  comparisonError: string | null;
  comparisonLoading: boolean;
  articleContents: Map<number, string | null>;
  comparisonArticles: ComparisonArticle[];
  loadingArticle: number | null;
  primarySource: string;
  secondarySource: string;
}>) {
  if (comparisonLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Analyzing articles...</span>
      </div>
    );
  }
  if (!comparisonData) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {comparisonError || "Failed to load comparison data. Please try again."}
      </div>
    );
  }
  return (
    <>
      <EntitiesBlock
        comparisonData={comparisonData}
        primarySource={primarySource}
        secondarySource={secondarySource}
      />
      <KeywordsBlock
        comparisonData={comparisonData}
        primarySource={primarySource}
        secondarySource={secondarySource}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {comparisonArticles.map((article, index) => (
          <ComparisonArticleColumn
            key={`${article.id}-${article.url}`}
            article={article}
            isFirst={index === 0}
            content={articleContents.get(article.id)}
            loading={loadingArticle === article.id}
            comparisonData={comparisonData}
          />
        ))}
      </div>
      <ComparisonSummary
        comparisonData={comparisonData}
        primarySource={primarySource}
        secondarySource={secondarySource}
      />
    </>
  );
}

function ComparisonView({
  comparisonSourceOptions,
  comparisonArticles,
  comparisonError,
  comparisonData,
  comparisonLoading,
  articleContents,
  loadingArticle,
  onSourceChange,
}: Omit<ComparisonTabProps, "comparisonMode" | "detailArticleCount">) {
  const primaryArticle = comparisonArticles[0],
   secondaryArticle = comparisonArticles[1];
  return (
    <div className="space-y-6 p-6">
      <ComparisonSourcePicker
        articles={comparisonArticles}
        options={comparisonSourceOptions}
        onSourceChange={onSourceChange}
      />
      {comparisonError ? (
        <div className="rounded-lg border border-border/60 bg-destructive/5 px-4 py-3 text-sm text-muted-foreground">
          {comparisonError}
        </div>
      ) : null}
      {primaryArticle && secondaryArticle ? (
        <>
          <ComparisonPairHeader
            comparisonData={comparisonData}
            primaryArticle={primaryArticle}
            secondaryArticle={secondaryArticle}
          />
          <ComparisonResults
            comparisonData={comparisonData}
            comparisonError={comparisonError}
            comparisonLoading={comparisonLoading}
            articleContents={articleContents}
            comparisonArticles={comparisonArticles}
            loadingArticle={loadingArticle}
            primarySource={primaryArticle.source}
            secondarySource={secondaryArticle.source}
          />
        </>
      ) : (
        <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] px-4 py-3 text-sm text-muted-foreground">
          Select one article from each outlet to compare the coverage.
        </div>
      )}
    </div>
  );
}

function ComparisonUnavailable({ detailArticleCount }:Readonly< { detailArticleCount: number | null }>) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      {!detailArticleCount || detailArticleCount < 2
        ? "Need at least 2 articles to compare"
        : "Compare Sources needs coverage from at least two outlets."}
    </div>
  );
}

function ComparisonTab({
  comparisonMode,
  comparisonSourceOptions,
  comparisonArticles,
  comparisonError,
  comparisonData,
  comparisonLoading,
  articleContents,
  loadingArticle,
  detailArticleCount,
  onSourceChange,
}: ComparisonTabProps) {
  const hasDistinctComparisonSources = comparisonSourceOptions.length >= 2;

  return (
    <TabsContent value="compare" className="flex-1 overflow-y-auto m-0 p-0">
      {comparisonMode && hasDistinctComparisonSources ? (
        <ComparisonView
          comparisonSourceOptions={comparisonSourceOptions}
          comparisonArticles={comparisonArticles}
          comparisonError={comparisonError}
          comparisonData={comparisonData}
          comparisonLoading={comparisonLoading}
          articleContents={articleContents}
          loadingArticle={loadingArticle}
          onSourceChange={onSourceChange}
        />
      ) : (
        <ComparisonUnavailable detailArticleCount={detailArticleCount} />
      )}
    </TabsContent>
  );
}

function ClusterDetailModalContent({
  cluster,
  isBreaking,
  onClose,
}: ClusterDetailModalContentProps) {
  const [isExpanded, setIsExpanded] = useState(false),
   { likedIds, toggleLike } = useLikedArticles(),
   { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue(),
   clusterId = cluster.cluster_id,
   {
    data: clusterDetail,
    isLoading: loading,
    error: clusterDetailError,
  } = useQuery<ClusterDetailResponse>({
    queryFn: () => fetchClusterDetail(clusterId),
    queryKey: ["cluster-detail", clusterId],
    retry: 1,
  }),
   articleState = useClusterArticleController(clusterDetail),
   comparisonState = useClusterComparisonController({
    articleContents: articleState.articleContents,
    clusterDetail,
    setArticleContents: articleState.setArticleContents,
  }),

   handleLike = useCallback((articleId: number) => {
    void toggleLike(articleId)
  }, [toggleLike]),
   handleQueueToggle = useCallback((article: ClusterArticle) => {
    const newsArticle: NewsArticle = {
      bias: "center",
      category: "trending",
      country: "US",
      credibility: "medium",
      id: article.id,
      image: article.image_url || "",
      originalLanguage: "en",
      publishedAt: article.published_at || new Date().toISOString(),
      source: article.source,
      sourceId: article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
      summary: "",
      tags: [],
      title: article.title,
      translated: false,
      url: article.url,
    }
    if (isArticleInQueue(article.url)) {
      removeArticleFromQueue(article.url)
    } else {
      addArticleToQueue(newsArticle)
    }
  }, [addArticleToQueue, isArticleInQueue, removeArticleFromQueue]),
   handleTabChange = (value: string) => {
    articleState.setActiveArticleId(value)
    comparisonState.handleTabChange(value)
  },

   loadError = clusterDetailError ? "Failed to load cluster details." : null,
   label = cluster.label || cluster.keywords.slice(0, 3).join(", "),
   breakingCluster = cluster as BreakingCluster,
   trendingCluster = cluster as TrendingCluster,
   clusterContext = clusterContextOf(clusterDetail, cluster),
   activeArticleContext = articleState.activeArticle?.gdelt_context ?? null,
   { toneDelta, toneAvg } = resolveToneView(activeArticleContext, clusterContext),
   cameoSummary = getCameoSummary(clusterContext)

  return (
    <ClusterDetailView
      cluster={cluster}
      isBreaking={isBreaking}
      label={label}
      breakingCluster={breakingCluster}
      trendingCluster={trendingCluster}
      isExpanded={isExpanded}
      onToggleExpand={() => {setIsExpanded(!isExpanded)}}
      onClose={onClose}
      context={clusterContext ? {
        cameoSummary,
        context: clusterContext,
        toneAvg,
        toneDelta,
      } : null}
      loading={loading}
      clusterDetail={clusterDetail}
      loadError={loadError}
      resolvedActiveArticleId={articleState.resolvedActiveArticleId}
      activeContent={articleState.activeContent}
      loadingArticle={articleState.loadingArticle}
      likedIds={likedIds}
      isArticleInQueue={isArticleInQueue}
      contentRef={articleState.articleContentRef}
      onLike={handleLike}
      onQueueToggle={handleQueueToggle}
      onTabChange={handleTabChange}
      onOpenComparison={comparisonState.handleOpenComparison}
      comparison={{
        articleContents: articleState.articleContents,
        comparisonArticles: comparisonState.comparisonArticles,
        comparisonData: comparisonState.comparisonData,
        comparisonError: comparisonState.comparisonError,
        comparisonLoading: comparisonState.comparisonLoading,
        comparisonMode: comparisonState.comparisonMode,
        comparisonSourceOptions: comparisonState.comparisonSourceOptions,
        detailArticleCount: clusterDetail?.articles.length ?? null,
        loadingArticle: articleState.loadingArticle,
        onSourceChange: comparisonState.handleComparisonSourceChange,
      }}
    />
  )
}
