"use client";

import { fetchClusterDetail, mapBackendArticle } from "@/lib/api";
import type { ClusterArticle } from "@/lib/api";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";
import { useClusterArticleController } from "./cluster-detail-modal-controller";
import { useClusterComparisonController } from "./cluster-detail-modal-comparison-controller";
import { clusterContextOf, getCameoSummary, resolveToneView } from "./cluster-detail-modal-helpers";
import type {
  ClusterDetailModalContentProps,
  ClusterDetailResponse,
  ComparisonTabProps,
  ClusterDetailViewProps,
  GdeltContextLike,
} from "./cluster-detail-modal-types";

const useClusterDetailQuery = (cluster: ClusterDetailModalContentProps["cluster"]) => {
  const clusterId = cluster.cluster_id;
  return useQuery<ClusterDetailResponse>({
    queryFn: () => fetchClusterDetail(clusterId),
    queryKey: ["cluster-detail", clusterId],
    retry: 1,
  });
};

type ClusterDetailQuery = ReturnType<typeof useClusterDetailQuery>;
type ClusterArticleState = ReturnType<typeof useClusterArticleController>;

const useClusterDetailData = (cluster: ClusterDetailModalContentProps["cluster"]) => {
  const query = useClusterDetailQuery(cluster);
  const articleState = useClusterArticleController(query.data);
  const comparisonState = useClusterComparisonController({
    articleContents: articleState.articleContents,
    clusterDetail: query.data,
    loadArticleContent: articleState.loadArticleContent,
    setArticleContents: articleState.setArticleContents,
  });
  return {
    articleState,
    clusterDetail: query.data,
    clusterDetailError: query.error,
    comparisonState,
    loading: query.isLoading,
  };
};

const useClusterDetailActions = () => {
  const { likedIds, toggleLike } = useLikedArticles();
  const { addArticleToQueue, removeArticleFromQueue, isArticleInQueue } = useReadingQueue();
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
  return { handleLike, handleQueueToggle, isArticleInQueue, likedIds };
};

interface ClusterPresentationOptions {
  readonly cluster: ClusterDetailModalContentProps["cluster"];
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly clusterDetailError: ClusterDetailQuery["error"];
  readonly activeArticle: ClusterArticleState["activeArticle"];
}

const getClusterPresentation = ({
  cluster,
  clusterDetail,
  clusterDetailError,
  activeArticle,
}: ClusterPresentationOptions) => {
  const label = cluster.label ?? cluster.keywords.slice(0, 3).join(", ");
  const clusterContext = clusterContextOf(clusterDetail, cluster);
  const activeArticleContext = activeArticle?.gdelt_context ?? null;
  const { toneDelta, toneAvg } = resolveToneView(activeArticleContext, clusterContext);
  const cameoSummary = getCameoSummary(clusterContext);
  const loadError = (() => {
    if (clusterDetailError) {
      return "Failed to load cluster details.";
    }
    return null;
  })();
  return { cameoSummary, clusterContext, label, loadError, toneAvg, toneDelta };
};

interface ClusterArticleStateView {
  readonly activeArticle: ClusterDetailResponse["articles"][number] | undefined;
  readonly activeContent: string | null | undefined;
  readonly articleContentRef: ClusterDetailViewProps["contentRef"];
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly loadingArticle: number | null;
  readonly resolvedActiveArticleId: string | null;
  readonly setActiveArticleId: (value: string) => void;
}

interface ClusterComparisonStateView {
  readonly comparisonArticles: ComparisonTabProps["comparisonArticles"];
  readonly comparisonData: ComparisonTabProps["comparisonData"];
  readonly comparisonError: ComparisonTabProps["comparisonError"];
  readonly comparisonLoading: ComparisonTabProps["comparisonLoading"];
  readonly comparisonMode: ComparisonTabProps["comparisonMode"];
  readonly comparisonSourceOptions: ComparisonTabProps["comparisonSourceOptions"];
  readonly handleComparisonSourceChange: ComparisonTabProps["onSourceChange"];
  readonly handleOpenComparison: () => void;
  readonly handleTabChange: (value: string) => void;
}

const buildComparisonProps = (
  articleState: ClusterArticleStateView,
  comparisonState: ClusterComparisonStateView,
  clusterDetail: ClusterDetailResponse | undefined,
): ComparisonTabProps => ({
  articleContents: articleState.articleContents,
  comparisonArticles: comparisonState.comparisonArticles,
  comparisonData: comparisonState.comparisonData,
  comparisonError: comparisonState.comparisonError,
  comparisonLoading: comparisonState.comparisonLoading,
  comparisonMode: comparisonState.comparisonMode,
  comparisonSourceOptions: comparisonState.comparisonSourceOptions,
  detailArticleCount: clusterDetail?.articles?.length ?? null,
  loadingArticle: articleState.loadingArticle,
  onSourceChange: comparisonState.handleComparisonSourceChange,
});

