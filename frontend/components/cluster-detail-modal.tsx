"use client";
import { hasText } from "@/lib/utils";

import { API_BASE_URL, fetchClusterDetail, mapBackendArticle } from "@/lib/api";
import type { AllCluster, BreakingCluster, ClusterArticle, TrendingCluster } from "@/lib/api";
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
import type {
  ComponentProps,
  CSSProperties,
  Dispatch,
  MouseEventHandler,
  RefObject,
  SetStateAction,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { articleContentQueryKey, fetchArticleContentText } from "@/lib/article-content";
import {
  buildComparisonSourceOptions,
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
} from "@/lib/cluster-comparison";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArticleContent } from "@/components/article-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ComparisonSourceOption } from "@/lib/cluster-comparison";
import Link from "next/link";
import { SafeImage } from "@/components/safe-image";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { isUsableImage } from "@/lib/article-image";
import { toast } from "sonner";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";
import type { DeepReadonly } from "@/lib/deep-readonly";

type ComparisonArticle = Omit<ClusterArticle, "source_id"> & {
  readonly source_id?: string;
};

const EMPTY_CLUSTER_ARTICLES: readonly ClusterArticle[] = [];

const normalizeComparisonArticle = (article: ClusterArticle): ComparisonArticle => ({
  ...article,
  source_id: article.source_id?.trim() ?? undefined,
});

interface ClusterDetailModalProps {
  readonly cluster: (TrendingCluster | BreakingCluster | AllCluster) | null;
  readonly isBreaking: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

interface ComparisonData {
  readonly similarity: {
    readonly content_similarity: number;
    readonly title_similarity: number;
    readonly overall_match_percent: number;
  };
  readonly entities: {
    readonly source_1: {
      readonly persons: readonly string[];
      readonly organizations: readonly string[];
      readonly locations: readonly string[];
      readonly dates: readonly string[];
    };
    readonly source_2: {
      readonly persons: readonly string[];
      readonly organizations: readonly string[];
      readonly locations: readonly string[];
      readonly dates: readonly string[];
    };
    readonly comparison: {
      readonly common_entities: {
        readonly persons: readonly string[];
        readonly organizations: readonly string[];
        readonly locations: readonly string[];
        readonly dates: readonly string[];
      };
      readonly unique_to_source_1: {
        readonly persons: readonly string[];
        readonly organizations: readonly string[];
        readonly locations: readonly string[];
        readonly dates: readonly string[];
      };
      readonly unique_to_source_2: {
        readonly persons: readonly string[];
        readonly organizations: readonly string[];
        readonly locations: readonly string[];
        readonly dates: readonly string[];
      };
    };
  };
  readonly keywords: {
    readonly source_1_top: readonly { readonly word: string; readonly count: number }[];
    readonly source_2_top: readonly { readonly word: string; readonly count: number }[];
    readonly comparison: {
      readonly common_keywords: readonly {
        readonly keyword: string;
        readonly source_1_freq: number;
        readonly source_2_freq: number;
        readonly difference: number;
        readonly emphasis: string;
      }[];
      readonly unique_to_source_1: readonly {
        readonly keyword: string;
        readonly frequency: number;
      }[];
      readonly unique_to_source_2: readonly {
        readonly keyword: string;
        readonly frequency: number;
      }[];
    };
  };
  readonly diff: {
    readonly added: readonly {
      readonly index: number;
      readonly text: string;
      readonly type: string;
    }[];
    readonly removed: readonly {
      readonly index: number;
      readonly text: string;
      readonly type: string;
    }[];
    readonly similar: readonly {
      readonly source_1_index: number;
      readonly source_2_index: number;
      readonly source_1_text: string;
      readonly source_2_text: string;
      readonly similarity: number;
    }[];
  };
  readonly summary: {
    readonly common_entities_count: number;
    readonly unique_entities_source_1: number;
    readonly unique_entities_source_2: number;
    readonly common_keywords_count: number;
    readonly unique_keywords_source_1: number;
    readonly unique_keywords_source_2: number;
  };
}

const buildComparisonRequestKey = (articleIds: readonly number[]): string =>
  [...articleIds].toSorted((a, b) => a - b).join(":");

const formatSignedNumber = (value?: number | null, digits = 1): string => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }
  const prefix = (() => {
    if (value > 0) {
      return "+";
    }
    return "";
  })();
  return `${prefix}${value.toFixed(digits)}`;
};

interface GdeltContextLike {
  readonly total_events?: number;
  readonly top_cameo?:
    | readonly {
        readonly code?: string | null;
        readonly label?: string | null;
        readonly count: number;
      }[]
    | null;
  readonly goldstein_avg?: number | null;
  readonly goldstein_min?: number | null;
  readonly goldstein_max?: number | null;
  readonly goldstein_bucket?: string | null;
  readonly tone_avg?: number | null;
  readonly tone_delta_vs_cluster?: number | null;
}

const toPct = (value: number, min = -10, max = 10): number => {
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
};

const getGoldsteinMarkerStyle = (value: number): CSSProperties => ({
  left: `calc(${toPct(value)}% - 1px)`,
});

const getGoldsteinRangeStyle = (min: number, max: number): CSSProperties => ({
  left: `${toPct(min)}%`,
  width: `${Math.max(toPct(max) - toPct(min), 2)}%`,
});

const getKeywordShareStyle = (value: number, otherValue: number): CSSProperties => {
  const total = value + otherValue || 1;
  return { width: `${(value / total) * 100}%` };
};

const EMPTY_HIGHLIGHTS: readonly [] = [];

const clusterContextOf = (
  clusterDetail: DeepReadonly<{ gdelt_context?: GdeltContextLike | null }> | null | undefined,
  cluster: Readonly<{ gdelt_context?: GdeltContextLike | null }>,
): GdeltContextLike | null => clusterDetail?.gdelt_context ?? cluster.gdelt_context ?? null;

interface ToneView {
  readonly toneDelta: number | null;
  readonly toneAvg: number | null;
}

const resolveToneView = (
  activeContext: GdeltContextLike | null | undefined,
  clusterContext: GdeltContextLike | null,
): ToneView => ({
  toneAvg: activeContext?.tone_avg ?? clusterContext?.tone_avg ?? null,
  toneDelta: activeContext?.tone_delta_vs_cluster ?? null,
});

const getCameoSummary = (context?: GdeltContextLike | null): string | null => {
  const cameo = context?.top_cameo?.[0];
  if (!cameo) {
    return null;
  }
  const label = cameo.label ?? cameo.code ?? "CAMEO";
  if (cameo.count > 1) {
    return `${label} · ${cameo.count}`;
  }
  return label;
};

interface ComparisonRequestResult {
  readonly contentEntries: readonly (readonly [number, string | null])[];
  readonly data: ComparisonData;
}

type ArticleContentLoader = (article: Pick<ClusterArticle, "id" | "url">) => Promise<string | null>;

const getComparisonPair = (
  articles: readonly ComparisonArticle[],
): readonly [ComparisonArticle, ComparisonArticle] | null => {
  const [sourceOne, sourceTwo] = articles;
  if (sourceOne === undefined || sourceTwo === undefined) {
    return null;
  }
  return [sourceOne, sourceTwo];
};

const loadComparisonContent = async (
  article: { readonly id: number; readonly url: string },
  articleContents: ReadonlyMap<number, string | null>,
  loadArticleContent: ArticleContentLoader,
): Promise<readonly [number, string | null]> => {
  const cachedContent = articleContents.get(article.id);
  if (cachedContent !== undefined) {
    return [article.id, cachedContent];
  }

  try {
    return [article.id, await loadArticleContent(article)];
  } catch (error: unknown) {
    console.error("Failed to extract comparison article:", error);
    return [article.id, null];
  }
};

