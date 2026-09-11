import type { AllCluster, ClusterArticle, NewsArticle, TrendingCluster } from "@/lib/api";
import type { DeepReadonly } from "@/app/search/research/model/types";
import { useArticleDetail } from "@/hooks/use-article-detail";
import { useCallback, useEffect, useRef, useState } from "react";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type ReadonlyGridCluster = DeepReadonly<AllCluster>;
type ReadonlyGridClusterArticle = DeepReadonly<ClusterArticle>;
type ReadonlyGridGdeltContext = NonNullable<ReadonlyGridCluster["gdelt_context"]>;
type GridGdeltContext = NonNullable<ClusterArticle["gdelt_context"]>;

const copyGridGdeltContext = (context: ReadonlyGridGdeltContext): GridGdeltContext => ({
  goldstein_avg: context.goldstein_avg,
  goldstein_bucket: context.goldstein_bucket,
  goldstein_max: context.goldstein_max,
  goldstein_min: context.goldstein_min,
  tone_avg: context.tone_avg,
  tone_baseline_avg: context.tone_baseline_avg,
  tone_delta_vs_cluster: context.tone_delta_vs_cluster,
  top_cameo: context.top_cameo?.map((cameo) => ({
    code: cameo.code,
    count: cameo.count,
    label: cameo.label,
  })),
  total_events: context.total_events,
});

const copyGridClusterArticle = (article: ReadonlyGridClusterArticle): ClusterArticle => ({
  author: article.author,
  authors: copyGridAuthors(article.authors),
  gdelt_context: copyGridArticleContext(article.gdelt_context),
  id: article.id,
  image_url: article.image_url,
  published_at: article.published_at,
  similarity: article.similarity,
  source: article.source,
  source_id: article.source_id,
  summary: article.summary,
  title: article.title,
  url: article.url,
});

const copyGridAuthors = (authors: readonly string[] | undefined): string[] | undefined => {
  if (authors) {
    return [...authors];
  }
  return void 0;
};

const copyGridArticleContext = (
  context: ReadonlyGridClusterArticle["gdelt_context"],
): GridGdeltContext | null => {
  if (context) {
    return copyGridGdeltContext(context);
  }
  return null;
};

const copyGridRepresentativeArticle = (
  article: ReadonlyGridCluster["representative_article"],
): ClusterArticle | null => {
  if (article) {
    return copyGridClusterArticle(article);
  }
  return null;
};

const copyGridClusterContext = (
  context: ReadonlyGridCluster["gdelt_context"],
): GridGdeltContext | null => {
  if (context) {
    return copyGridGdeltContext(context);
  }
  return null;
};

const copyGridTrendingCluster = (cluster: ReadonlyGridCluster): TrendingCluster => ({
  article_count: cluster.article_count,
  articles: (cluster.articles ?? []).map((article) => copyGridClusterArticle(article)),
  cluster_id: cluster.cluster_id,
  gdelt_context: copyGridClusterContext(cluster.gdelt_context),
  keywords: [...cluster.keywords],
  label: cluster.label,
  representative_article: copyGridRepresentativeArticle(cluster.representative_article),
  source_diversity: cluster.source_diversity,
  trending_score: cluster.source_diversity,
  velocity: cluster.window_count,
  window_count: cluster.window_count,
});

const getGridArticleIndex = (
  article: NewsArticle,
  contextArticles: readonly NewsArticle[],
): number =>
  contextArticles.findIndex((item) => {
    if (article.url && item.url) {
      return item.url === article.url;
    }
    return item.id === article.id;
  });

const getAdjacentGridArticleIndex = (index: number, direction: "prev" | "next"): number => {
  if (direction === "next") {
    return index + 1;
  }
  return index - 1;
};

const getSelectedGridArticleIndex = (index: number): number | null => {
  if (index === -1) {
    return null;
  }
  return index;
};

const useGridArticleModalState = () => {
  const {
    article: selectedArticle,
    close: closeArticleDetail,
    isOpen: isArticleModalOpen,
    open: openArticleDetail,
  } = useArticleDetail();
  const [selectedArticleIndex, setSelectedArticleIndex] = useState<number | null>(null);
  const [modalArticles, setModalArticles] = useState<NewsArticle[]>([]);
  const handleArticleClick = useCallback(
    (article: NewsArticle, contextArticles: readonly NewsArticle[]) => {
      const nextIndex = getGridArticleIndex(article, contextArticles);
      const selectedIndex = getSelectedGridArticleIndex(nextIndex);
      setModalArticles([...contextArticles]);
      setSelectedArticleIndex(selectedIndex);
      openArticleDetail(article);
    },
    [openArticleDetail],
  );
  const handleModalNavigate = useCallback(
    (direction: "prev" | "next") => {
      if (selectedArticleIndex === null) {
        return;
      }
      const nextIndex = getAdjacentGridArticleIndex(selectedArticleIndex, direction);
      if (nextIndex < 0 || nextIndex >= modalArticles.length) {
        return;
      }
      const nextArticle = modalArticles[nextIndex];
      if (nextArticle === undefined) {
        return;
      }
      setSelectedArticleIndex(nextIndex);
      openArticleDetail(nextArticle);
    },
    [modalArticles, openArticleDetail, selectedArticleIndex],
  );
  const handleModalClose = useCallback(() => {
    closeArticleDetail();
    setSelectedArticleIndex(null);
    setModalArticles([]);
  }, [closeArticleDetail]);

  return {
    handleArticleClick,
    handleModalClose,
    handleModalNavigate,
    isArticleModalOpen,
    selectedArticle,
  };
};

const useGridClusterModalState = () => {
  const [selectedCluster, setSelectedCluster] = useState<TrendingCluster | null>(null);
  const [isClusterModalOpen, setIsClusterModalOpen] = useState(false);
  const handleOpenClusterCompare = useCallback(
    (cluster: ReadonlyGridCluster, event: GridButtonEvent) => {
      event.stopPropagation();
      setSelectedCluster(copyGridTrendingCluster(cluster));
      setIsClusterModalOpen(true);
    },
    [],
  );
  const closeClusterModal = useCallback(() => {
    setIsClusterModalOpen(false);
    setSelectedCluster(null);
  }, []);

  return { closeClusterModal, handleOpenClusterCompare, isClusterModalOpen, selectedCluster };
};

const useGridScrollState = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const setContainerElement = (element: HTMLDivElement | null): void => {
    containerRef.current = element;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return () => {};
    }
    const handleScroll = (): void => {
      setShowScrollTop(container.scrollTop > 500);
    };
    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToTop = (): void => {
    containerRef.current?.scrollTo({ behavior: "smooth", top: 0 });
  };

  return { containerRef, scrollToTop, setContainerElement, showScrollTop };
};

const useGridModalController = () => ({
  ...useGridArticleModalState(),
  ...useGridClusterModalState(),
  ...useGridScrollState(),
});

export { useGridModalController };