const getClusterContextProps = (
  clusterContext: ReturnType<typeof clusterContextOf>,
  cameoSummary: string | null,
  toneAvg: number | null,
  toneDelta: number | null,
): ClusterDetailViewProps["context"] => {
  if (clusterContext === null) {
    return null;
  }
  return { cameoSummary, context: clusterContext, toneAvg, toneDelta };
};

interface ClusterDetailViewBuilderOptions {
  readonly actions: ClusterDetailActionsView;
  readonly cluster: ClusterDetailModalContentProps["cluster"];
  readonly data: ClusterDetailDataView;
  readonly isBreaking: boolean;
  readonly isExpanded: boolean;
  readonly onClose: () => void;
  readonly onTabChange: (value: string) => void;
  readonly onToggleExpand: () => void;
  readonly presentation: ClusterPresentationView;
}

interface ClusterDetailActionsView {
  readonly handleLike: (articleId: number) => void;
  readonly handleQueueToggle: (article: ClusterArticle) => void;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
}

interface ClusterDetailDataView {
  readonly articleState: ClusterArticleStateView;
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly clusterDetailError: Error | null;
  readonly comparisonState: ClusterComparisonStateView;
  readonly loading: boolean;
}

interface ClusterPresentationView {
  readonly cameoSummary: string | null;
  readonly clusterContext: GdeltContextLike | null;
  readonly label: string;
  readonly loadError: string | null;
  readonly toneAvg: number | null;
  readonly toneDelta: number | null;
}

const buildClusterDetailViewProps = ({
  actions,
  cluster,
  data,
  isBreaking,
  isExpanded,
  onClose,
  onTabChange,
  onToggleExpand,
  presentation,
}: ClusterDetailViewBuilderOptions): ClusterDetailViewProps => ({
  activeContent: data.articleState.activeContent,
  cluster,
  clusterDetail: data.clusterDetail,
  comparison: buildComparisonProps(data.articleState, data.comparisonState, data.clusterDetail),
  contentRef: data.articleState.articleContentRef,
  context: getClusterContextProps(
    presentation.clusterContext,
    presentation.cameoSummary,
    presentation.toneAvg,
    presentation.toneDelta,
  ),
  isArticleInQueue: actions.isArticleInQueue,
  isBreaking,
  isExpanded,
  label: presentation.label,
  likedIds: actions.likedIds,
  loadError: presentation.loadError,
  loading: data.loading,
  loadingArticle: data.articleState.loadingArticle,
  onClose,
  onLike: actions.handleLike,
  onOpenComparison: data.comparisonState.handleOpenComparison,
  onQueueToggle: actions.handleQueueToggle,
  onTabChange,
  onToggleExpand,
  resolvedActiveArticleId: data.articleState.resolvedActiveArticleId,
});

interface ClusterDetailViewDataOptions {
  readonly actions: ClusterDetailActionsView;
  readonly cluster: ClusterDetailModalContentProps["cluster"];
  readonly data: ClusterDetailDataView;
  readonly isBreaking: boolean;
  readonly isExpanded: boolean;
  readonly onClose: () => void;
  readonly setIsExpanded: (value: boolean | ((previous: boolean) => boolean)) => void;
}

const useClusterDetailViewData = ({
  actions,
  cluster,
  data,
  isBreaking,
  isExpanded,
  onClose,
  setIsExpanded,
}: ClusterDetailViewDataOptions): ClusterDetailViewProps => {
  const { articleState, comparisonState } = data;
  const presentation = getClusterPresentation({
    activeArticle: articleState.activeArticle,
    cluster,
    clusterDetail: data.clusterDetail,
    clusterDetailError: data.clusterDetailError,
  });
  const handleTabChange = useCallback(
    (value: string) => {
      articleState.setActiveArticleId(value);
      comparisonState.handleTabChange(value);
    },
    [articleState, comparisonState],
  );
  const handleToggleExpand = useCallback(() => {
    setIsExpanded((previous) => !previous);
  }, [setIsExpanded]);
  return buildClusterDetailViewProps({
    actions,
    cluster,
    data,
    isBreaking,
    isExpanded,
    onClose,
    onTabChange: handleTabChange,
    onToggleExpand: handleToggleExpand,
    presentation,
  });
};

const useClusterDetailModel = ({
  cluster,
  isBreaking,
  onClose,
}: ClusterDetailModalContentProps): ClusterDetailViewProps => {
  const [isExpanded, setIsExpanded] = useState(false);
  const data = useClusterDetailData(cluster);
  const actions = useClusterDetailActions();
  return useClusterDetailViewData({
    actions,
    cluster,
    data,
    isBreaking,
    isExpanded,
    onClose,
    setIsExpanded,
  });
};

export { useClusterDetailModel };