const requestComparison = async (
  comparisonArticles: readonly ComparisonArticle[],
  articleContents: ReadonlyMap<number, string | null>,
  loadArticleContent: ArticleContentLoader,
): Promise<ComparisonRequestResult> => {
  const comparisonPair = getComparisonPair(comparisonArticles);
  if (comparisonPair === null) {
    throw new Error("Compare Sources needs full text from two articles.");
  }
  const contentEntries = await Promise.all(
    comparisonArticles.map((article) =>
      loadComparisonContent(article, articleContents, loadArticleContent),
    ),
  );
  const contentById = new Map(contentEntries);
  const [sourceOne, sourceTwo] = comparisonPair;
  const content1 = contentById.get(sourceOne.id) ?? "";
  const content2 = contentById.get(sourceTwo.id) ?? "";
  if (content1 === "" || content2 === "") {
    throw new Error("Compare Sources needs full text from two articles.");
  }

  const response = await fetch(`${API_BASE_URL}/compare/articles`, {
    body: JSON.stringify({
      content_1: content1,
      content_2: content2,
      title_1: sourceOne.title,
      title_2: sourceTwo.title,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Comparison failed (${response.status})`);
  }

  const data: ComparisonData = await response.json();
  return { contentEntries, data };
};

const ClusterDetailModal = ({ cluster, isBreaking, isOpen, onClose }: ClusterDetailModalProps) => {
  if (!isOpen || !cluster) {
    return null;
  }

  return (
    <ClusterDetailModalContent
      key={`${cluster.cluster_id}-${(() => {
        if (isOpen) {
          return "open";
        }
        return "closed";
      })()}`}
      cluster={cluster}
      isBreaking={isBreaking}
      onClose={onClose}
    />
  );
};

interface ClusterDetailModalContentProps {
  readonly cluster: TrendingCluster | BreakingCluster | AllCluster;
  readonly isBreaking: boolean;
  readonly onClose: () => void;
}

type ClusterDetailResponse = DeepReadonly<Awaited<ReturnType<typeof fetchClusterDetail>>>;
type ClusterDetailCluster = TrendingCluster | BreakingCluster | AllCluster;

const isBreakingCluster = (cluster: ClusterDetailCluster): cluster is BreakingCluster =>
  "article_count_3h" in cluster;

const getClusterSourceCount = (cluster: ClusterDetailCluster): number => {
  if ("source_diversity" in cluster) {
    return cluster.source_diversity;
  }
  return cluster.source_count_3h;
};

const getClusterArticleCount = (cluster: ClusterDetailCluster): number => {
  if ("article_count" in cluster) {
    return cluster.article_count;
  }
  return 0;
};

const useClusterArticleController = (clusterDetail: ClusterDetailResponse | undefined) => {
  const queryClient = useQueryClient();
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [articleContents, setArticleContents] = useState<Map<number, string | null>>(new Map());
  const [loadingArticle, setLoadingArticle] = useState<number | null>(null);
  const articleContentRef = useRef<HTMLDivElement>(null);
  const resolvedActiveArticleId =
    activeArticleId ?? clusterDetail?.articles?.[0]?.id.toString() ?? null;
  const loadArticleContent = useCallback(
    async (article: Pick<ClusterArticle, "id" | "url">): Promise<string | null> => {
      setLoadingArticle(article.id);
      try {
        const text = await queryClient.fetchQuery<string | null>({
          queryFn: ({ signal }) => fetchArticleContentText(article.url, signal),
          queryKey: articleContentQueryKey(article.url),
          staleTime: 5 * 60 * 1000,
        });
        setArticleContents((previous) => new Map(previous).set(article.id, text));
        return text;
      } catch (error) {
        console.error("Failed to extract article:", error);
        setArticleContents((previous) => new Map(previous).set(article.id, null));
        return null;
      } finally {
        setLoadingArticle(null);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (!hasText(resolvedActiveArticleId) || !clusterDetail) {
      return;
    }
    const article = (clusterDetail.articles ?? []).find(
      (item) => item.id.toString() === resolvedActiveArticleId,
    );
    if (article && !articleContents.has(article.id)) {
      globalThis.queueMicrotask(() => void loadArticleContent(article));
    }
  }, [articleContents, clusterDetail, loadArticleContent, resolvedActiveArticleId]);

  const activeArticle = (clusterDetail?.articles ?? []).find(
    (item) => item.id.toString() === resolvedActiveArticleId,
  );
  return {
    activeArticle,
    activeContent: (() => {
      if (activeArticle) {
        return articleContents.get(activeArticle.id);
      }
      return null;
    })(),
    articleContentRef,
    articleContents,
    loadArticleContent,
    loadingArticle,
    resolvedActiveArticleId,
    setActiveArticleId,
    setArticleContents,
  };
};

interface ClusterComparisonControllerOptions {
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly setArticleContents: Dispatch<SetStateAction<Map<number, string | null>>>;
  readonly loadArticleContent: ArticleContentLoader;
}

const useClusterComparisonController = ({
  articleContents,
  clusterDetail,
  loadArticleContent,
  setArticleContents,
}: ClusterComparisonControllerOptions) => {
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [selectedArticlesForComparison, setSelectedArticlesForComparison] = useState<number[]>([]);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonRequestKey, setComparisonRequestKey] = useState<string | null>(null);
  const comparisonClusterArticles: ComparisonArticle[] = useMemo(
    () => (clusterDetail?.articles ?? []).map((article) => normalizeComparisonArticle(article)),
    [clusterDetail],
  );
  const loadComparisonData = useCallback(
    async (articleIds: readonly number[]) => {
      if (articleIds.length < 2 || !clusterDetail) {
        return;
      }
      const requestKey = buildComparisonRequestKey(articleIds);
      if (comparisonRequestKey === requestKey) {
        return;
      }

      setComparisonError(null);
      const selectedArticles = getSelectedComparisonArticles(comparisonClusterArticles, articleIds);
      const selectedPair = getComparisonPair(selectedArticles);
      if (selectedPair === null) {
        setComparisonData(null);
        setComparisonError("Select one article from two distinct outlets.");
        return;
      }

      const [sourceOne, sourceTwo] = selectedPair;
      if (sourceOne.source.trim().toLowerCase() === sourceTwo.source.trim().toLowerCase()) {
        setComparisonData(null);
        const message = "Compare Sources needs coverage from at least two outlets.";
        setComparisonError(message);
        toast.error(message);
        return;
      }

      setComparisonRequestKey(requestKey);
      setComparisonLoading(true);
      try {
        const { contentEntries, data } = await requestComparison(
          selectedArticles,
          articleContents,
          loadArticleContent,
        );
        setArticleContents((previous) => {
          const next = new Map(previous);
          for (const [articleId, text] of contentEntries) {
            next.set(articleId, text);
          }
          return next;
        });
        setComparisonData(data);
      } catch (error) {
        console.error("Failed to load comparison:", error);
        setComparisonRequestKey(null);
        setComparisonData(null);
        const message = (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return "Failed to compare the selected sources.";
        })();
        setComparisonError(message);
        toast.error(message);
      } finally {
        setComparisonLoading(false);
      }
    },
    [
      articleContents,
      comparisonRequestKey,
      clusterDetail,
      comparisonClusterArticles,
      loadArticleContent,
      setComparisonRequestKey,
      setArticleContents,
    ],
  );
  const handleTabChange = useCallback((value: string) => {
    setComparisonMode(value === "compare");
  }, []);
  const handleOpenComparison = useCallback(() => {
    if (!clusterDetail) {
      return;
    }
    setComparisonError(null);
    const comparisonIds = getDefaultComparisonArticleIds(comparisonClusterArticles);
    if (comparisonIds.length < 2) {
      setComparisonData(null);
      const message = "Compare Sources needs coverage from at least two outlets.";
      setComparisonError(message);
      toast.error(message);
      return;
    }
    setSelectedArticlesForComparison(comparisonIds);
    setComparisonData(null);
    setComparisonMode(true);
    setComparisonRequestKey(null);
  }, [clusterDetail, comparisonClusterArticles, setComparisonRequestKey]);
  const handleComparisonSourceChange = useCallback(
    (sourceId: string, nextArticleId: string) => {
      const parsedId = Number(nextArticleId);
      if (!Number.isFinite(parsedId)) {
        return;
      }
      setSelectedArticlesForComparison((previous) => {
        const nextArticles = getSelectedComparisonArticles(
          comparisonClusterArticles,
          previous,
        ).filter((article) => comparisonArticleSourceId(article) !== sourceId);
        setComparisonRequestKey(null);
        return [...nextArticles.map((article) => article.id), parsedId];
      });
    },
    [comparisonClusterArticles, setComparisonRequestKey],
  );

  useEffect(() => {
    if (comparisonMode && selectedArticlesForComparison.length >= 2) {
      globalThis.queueMicrotask(() => void loadComparisonData(selectedArticlesForComparison));
    }
  }, [comparisonMode, loadComparisonData, selectedArticlesForComparison]);

  return {
    comparisonArticles: (() => {
      if (clusterDetail) {
        return getSelectedComparisonArticles(
          comparisonClusterArticles,
          selectedArticlesForComparison,
        );
      }
      return [];
    })(),
    comparisonData,
    comparisonError,
    comparisonLoading,
    comparisonMode,
    comparisonSourceOptions: (() => {
      if (clusterDetail) {
        return buildComparisonSourceOptions(comparisonClusterArticles);
      }
      return [];
    })(),
    handleComparisonSourceChange,
    handleOpenComparison,
    handleTabChange,
  };
};

interface ClusterDetailViewProps {
  readonly cluster: ClusterDetailCluster;
  readonly isBreaking: boolean;
  readonly label: string;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onClose: () => void;
  readonly context: ComponentProps<typeof GdeltContextStrip> | null;
  readonly loading: boolean;
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly loadError: string | null;
  readonly resolvedActiveArticleId: string | null;
  readonly activeContent: string | null | undefined;
  readonly loadingArticle: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onTabChange: (value: string) => void;
  readonly onOpenComparison: () => void;
  readonly comparison: Readonly<ComparisonTabProps>;
}

const getClusterPanelSize = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "w-full h-full max-w-none max-h-none";
  }
  return "max-w-5xl w-full max-h-[90vh]";
};

interface ClusterTabNavigationProps {
  readonly articles: readonly ClusterArticle[];
  readonly onOpenComparison: () => void;
}

const ClusterTabTrigger = ({ article }: Readonly<{ article: ClusterArticle }>) => (
  <TabsTrigger
    value={article.id.toString()}
    className="data-[state=active]:bg-[var(--news-bg-secondary)] data-[state=active]:border-primary/40 border border-transparent px-4 py-2 text-xs font-medium"
  >
    <Newspaper className="w-3 h-3 mr-2" />
    {article.source}
  </TabsTrigger>
);

const ClusterCompareTabTrigger = ({
  onOpenComparison,
}: Readonly<{ onOpenComparison: () => void }>) => (
  <TabsTrigger
    value="compare"
    className="data-[state=active]:bg-[var(--news-bg-secondary)] data-[state=active]:border-primary/40 border border-transparent px-4 py-2 text-xs font-medium"
    onClick={onOpenComparison}
  >
    <ArrowRightLeft className="w-3 h-3 mr-2" />
    Compare Sources
  </TabsTrigger>
);

const ClusterTabList = ({ articles, onOpenComparison }: ClusterTabNavigationProps) => (
  <TabsList className="h-auto p-1 bg-transparent gap-1">
    {articles.map((article) => (
      <ClusterTabTrigger key={`${article.id}-${article.url}`} article={article} />
    ))}
    <ClusterCompareTabTrigger onOpenComparison={onOpenComparison} />
  </TabsList>
);

const ClusterTabNavigation = ({ articles, onOpenComparison }: ClusterTabNavigationProps) => (
  <div className="border-b border-border/60 px-4 flex-shrink-0 overflow-x-auto">
    <ClusterTabList articles={articles} onOpenComparison={onOpenComparison} />
  </div>
);

interface ClusterArticleTabsProps {
  readonly articles: readonly ClusterArticle[];
  readonly activeArticleId: string | null;
  readonly activeContent: string | null | undefined;
  readonly loadingArticle: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onClose: () => void;
  readonly onTabChange: (value: string) => void;
  readonly onOpenComparison: () => void;
  readonly comparison: Readonly<ComparisonTabProps>;
}

const ClusterArticleTabs = ({
  articles,
  activeArticleId,
  activeContent,
  loadingArticle,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onClose,
  onTabChange,
  onOpenComparison,
  comparison,
}: Readonly<ClusterArticleTabsProps>) => (
  <Tabs
    value={activeArticleId ?? ""}
    onValueChange={onTabChange}
    className="flex-1 flex flex-col overflow-hidden"
  >
    <ClusterTabNavigation articles={articles} onOpenComparison={onOpenComparison} />
    {articles.map((article) => (
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
);

const ClusterLoadingState = () => (
  <div className="flex-1 flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
    <span className="ml-3 text-muted-foreground">Loading sources...</span>
  </div>
);

const ClusterEmptyState = ({ loadError }: Readonly<{ loadError: string | null }>) => (
  <div className="flex-1 flex items-center justify-center text-muted-foreground">
    {loadError ?? "No articles found for this cluster."}
  </div>
);

const ClusterContextMetrics = ({
  context,
}: Readonly<{ context: ComponentProps<typeof GdeltContextStrip> | null }>) => {
  if (context === null) {
    return null;
  }
  return (
    <GdeltContextStrip
      context={context.context}
      cameoSummary={context.cameoSummary}
      toneAvg={context.toneAvg}
      toneDelta={context.toneDelta}
    />
  );
};

const ClusterDetailBody = ({
  loading,
  articles,
  loadError,
  activeArticleId,
  activeContent,
  loadingArticle,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onClose,
  onTabChange,
  onOpenComparison,
  comparison,
}: Readonly<{
  readonly loading: boolean;
  readonly articles: readonly ClusterArticle[];
  readonly loadError: string | null;
  readonly activeArticleId: string | null;
  readonly activeContent: string | null | undefined;
  readonly loadingArticle: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onClose: () => void;
  readonly onTabChange: (value: string) => void;
  readonly onOpenComparison: () => void;
  readonly comparison: Readonly<ComparisonTabProps>;
}>) => {
  if (loading) {
    return <ClusterLoadingState />;
  }
  if (articles.length === 0) {
    return <ClusterEmptyState loadError={loadError} />;
  }
  return (
    <ClusterArticleTabs
      articles={articles}
      activeArticleId={activeArticleId}
      activeContent={activeContent}
      loadingArticle={loadingArticle}
      likedIds={likedIds}
      isArticleInQueue={isArticleInQueue}
      contentRef={contentRef}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
      onClose={onClose}
      onTabChange={onTabChange}
      onOpenComparison={onOpenComparison}
      comparison={comparison}
    />
  );
};

const ClusterDetailPanelContent = (props: DeepReadonly<ClusterDetailViewProps>) => (
  <div className="flex-1 overflow-hidden flex flex-col">
    <ClusterContextMetrics context={props.context} />
    <ClusterDetailBody
      loading={props.loading}
      articles={props.clusterDetail?.articles ?? EMPTY_CLUSTER_ARTICLES}
      loadError={props.loadError}
      activeArticleId={props.resolvedActiveArticleId}
      activeContent={props.activeContent}
      loadingArticle={props.loadingArticle}
      likedIds={props.likedIds}
      isArticleInQueue={props.isArticleInQueue}
      contentRef={props.contentRef}
      onLike={props.onLike}
      onQueueToggle={props.onQueueToggle}
      onClose={props.onClose}
      onTabChange={props.onTabChange}
      onOpenComparison={props.onOpenComparison}
      comparison={props.comparison}
    />
  </div>
);

const ClusterDetailPanel = (props: DeepReadonly<ClusterDetailViewProps>) => (
  <div
    className={`bg-[var(--news-bg-primary)] border border-border/60 rounded-xl shadow-2xl shadow-black/40 transition-all duration-300 animate-in zoom-in-95 fade-in-0 duration-200 flex flex-col ${getClusterPanelSize(props.isExpanded)}`}
  >
    <ClusterHeader
      isBreaking={props.isBreaking}
      label={props.label}
      cluster={props.cluster}
      isExpanded={props.isExpanded}
      onToggleExpand={props.onToggleExpand}
      onClose={props.onClose}
    />
    <ClusterDetailPanelContent
      cluster={props.cluster}
      isBreaking={props.isBreaking}
      label={props.label}
      isExpanded={props.isExpanded}
      onToggleExpand={props.onToggleExpand}
      onClose={props.onClose}
      context={props.context}
      loading={props.loading}
      clusterDetail={props.clusterDetail}
      loadError={props.loadError}
      resolvedActiveArticleId={props.resolvedActiveArticleId}
      activeContent={props.activeContent}
      loadingArticle={props.loadingArticle}
      likedIds={props.likedIds}
      isArticleInQueue={props.isArticleInQueue}
      contentRef={props.contentRef}
      onLike={props.onLike}
      onQueueToggle={props.onQueueToggle}
      onTabChange={props.onTabChange}
      onOpenComparison={props.onOpenComparison}
      comparison={props.comparison}
    />
    <KeywordsFooter keywords={props.cluster.keywords} />
  </div>
);

const ClusterDetailView = ({
  cluster,
  isBreaking,
  label,
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
}: DeepReadonly<ClusterDetailViewProps>) => {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200">
      <ClusterDetailPanel
        cluster={cluster}
        isBreaking={isBreaking}
        label={label}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onClose={onClose}
        context={context}
        loading={loading}
        clusterDetail={clusterDetail}
        loadError={loadError}
        resolvedActiveArticleId={resolvedActiveArticleId}
        activeContent={activeContent}
        loadingArticle={loadingArticle}
        likedIds={likedIds}
        isArticleInQueue={isArticleInQueue}
        contentRef={contentRef}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
        onTabChange={onTabChange}
        onOpenComparison={onOpenComparison}
        comparison={comparison}
      />
    </div>
  );
};

interface ClusterHeaderProps {
  readonly cluster: ClusterDetailCluster;
  readonly isBreaking: boolean;
  readonly label: string;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onClose: () => void;
}

const ClusterHeaderStatus = ({
  cluster,
  isBreaking,
  sourceCount,
}: Readonly<{
  readonly cluster: ClusterDetailCluster;
  readonly isBreaking: boolean;
  readonly sourceCount: number;
}>) => {
  if (isBreaking && isBreakingCluster(cluster)) {
    return (
      <>
        <Badge variant="destructive" className="text-[9px]">
          BREAKING
        </Badge>
        <span>{cluster.article_count_3h} articles in 3h</span>
        <span>|</span>
        <span>{cluster.spike_magnitude?.toFixed(1)}x spike</span>
      </>
    );
  }
  return (
    <>
      <Badge variant="outline" className="text-[9px]">
        TRENDING
      </Badge>
      <span>{getClusterArticleCount(cluster)} articles</span>
      <span>|</span>
      <span>{sourceCount} sources</span>
    </>
  );
};

const ClusterHeaderInfo = ({
  cluster,
  isBreaking,
  label,
}: Readonly<Pick<ClusterHeaderProps, "cluster" | "isBreaking" | "label">>) => {
  const sourceCount = getClusterSourceCount(cluster);
  return (
    <div className="flex items-center gap-3">
      <ClusterHeaderIcon isBreaking={isBreaking} />
      <ClusterHeaderText
        cluster={cluster}
        isBreaking={isBreaking}
        label={label}
        sourceCount={sourceCount}
      />
    </div>
  );
};

const ClusterHeaderText = ({
  cluster,
  isBreaking,
  label,
  sourceCount,
}: Readonly<{
  readonly cluster: ClusterDetailCluster;
  readonly isBreaking: boolean;
  readonly label: string;
  readonly sourceCount: number;
}>) => (
  <div>
    <h2 className="font-serif text-xl font-bold">{label}</h2>
    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
      <ClusterHeaderStatus cluster={cluster} isBreaking={isBreaking} sourceCount={sourceCount} />
    </div>
  </div>
);

const ClusterHeaderIcon = ({ isBreaking }: Readonly<{ isBreaking: boolean }>) => {
  if (isBreaking) {
    return <Zap className="w-5 h-5 text-red-500" />;
  }
  return <TrendingUp className="w-5 h-5 text-primary" />;
};

const ClusterExpandIcon = ({ isExpanded }: Readonly<{ isExpanded: boolean }>) => {
  if (isExpanded) {
    return <Minimize2 className="h-4 w-4" />;
  }
  return <Maximize2 className="h-4 w-4" />;
};

const ClusterHeaderActions = ({
  isExpanded,
  onToggleExpand,
  onClose,
}: Readonly<Pick<ClusterHeaderProps, "isExpanded" | "onToggleExpand" | "onClose">>) => (
  <div className="flex items-center gap-2">
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggleExpand}
      className="bg-[var(--news-bg-secondary)]/70 hover:bg-[var(--news-bg-secondary)] border border-border/60"
    >
      <ClusterExpandIcon isExpanded={isExpanded} />
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
);

const ClusterHeader = (props: DeepReadonly<ClusterHeaderProps>) => (
  <div className="flex items-center justify-between p-4 border-b border-border/60 flex-shrink-0">
    <ClusterHeaderInfo cluster={props.cluster} isBreaking={props.isBreaking} label={props.label} />
    <ClusterHeaderActions
      isExpanded={props.isExpanded}
      onToggleExpand={props.onToggleExpand}
      onClose={props.onClose}
    />
  </div>
);

interface GdeltContextStripProps {
  readonly context: GdeltContextLike;
  readonly cameoSummary: string | null;
  readonly toneAvg: number | null;
  readonly toneDelta: number | null;
}

const GdeltMetricGrid = ({ context, cameoSummary, toneAvg, toneDelta }: GdeltContextStripProps) => (
  <div className="grid gap-3 md:grid-cols-3">
    <GdeltCameoMetric context={context} summary={cameoSummary} />
    <GdeltGoldsteinMetric context={context} />
    <GdeltToneMetric context={context} toneAvg={toneAvg} toneDelta={toneDelta} />
  </div>
);

const GdeltContextStrip = (props: GdeltContextStripProps) => (
  <div className="border-b border-border/60 bg-[var(--news-bg-secondary)]/40 px-4 py-4">
    <GdeltMetricGrid
      context={props.context}
      cameoSummary={props.cameoSummary}
      toneAvg={props.toneAvg}
      toneDelta={props.toneDelta}
    />
  </div>
);

const GdeltCameoValue = ({
  context,
  summary,
}: Readonly<Pick<GdeltCameoMetricProps, "context" | "summary">>) => {
  if (hasText(summary)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-primary/15 text-primary hover:bg-primary/15">{summary}</Badge>
        <span className="text-xs text-muted-foreground">{context.total_events} events</span>
      </div>
    );
  }
  return <span className="text-sm text-muted-foreground">No event root data</span>;
};

interface GdeltCameoMetricProps {
  readonly context: GdeltContextLike;
  readonly summary: string | null;
}

const GdeltCameoMetric = ({ context, summary }: GdeltCameoMetricProps) => (
  <div className="rounded-lg border border-border/50 bg-[var(--news-bg-primary)]/80 p-3">
    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
      CAMEO
    </div>
    <GdeltCameoValue context={context} summary={summary} />
  </div>
);

const GdeltBucketBadge = ({ bucket }: Readonly<{ bucket: string | null | undefined }>) => {
  if (!hasText(bucket)) {
    return null;
  }
  return (
    <Badge variant="outline" className="border-border/60 text-[9px] uppercase tracking-[0.2em]">
      {bucket}
    </Badge>
  );
};

const GdeltGoldsteinHeader = ({ context }: Readonly<{ context: GdeltContextLike }>) => (
  <div className="mb-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
    <span>Goldstein</span>
    <GdeltBucketBadge bucket={context.goldstein_bucket} />
  </div>
);

const GdeltGoldsteinBar = ({
  context,
  hasRange,
  markerStyle,
}: Readonly<{
  readonly context: GdeltContextLike;
  readonly hasRange: boolean;
  readonly markerStyle: Readonly<CSSProperties> | undefined;
}>) => (
  <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/5">
    {hasRange && <GdeltGoldsteinRange context={context} />}
    {context.goldstein_avg !== undefined && context.goldstein_avg !== null && (
      <div
        className="absolute top-[-3px] h-4 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.45)]"
        style={markerStyle}
      />
    )}
  </div>
);

const GdeltMetricValues = ({ context }: Readonly<{ context: GdeltContextLike }>) => (
  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
    <span>{formatMetricNumber(context.goldstein_min)}</span>
    <span className="font-medium text-foreground/80">
      {formatMetricNumber(context.goldstein_avg)}
    </span>
    <span>{formatMetricNumber(context.goldstein_max)}</span>
  </div>
);

const GdeltGoldsteinMetric = ({ context }: DeepReadonly<{ context: GdeltContextLike }>) => {
  const hasRange =
    context.goldstein_min !== undefined &&
    context.goldstein_min !== null &&
    context.goldstein_max !== undefined &&
    context.goldstein_max !== null;
  const markerStyle = (() => {
    if (context.goldstein_avg === undefined || context.goldstein_avg === null) {
      return void 0;
    }
    return getGoldsteinMarkerStyle(context.goldstein_avg);
  })();
  return (
    <div className="rounded-lg border border-border/50 bg-[var(--news-bg-primary)]/80 p-3">
      <GdeltGoldsteinHeader context={context} />
      <GdeltGoldsteinBar context={context} hasRange={hasRange} markerStyle={markerStyle} />
      <GdeltMetricValues context={context} />
    </div>
  );
};

const GdeltGoldsteinRange = ({ context }: DeepReadonly<{ context: GdeltContextLike }>) => {
  const { goldstein_max: max, goldstein_min: min } = context;
  if (min === undefined || min === null || max === undefined || max === null) {
    return null;
  }
  const rangeStyle = getGoldsteinRangeStyle(min, max);
  return (
    <div
      className="absolute top-0 h-full rounded-full bg-gradient-to-r from-red-500/60 via-amber-400/70 to-emerald-500/60"
      style={rangeStyle}
    />
  );
};

const formatMetricNumber = (value: number | null | undefined): string =>
  (() => {
    if (value === undefined || value === null) {
      return "—";
    }
    return value.toFixed(1);
  })();

const GdeltToneLabel = ({ toneDelta }: Readonly<{ toneDelta: number | null }>) => {
  if (toneDelta === null) {
    return <span className="pb-1 text-xs text-muted-foreground">cluster avg</span>;
  }
  return <span className="pb-1 text-xs text-muted-foreground">vs cluster</span>;
};

const GdeltToneDetail = ({
  context,
  toneDelta,
}: Readonly<{ context: GdeltContextLike; toneDelta: number | null }>) => {
  if (toneDelta === null) {
    if (context.tone_avg !== undefined && context.tone_avg !== null) {
      return <span>Cluster avg {context.tone_avg.toFixed(2)}</span>;
    }
    return <span>No tone data</span>;
  }
  let toneClass = "text-red-400";
  if (toneDelta >= 0) {
    toneClass = "text-emerald-400";
  }
  return <span className={toneClass}>{formatSignedNumber(toneDelta, 2)}</span>;
};

const GdeltToneMetric = ({
  context,
  toneAvg,
  toneDelta,
}: DeepReadonly<{
  context: GdeltContextLike;
  toneAvg: number | null;
  toneDelta: number | null;
}>) => (
  <div className="rounded-lg border border-border/50 bg-[var(--news-bg-primary)]/80 p-3">
    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
      Tone
    </div>
    <div className="flex items-end gap-2">
      <span className="font-serif text-2xl text-foreground">{formatSignedNumber(toneAvg, 2)}</span>
      <GdeltToneLabel toneDelta={toneDelta} />
    </div>
    <div className="mt-2 text-xs text-muted-foreground">
      <GdeltToneDetail context={context} toneDelta={toneDelta} />
    </div>
  </div>
);

interface ArticleTabProps {
  readonly article: ClusterArticle;
  readonly activeContent: string | null | undefined;
  readonly loadingArticleId: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: RefObject<HTMLDivElement | null>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onClose: () => void;
}

const ArticleTab = ({
  article,
  activeContent,
  loadingArticleId,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onClose,
}: DeepReadonly<ArticleTabProps>) => (
  <TabsContent value={article.id.toString()} className="flex-1 overflow-y-auto m-0 p-0">
    <ArticleTabPanel
      article={article}
      activeContent={activeContent}
      loadingArticleId={loadingArticleId}
      likedIds={likedIds}
      isArticleInQueue={isArticleInQueue}
      contentRef={contentRef}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
      onClose={onClose}
    />
  </TabsContent>
);

const ArticleTabPanel = (props: DeepReadonly<ArticleTabProps>) => (
  <div className="p-6 space-y-6">
    <ArticleTabHeader article={props.article} onClose={props.onClose} />
    <ArticleTabBody
      article={props.article}
      activeContent={props.activeContent}
      contentRef={props.contentRef}
      loadingArticleId={props.loadingArticleId}
    />
    <ArticleTabActions
      article={props.article}
      isArticleInQueue={props.isArticleInQueue}
      likedIds={props.likedIds}
      onLike={props.onLike}
      onQueueToggle={props.onQueueToggle}
    />
  </div>
);

const ArticleHeaderSourceBadge = ({ source }: Readonly<{ source: string }>) => (
  <div className="absolute top-3 left-3">
    <Badge
      variant="outline"
      className="text-[10px] font-semibold px-2 py-0.5 bg-black/70 text-white border-white/30 uppercase tracking-wider"
    >
      {source}
    </Badge>
  </div>
);

const ArticleHeaderImage = ({ article }: Readonly<{ article: ClusterArticle }>) => {
  if (!isUsableImage(article.image_url)) {
    return null;
  }
  return (
    <div className="relative aspect-video max-h-[300px] overflow-hidden rounded-lg mb-6">
      <SafeImage
        src={article.image_url}
        alt={article.title}
        fill
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <ArticleHeaderSourceBadge source={article.source} />
    </div>
  );
};

const getArticleMatchLabel = (similarity: number | null | undefined): string => {
  if (similarity === null || similarity === undefined) {
    return "Match unavailable";
  }
  return `${Math.round(similarity * 100)}% match`;
};

const ArticleMatchBadge = ({ similarity }: Readonly<{ similarity: number | null | undefined }>) => (
  <Badge variant="outline" className="text-[9px]">
    {getArticleMatchLabel(similarity)}
  </Badge>
);

const ArticleDate = ({ publishedAt }: Readonly<{ publishedAt?: string | null }>) => (
  <span className="flex items-center gap-1">
    <Clock className="w-3 h-3" />
    {formatArticleDateTime(publishedAt)}
  </span>
);

const ArticleHeaderMetadata = ({
  article,
  onClose,
}: DeepReadonly<Pick<ArticleTabProps, "article" | "onClose">>) => {
  const handleSourceClick: MouseEventHandler<HTMLAnchorElement> = useCallback(
    (event) => {
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Link
        href={`/source/${encodeURIComponent(
          article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
        )}`}
        className="font-medium hover:text-primary transition-colors"
        onClick={handleSourceClick}
      >
        {article.source}
      </Link>
      <span>|</span>
      <ArticleDate publishedAt={article.published_at} />
      <ArticleMatchBadge similarity={article.similarity} />
    </div>
  );
};

const ArticleTabHeader = ({
  article,
  onClose,
}: DeepReadonly<Pick<ArticleTabProps, "article" | "onClose">>) => (
  <div>
    <ArticleHeaderImage article={article} />
    <h3 className="font-serif text-2xl font-bold mb-3">{article.title}</h3>
    <ArticleHeaderMetadata article={article} onClose={onClose} />
    {article.gdelt_context && <ArticleGdeltBadges context={article.gdelt_context} />}
  </div>
);

const ArticleGdeltBadges = ({ context }: DeepReadonly<{ context: GdeltContextLike }>) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.18em]">
      {getCameoSummary(context) ?? "GDELT"}
    </Badge>
    {context.tone_delta_vs_cluster !== undefined && context.tone_delta_vs_cluster !== null && (
      <Badge
        className={`text-[10px] uppercase tracking-[0.18em] ${(() => {
          if (context.tone_delta_vs_cluster >= 0) {
            return "bg-emerald-500/15 text-emerald-300";
          }
          return "bg-red-500/15 text-red-300";
        })()}`}
      >
        Tone {formatSignedNumber(context.tone_delta_vs_cluster, 2)}
      </Badge>
    )}
  </div>
);

const ArticleTabBody = ({
  article,
  activeContent,
  contentRef,
  loadingArticleId,
}: DeepReadonly<{
  readonly article: ClusterArticle;
  readonly activeContent: string | null | undefined;
  readonly contentRef: RefObject<HTMLDivElement | null>;
  readonly loadingArticleId: number | null;
}>) => {
  if (loadingArticleId === article.id) {
    return (
      <div ref={contentRef} className="prose prose-invert max-w-none">
        <ArticleLoadingState />
      </div>
    );
  }
  return (
    <div ref={contentRef} className="prose prose-invert max-w-none">
      <ArticleContent
        content={activeContent ?? "Loading article content..."}
        highlights={EMPTY_HIGHLIGHTS}
        className="text-base space-y-4"
      />
    </div>
  );
};

const ArticleLoadingState = () => (
  <div className="flex items-center gap-3 p-6 bg-[var(--news-bg-secondary)]/60 rounded-lg border border-border/60">
    <Loader2 className="w-5 h-5 animate-spin text-primary" />
    <span className="text-muted-foreground">Loading full article...</span>
  </div>
);

const ArticleLikeButton = ({
  liked,
  onLike,
}: Readonly<{
  readonly liked: boolean;
  readonly onLike: () => void;
}>) => (
  <Button
    variant="ghost"
    size="sm"
    onClick={onLike}
    className={(() => {
      if (liked) {
        return "text-red-400";
      }
      return "text-gray-400";
    })()}
  >
    <Heart
      className={`h-4 w-4 mr-2 ${(() => {
        if (liked) {
          return "fill-current";
        }
        return "";
      })()}`}
    />
    Like
  </Button>
);

const ArticleQueueIcon = ({ inQueue }: Readonly<{ inQueue: boolean }>) => {
  if (inQueue) {
    return <MinusCircle className="h-4 w-4 mr-2" />;
  }
  return <PlusCircle className="h-4 w-4 mr-2" />;
};

const ArticleQueueButton = ({
  articleInQueue,
  onQueueToggle,
}: Readonly<{
  readonly articleInQueue: boolean;
  readonly onQueueToggle: () => void;
}>) => {
  let className = "text-gray-400";
  let label = "Add to Queue";
  if (articleInQueue) {
    className = "text-blue-400";
    label = "Remove";
  }
  return (
    <Button variant="ghost" size="sm" onClick={onQueueToggle} className={className}>
      <ArticleQueueIcon inQueue={articleInQueue} />
      {label}
    </Button>
  );
};

const ArticleActionButtons = ({
  articleInQueue,
  liked,
  onLike,
  onQueueToggle,
}: Readonly<{
  readonly articleInQueue: boolean;
  readonly liked: boolean;
  readonly onLike: () => void;
  readonly onQueueToggle: () => void;
}>) => (
  <div className="flex items-center gap-3">
    <ArticleLikeButton liked={liked} onLike={onLike} />
    <ArticleQueueButton articleInQueue={articleInQueue} onQueueToggle={onQueueToggle} />
  </div>
);

const ArticleReadOriginalButton = ({ url }: Readonly<{ url: string }>) => (
  <Button variant="outline" size="sm" asChild>
    <ArticleOriginalAnchor url={url} />
  </Button>
);

const ArticleOriginalAnchor = ({ url }: Readonly<{ url: string }>) => (
  <a href={url} target="_blank" rel="noopener noreferrer">
    <ExternalLink className="h-4 w-4 mr-2" />
    Read Original
  </a>
);

const ArticleTabActions = ({
  article,
  isArticleInQueue,
  likedIds,
  onLike,
  onQueueToggle,
}: DeepReadonly<
  Pick<ArticleTabProps, "article" | "isArticleInQueue" | "likedIds" | "onLike" | "onQueueToggle">
>) => {
  const handleLikeClick = useCallback(() => {
    onLike(article.id);
  }, [article.id, onLike]);
  const handleQueueClick = useCallback(() => {
    onQueueToggle(article);
  }, [article, onQueueToggle]);
  const articleInQueue = isArticleInQueue(article.url);
  return (
    <div className="flex items-center justify-between pt-6 border-t border-border/60">
      <ArticleActionButtons
        articleInQueue={articleInQueue}
        liked={likedIds.has(article.id)}
        onLike={handleLikeClick}
        onQueueToggle={handleQueueClick}
      />
      <ArticleReadOriginalButton url={article.url} />
    </div>
  );
};

interface ComparisonArticleColumnProps {
  readonly article: ComparisonArticle;
  readonly isFirst: boolean;
  readonly content: string | null | undefined;
  readonly loading: boolean;
  readonly comparisonData: ComparisonData;
}

const ComparisonArticleImage = ({ article }: Readonly<{ article: ComparisonArticle }>) => {
  if (!isUsableImage(article.image_url)) {
    return null;
  }
  return (
    <div className="relative aspect-video max-h-[150px] overflow-hidden rounded-lg mb-3">
      <SafeImage
        src={article.image_url || undefined}
        alt={article.title}
        fill
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
    </div>
  );
};

const ComparisonArticleMetadata = ({ article }: Readonly<{ article: ComparisonArticle }>) => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <ArticleDate publishedAt={article.published_at} />
    <ArticleMatchBadge similarity={article.similarity} />
  </div>
);

const ComparisonArticleHeader = ({ article }: Readonly<{ article: ComparisonArticle }>) => (
  <div className="bg-[var(--news-bg-secondary)] p-4 rounded-lg border border-border/60">
    <ComparisonArticleImage article={article} />
    <h4 className="font-serif text-lg font-bold">{article.source}</h4>
    <ComparisonArticleMetadata article={article} />
  </div>
);

const ComparisonSimilarItem = ({
  item,
  isFirst,
}: Readonly<{
  readonly item: ComparisonData["diff"]["similar"][number];
  readonly isFirst: boolean;
}>) => {
  let className = "border-l-orange-500 bg-orange-500/5";
  let text = item.source_2_text;
  if (isFirst) {
    className = "border-l-green-500 bg-green-500/5";
    text = item.source_1_text;
  }
  return (
    <div
      className={`p-2 rounded border-l-2 ${className}`}
      key={`${item.source_1_index}-${item.source_2_index}`}
    >
      <div className="text-[10px] text-muted-foreground mb-1">
        Similarity: {Math.round(item.similarity * 100)}%
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
};

const ComparisonUniqueItem = ({
  item,
}: Readonly<{ item: ComparisonData["diff"]["added"][number] }>) => (
  <div
    key={`unique-${item.index}-${item.text}`}
    className="p-2 rounded border-l-2 border-l-gray-500 bg-gray-500/5 opacity-70"
  >
    <div className="text-[10px] text-muted-foreground mb-1">Unique content</div>
    <p className="text-sm">{item.text}</p>
  </div>
);

const ComparisonDiffEntries = ({
  comparisonData,
  isFirst,
}: Readonly<{ comparisonData: ComparisonData; isFirst: boolean }>) => {
  let uniqueItems = comparisonData.diff.added;
  if (isFirst) {
    uniqueItems = comparisonData.diff.removed;
  }
  return (
    <div className="space-y-2 text-sm">
      {comparisonData.diff.similar.slice(0, 5).map((item) => (
        <ComparisonSimilarItem
          key={`${item.source_1_index}-${item.source_2_index}`}
          item={item}
          isFirst={isFirst}
        />
      ))}
      {uniqueItems.slice(0, 3).map((item) => (
        <ComparisonUniqueItem key={`unique-${item.index}-${item.text}`} item={item} />
      ))}
    </div>
  );
};

const ComparisonLoadingState = () => (
  <div className="flex items-center gap-2 p-4">
    <Loader2 className="w-5 h-5 animate-spin text-primary" />
    <span className="text-muted-foreground text-sm">Loading...</span>
  </div>
);

const ComparisonArticleContent = ({
  isFirst,
  content,
  loading,
  comparisonData,
}: Pick<ComparisonArticleColumnProps, "isFirst" | "content" | "loading" | "comparisonData">) => {
  if (loading) {
    return <ComparisonLoadingState />;
  }
  if (!hasText(content)) {
    return <div className="text-sm text-muted-foreground">No content available</div>;
  }
  return <ComparisonDiffEntries comparisonData={comparisonData} isFirst={isFirst} />;
};

const ComparisonArticleOriginalButton = ({ url }: Readonly<{ url: string }>) => (
  <Button variant="outline" size="sm" asChild className="text-xs">
    <ArticleOriginalAnchor url={url} />
  </Button>
);

const ComparisonArticleActions = ({ url }: Readonly<{ url: string }>) => (
  <div className="flex items-center gap-2">
    <ComparisonArticleOriginalButton url={url} />
  </div>
);

const ComparisonArticleColumn = ({
  article,
  isFirst,
  content,
  loading,
  comparisonData,
}: ComparisonArticleColumnProps) => (
  <div className="space-y-4">
    <ComparisonArticleHeader article={article} />
    <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
      <h5 className="font-bold mb-3 text-sm">{article.title}</h5>
      <ComparisonArticleContent
        isFirst={isFirst}
        content={content}
        loading={loading}
        comparisonData={comparisonData}
      />
    </div>
    <ComparisonArticleActions url={article.url} />
  </div>
);

interface EntitiesBlockProps {
  readonly comparisonData: ComparisonData;
  readonly primarySource: string;
  readonly secondarySource: string;
}

type EntityValues = Readonly<{
  readonly persons: readonly string[];
  readonly organizations: readonly string[];
}>;

const getEntityBadgeVariant = (outline: boolean): "default" | "outline" => {
  if (outline) {
    return "outline";
  }
  return "default";
};

const getEntityBadgeClass = (outline: boolean): string => {
  if (outline) {
    return "text-[9px] mr-1";
  }
  return "text-[10px] bg-green-500/20 text-green-400 border-green-500/40";
};

const EntityBadgeList = ({
  values,
  prefix,
  outline,
}: Readonly<{
  readonly values: readonly string[];
  readonly prefix: string;
  readonly outline: boolean;
}>) => (
  <div className="flex flex-wrap gap-1 mt-1">
    {values.map((value) => (
      <Badge
        key={`${prefix}-${value}`}
        variant={getEntityBadgeVariant(outline)}
        className={getEntityBadgeClass(outline)}
      >
        {value}
      </Badge>
    ))}
  </div>
);

const CommonEntityGroup = ({
  label,
  values,
  prefix,
}: Readonly<{
  readonly label: string;
  readonly values: readonly string[];
  readonly prefix: string;
}>) => {
  if (values.length === 0) {
    return null;
  }
  return (
    <div className="mb-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <EntityBadgeList values={values} prefix={prefix} outline={false} />
    </div>
  );
};

const getUniqueEntityValues = (entities: EntityValues): readonly string[] => [
  ...entities.persons.slice(0, 3),
  ...entities.organizations.slice(0, 3),
];

const UniqueEntityColumn = ({
  source,
  entities,
  prefix,
}: Readonly<{
  readonly source: string;
  readonly entities: EntityValues;
  readonly prefix: string;
}>) => (
  <div>
    <span className="text-xs text-muted-foreground block mb-2">Unique to {source}:</span>
    <EntityBadgeList values={getUniqueEntityValues(entities)} prefix={prefix} outline />
  </div>
);

const UniqueEntitiesGrid = ({
  comparisonData,
  primarySource,
  secondarySource,
}: EntitiesBlockProps) => (
  <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border/60">
    <UniqueEntityColumn
      source={primarySource}
      entities={comparisonData.entities.comparison.unique_to_source_1}
      prefix="source-one"
    />
    <UniqueEntityColumn
      source={secondarySource}
      entities={comparisonData.entities.comparison.unique_to_source_2}
      prefix="source-two"
    />
  </div>
);

const EntitiesHeading = ({ count }: Readonly<{ count: number }>) => (
  <h4 className="font-bold mb-4 flex items-center gap-2">
    <span>Named Entities</span>
    <Badge variant="outline" className="text-[10px]">
      {count} shared
    </Badge>
  </h4>
);

const EntitiesBlock = ({ comparisonData, primarySource, secondarySource }: EntitiesBlockProps) => {
  const commonEntities = comparisonData.entities.comparison.common_entities;
  return (
    <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
      <EntitiesHeading count={comparisonData.summary.common_entities_count} />
      <CommonEntityGroup label="Common People:" values={commonEntities.persons} prefix="person" />
      <CommonEntityGroup
        label="Common Organizations:"
        values={commonEntities.organizations}
        prefix="organization"
      />
      <UniqueEntitiesGrid
        comparisonData={comparisonData}
        primarySource={primarySource}
        secondarySource={secondarySource}
      />
    </div>
  );
};

interface KeywordsBlockProps {
  readonly comparisonData: ComparisonData;
  readonly primarySource: string;
  readonly secondarySource: string;
}

type CommonKeyword = ComparisonData["keywords"]["comparison"]["common_keywords"][number];
type UniqueKeyword = ComparisonData["keywords"]["comparison"]["unique_to_source_1"][number];

const KeywordShareBar = ({ keyword }: Readonly<{ keyword: CommonKeyword }>) => (
  <div className="flex-1 h-4 bg-[var(--news-bg-primary)] rounded-full overflow-hidden flex">
    <div
      className="h-full bg-blue-500/60"
      style={getKeywordShareStyle(keyword.source_1_freq, keyword.source_2_freq)}
    />
    <div
      className="h-full bg-orange-500/60"
      style={getKeywordShareStyle(keyword.source_2_freq, keyword.source_1_freq)}
    />
  </div>
);

const getKeywordEmphasisClass = (emphasis: string): string => {
  if (emphasis === "source_1") {
    return "bg-blue-500/20 text-blue-400";
  }
  return "bg-orange-500/20 text-orange-400";
};

const KeywordEmphasisBadge = ({
  keyword,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly keyword: CommonKeyword;
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => {
  if (keyword.emphasis === "equal") {
    return null;
  }
  let source = secondarySource;
  if (keyword.emphasis === "source_1") {
    source = primarySource;
  }
  return (
    <Badge className={`text-[9px] ${getKeywordEmphasisClass(keyword.emphasis)}`}>
      {source.slice(0, 8)}
    </Badge>
  );
};

const CommonKeywordRow = ({
  keyword,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly keyword: CommonKeyword;
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-20 font-medium">{keyword.keyword}</span>
    <KeywordShareBar keyword={keyword} />
    <span className="w-8 text-right text-[10px] text-muted-foreground">
      {keyword.source_1_freq} vs {keyword.source_2_freq}
    </span>
    <KeywordEmphasisBadge
      keyword={keyword}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </div>
);

const CommonKeywords = ({
  keywords,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly keywords: readonly CommonKeyword[];
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => {
  if (keywords.length === 0) {
    return null;
  }
  return (
    <div className="mb-4">
      <span className="text-xs text-muted-foreground">Common Keywords (with emphasis):</span>
      <div className="mt-2 space-y-1">
        {keywords.slice(0, 8).map((keyword) => (
          <CommonKeywordRow
            key={keyword.keyword}
            keyword={keyword}
            primarySource={primarySource}
            secondarySource={secondarySource}
          />
        ))}
      </div>
    </div>
  );
};

const UniqueKeywordList = ({
  keywords,
  prefix,
}: Readonly<{ keywords: readonly UniqueKeyword[]; prefix: string }>) => (
  <div className="flex flex-wrap gap-1 mt-1">
    {keywords.slice(0, 6).map((keyword) => (
      <Badge key={`${prefix}-${keyword.keyword}`} variant="outline" className="text-[9px]">
        {keyword.keyword} ({keyword.frequency})
      </Badge>
    ))}
  </div>
);

const UniqueKeywordColumn = ({
  source,
  keywords,
  prefix,
}: Readonly<{
  readonly source: string;
  readonly keywords: readonly UniqueKeyword[];
  readonly prefix: string;
}>) => (
  <div>
    <span className="text-xs text-muted-foreground">Unique to {source}:</span>
    <UniqueKeywordList keywords={keywords} prefix={prefix} />
  </div>
);

const UniqueKeywordsGrid = ({
  comparisonData,
  primarySource,
  secondarySource,
}: KeywordsBlockProps) => (
  <div className="grid grid-cols-2 gap-3">
    <UniqueKeywordColumn
      source={primarySource}
      keywords={comparisonData.keywords.comparison.unique_to_source_1}
      prefix="source-one"
    />
    <UniqueKeywordColumn
      source={secondarySource}
      keywords={comparisonData.keywords.comparison.unique_to_source_2}
      prefix="source-two"
    />
  </div>
);

const KeywordsBlock = ({ comparisonData, primarySource, secondarySource }: KeywordsBlockProps) => (
  <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
    <h4 className="font-bold mb-4">Keyword Analysis</h4>
    <CommonKeywords
      keywords={comparisonData.keywords.comparison.common_keywords}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
    <UniqueKeywordsGrid
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </div>
);

interface ComparisonSummaryProps {
  readonly comparisonData: ComparisonData;
  readonly primarySource: string;
  readonly secondarySource: string;
}

const ComparisonSummary = ({
  comparisonData,
  primarySource,
  secondarySource,
}: ComparisonSummaryProps) => (
  <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
    <h4 className="font-bold mb-4">Comparison Summary</h4>
    <ComparisonSummaryGrid
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </div>
);

const ComparisonSummaryMetric = ({
  value,
  label,
  className,
}: Readonly<{ value: number; label: string; className: string }>) => (
  <div className="text-center">
    <div className={`text-2xl font-bold ${className}`}>{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

const ComparisonSummaryGrid = ({
  comparisonData,
  primarySource,
  secondarySource,
}: ComparisonSummaryProps) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
    <ComparisonSummaryMetric
      value={comparisonData.summary.common_entities_count}
      label="Common Entities"
      className="text-green-400"
    />
    <ComparisonSummaryMetric
      value={comparisonData.summary.unique_entities_source_1}
      label={`Unique to ${primarySource}`}
      className="text-blue-400"
    />
    <ComparisonSummaryMetric
      value={comparisonData.summary.unique_entities_source_2}
      label={`Unique to ${secondarySource}`}
      className="text-orange-400"
    />
    <ComparisonSummaryMetric
      value={comparisonData.summary.common_keywords_count}
      label="Common Keywords"
      className="text-primary"
    />
  </div>
);

interface KeywordsFooterProps {
  readonly keywords: readonly string[];
}

const KeywordsFooter = ({ keywords }: KeywordsFooterProps) => {
  if (keywords.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-border/60 px-4 py-3 flex-shrink-0">
      <KeywordsFooterContent keywords={keywords} />
    </div>
  );
};

const KeywordsFooterContent = ({ keywords }: KeywordsFooterProps) => (
  <div className="flex items-center gap-2 flex-wrap">
    <span className="text-xs text-muted-foreground">Keywords:</span>
    <KeywordsFooterBadges keywords={keywords} />
  </div>
);

const KeywordsFooterBadges = ({ keywords }: KeywordsFooterProps) => (
  <>
    {keywords.slice(0, 8).map((keyword) => (
      <Badge key={keyword} variant="outline" className="text-[10px] bg-[var(--news-bg-secondary)]">
        {keyword}
      </Badge>
    ))}
  </>
);

interface ComparisonTabProps {
  readonly comparisonMode: boolean;
  readonly comparisonSourceOptions: readonly ComparisonSourceOption<ComparisonArticle>[];
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly comparisonError: string | null;
  readonly comparisonData: ComparisonData | null;
  readonly comparisonLoading: boolean;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly loadingArticle: number | null;
  readonly detailArticleCount: number | null;
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}

const comparisonArticleSourceId = (article: ComparisonArticle): string =>
  article.source_id ?? article.source.trim().toLowerCase().replaceAll(/\s+/gu, "-");

interface ComparisonSourceSelectProps {
  readonly selectedArticleId: string | undefined;
  readonly sourceOption: ComparisonSourceOption<ComparisonArticle>;
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}

const ComparisonSourceSelect = ({
  selectedArticleId,
  sourceOption,
  onSourceChange,
}: DeepReadonly<ComparisonSourceSelectProps>) => {
  const handleValueChange = useCallback(
    (value: string) => {
      onSourceChange(sourceOption.sourceId, value);
    },
    [onSourceChange, sourceOption.sourceId],
  );
  return (
    <Select value={selectedArticleId} onValueChange={handleValueChange}>
      <ComparisonSelectTrigger />
      <ComparisonSelectContent articles={sourceOption.articles} />
    </Select>
  );
};

const ComparisonSelectTrigger = () => (
  <SelectTrigger className="w-full border-border/60 bg-[var(--news-bg-primary)] text-left text-xs">
    <SelectValue placeholder="Choose article" />
  </SelectTrigger>
);

const ComparisonSelectContent = ({
  articles,
}: Readonly<{ articles: readonly ComparisonArticle[] }>) => (
  <SelectContent>
    {articles.map((article) => (
      <SelectItem key={`${article.id}-${article.url}`} value={article.id.toString()}>
        {article.title}
      </SelectItem>
    ))}
  </SelectContent>
);

const ComparisonSourceOptionCard = ({
  sourceOption,
  selectedArticleId,
  onSourceChange,
}: Readonly<{
  readonly sourceOption: ComparisonSourceOption<ComparisonArticle>;
  readonly selectedArticleId: string | undefined;
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}>) => (
  <div className="space-y-2">
    <div className="text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">
      Outlet
    </div>
    <div className="text-sm font-medium text-foreground">{sourceOption.sourceName}</div>
    <ComparisonSourceSelect
      selectedArticleId={selectedArticleId}
      sourceOption={sourceOption}
      onSourceChange={onSourceChange}
    />
  </div>
);

const ComparisonSourcePicker = ({
  articles,
  options,
  onSourceChange,
}: Readonly<{
  readonly articles: readonly ComparisonArticle[];
  readonly options: readonly ComparisonSourceOption<ComparisonArticle>[];
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}>) => (
  <div className="grid gap-4 border border-border/50 bg-[var(--news-bg-secondary)]/70 p-4 md:grid-cols-2">
    {options.slice(0, 2).map((sourceOption) => {
      const selectedArticleId = articles
        .find((article) => comparisonArticleSourceId(article) === sourceOption.sourceId)
        ?.id?.toString();
      return (
        <ComparisonSourceOptionCard
          key={sourceOption.sourceId}
          sourceOption={sourceOption}
          selectedArticleId={selectedArticleId}
          onSourceChange={onSourceChange}
        />
      );
    })}
  </div>
);

const ComparisonPairHeader = ({
  comparisonData,
  primaryArticle,
  secondaryArticle,
}: Readonly<{
  comparisonData: ComparisonData | null;
  primaryArticle: ComparisonArticle;
  secondaryArticle: ComparisonArticle;
}>) => (
  <div className="mb-6 text-center">
    <h3 className="mb-2 font-serif text-2xl font-bold">
      Compare: {primaryArticle.source} vs {secondaryArticle.source}
    </h3>
    <p className="text-sm text-muted-foreground">How different sources report the same story</p>
    {comparisonData !== null && (
      <ComparisonSimilarityBadge value={comparisonData.similarity.overall_match_percent} />
    )}
  </div>
);

const ComparisonSimilarityBadge = ({ value }: Readonly<{ value: number }>) => {
  const color = (() => {
    if (value > 70) {
      return "text-green-400";
    }
    return (() => {
      if (value > 40) {
        return "text-yellow-400";
      }
      return "text-red-400";
    })();
  })();
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--news-bg-secondary)] px-3 py-1 text-xs">
      <span>Content Similarity:</span>
      <span className={`font-bold ${color}`}>{value}%</span>
    </div>
  );
};

const ComparisonResults = ({
  comparisonData,
  comparisonError,
  comparisonLoading,
  articleContents,
  comparisonArticles,
  loadingArticle,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly comparisonData: ComparisonData | null;
  readonly comparisonError: string | null;
  readonly comparisonLoading: boolean;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly loadingArticle: number | null;
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => {
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
        {comparisonError ?? "Failed to load comparison data. Please try again."}
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
};

const ComparisonView = ({
  comparisonSourceOptions,
  comparisonArticles,
  comparisonError,
  comparisonData,
  comparisonLoading,
  articleContents,
  loadingArticle,
  onSourceChange,
}: Omit<ComparisonTabProps, "comparisonMode" | "detailArticleCount">) => {
  const primaryArticle = comparisonArticles[0],
    secondaryArticle = comparisonArticles[1];
  return (
    <div className="space-y-6 p-6">
      <ComparisonSourcePicker
        articles={comparisonArticles}
        options={comparisonSourceOptions}
        onSourceChange={onSourceChange}
      />
      {Boolean(comparisonError) && (
        <div className="rounded-lg border border-border/60 bg-destructive/5 px-4 py-3 text-sm text-muted-foreground">
          {comparisonError}
        </div>
      )}
      {(() => {
        if (primaryArticle && secondaryArticle) {
          return (
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
          );
        }
        return (
          <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] px-4 py-3 text-sm text-muted-foreground">
            Select one article from each outlet to compare the coverage.
          </div>
        );
      })()}
    </div>
  );
};

const ComparisonUnavailable = ({
  detailArticleCount,
}: Readonly<{ detailArticleCount: number | null }>) => (
  <div className="flex flex-1 items-center justify-center text-muted-foreground">
    {(() => {
      if (detailArticleCount === null || detailArticleCount === 0 || detailArticleCount < 2) {
        return "Need at least 2 articles to compare";
      }
      return "Compare Sources needs coverage from at least two outlets.";
    })()}
  </div>
);

const ComparisonTab = ({
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
}: ComparisonTabProps) => {
  const hasDistinctComparisonSources = comparisonSourceOptions.length >= 2;

  return (
    <TabsContent value="compare" className="flex-1 overflow-y-auto m-0 p-0">
      {(() => {
        if (comparisonMode && hasDistinctComparisonSources) {
          return (
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
          );
        }
        return <ComparisonUnavailable detailArticleCount={detailArticleCount} />;
      })()}
    </TabsContent>
  );
};

const ClusterDetailModalContent = ({
  cluster,
  isBreaking,
  onClose,
}: ClusterDetailModalContentProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { likedIds, toggleLike } = useLikedArticles();
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
  const clusterId = cluster.cluster_id;
  const {
    data: clusterDetail,
    isLoading: loading,
    error: clusterDetailError,
  } = useQuery<ClusterDetailResponse>({
    queryFn: () => fetchClusterDetail(clusterId),
    queryKey: ["cluster-detail", clusterId],
    retry: 1,
  });
  const articleState = useClusterArticleController(clusterDetail);
  const comparisonState = useClusterComparisonController({
    articleContents: articleState.articleContents,
    clusterDetail,
    loadArticleContent: articleState.loadArticleContent,
    setArticleContents: articleState.setArticleContents,
  });
  const handleLike = useCallback(
    (articleId: number) => {
      void toggleLike(articleId);
    },
    [toggleLike],
  );
  const handleQueueToggle = useCallback(
    (article: ClusterArticle) => {
      const newsArticle = mapBackendArticle(article);
      if (isArticleInQueue(article.url)) {
        void removeArticleFromQueue(article.url);
      } else {
        void addArticleToQueue(newsArticle);
      }
    },
    [addArticleToQueue, isArticleInQueue, removeArticleFromQueue],
  );
  const loadError = (() => {
    if (clusterDetailError) {
      return "Failed to load cluster details.";
    }
    return null;
  })();
  const label = cluster.label ?? cluster.keywords.slice(0, 3).join(", ");
  const clusterContext = clusterContextOf(clusterDetail, cluster);
  const activeArticleContext = articleState.activeArticle?.gdelt_context ?? null;
  const { toneDelta, toneAvg } = resolveToneView(activeArticleContext, clusterContext);
  const cameoSummary = getCameoSummary(clusterContext);
  const { setActiveArticleId } = articleState,
    {
      comparisonArticles,
      comparisonData,
      comparisonError,
      comparisonLoading,
      comparisonMode,
      comparisonSourceOptions,
      handleComparisonSourceChange,
      handleTabChange: handleComparisonTabChange,
    } = comparisonState,
    { articleContents, loadingArticle } = articleState;
  const handleTabChange = useCallback(
    (value: string) => {
      setActiveArticleId(value);
      handleComparisonTabChange(value);
    },
    [handleComparisonTabChange, setActiveArticleId],
  );
  const handleToggleExpand = useCallback(() => {
    setIsExpanded((previous) => !previous);
  }, []);
  const contextProps = useMemo<ComponentProps<typeof GdeltContextStrip> | null>(
    () =>
      (() => {
        if (clusterContext === null) {
          return null;
        }
        return {
          cameoSummary,
          context: clusterContext,
          toneAvg,
          toneDelta,
        };
      })(),
    [cameoSummary, clusterContext, toneAvg, toneDelta],
  );
  const comparisonProps = useMemo<ComparisonTabProps>(
    () => ({
      articleContents,
      comparisonArticles,
      comparisonData,
      comparisonError,
      comparisonLoading,
      comparisonMode,
      comparisonSourceOptions,
      detailArticleCount: clusterDetail?.articles?.length ?? null,
      loadingArticle,
      onSourceChange: handleComparisonSourceChange,
    }),
    [
      articleContents,
      comparisonArticles,
      comparisonData,
      comparisonError,
      comparisonLoading,
      comparisonMode,
      comparisonSourceOptions,
      handleComparisonSourceChange,
      loadingArticle,
      clusterDetail,
    ],
  );

  return (
    <ClusterDetailView
      cluster={cluster}
      isBreaking={isBreaking}
      label={label}
      isExpanded={isExpanded}
      onToggleExpand={handleToggleExpand}
      onClose={onClose}
      context={contextProps}
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
      comparison={comparisonProps}
    />
  );
};
export { ClusterDetailModal };
