import type { AllCluster, NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/app/search/research/model/types";
import { fetchAllClusters, fetchClusterArticles } from "@/lib/api";
import { getLogger, hasText } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GridViewMode } from "@/lib/view-mode-storage";

type ReadonlyGridCluster = DeepReadonly<AllCluster>;
type GridClusterWindow = "1d" | "1w" | "1m";

interface GridTopicControllerOptions {
  readonly clusterWindow: GridClusterWindow;
  readonly viewMode: GridViewMode;
  readonly topicSortMode: "sources" | "articles" | "recent";
}

interface GridTopicLoadingOptions {
  readonly clusterWindow: GridClusterWindow;
  readonly setClusters: Dispatch<SetStateAction<AllCluster[]>>;
  readonly setClustersLoading: Dispatch<SetStateAction<boolean>>;
  readonly setClustersStatus: Dispatch<SetStateAction<string | null>>;
  readonly setExpandedClusterId: Dispatch<SetStateAction<number | null>>;
  readonly viewMode: GridViewMode;
}

interface GridTopicDataOptions {
  readonly clusterArticlesCache: ReadonlyMap<number, NewsArticle[]>;
  readonly clusters: readonly AllCluster[];
  readonly expandedClusterId: number | null;
  readonly topicSortMode: GridTopicControllerOptions["topicSortMode"];
}

const logger = getLogger("GridView");

const getClusterTimestamp = (cluster: AllCluster): number => {
  const publishedAt = cluster.representative_article?.published_at;
  if (!hasText(publishedAt)) {
    return 0;
  }
  const timestamp = new Date(publishedAt).getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
};

const sortGridClusters = (
  clusters: readonly AllCluster[],
  clusterTimes: ReadonlyMap<number, number>,
  topicSortMode: GridTopicControllerOptions["topicSortMode"],
): AllCluster[] => {
  const sortedClusters = [...clusters];
  sortedClusters.sort((clusterA, clusterB) => {
    if (topicSortMode === "articles") {
      return clusterB.article_count - clusterA.article_count;
    }
    if (topicSortMode === "recent") {
      return (
        (clusterTimes.get(clusterB.cluster_id) ?? 0) -
        (clusterTimes.get(clusterA.cluster_id) ?? 0)
      );
    }
    return clusterB.source_diversity - clusterA.source_diversity;
  });
  return sortedClusters;
};

const useGridTopicData = ({
  clusterArticlesCache,
  clusters,
  expandedClusterId,
  topicSortMode,
}: Readonly<GridTopicDataOptions>) => {
  const clusterTimes = useMemo(() => {
    const times = new Map<number, number>();
    for (const cluster of clusters) {
      times.set(cluster.cluster_id, getClusterTimestamp(cluster));
    }
    return times;
  }, [clusters]);
  const sortedClusters = useMemo(
    () => sortGridClusters(clusters, clusterTimes, topicSortMode),
    [clusterTimes, clusters, topicSortMode],
  );
  const expandedCluster = useMemo(() => {
    if (expandedClusterId === null) {
      return void 0;
    }
    return sortedClusters.find((cluster) => cluster.cluster_id === expandedClusterId) ?? null;
  }, [expandedClusterId, sortedClusters]);
  const expandedClusterArticles = useMemo(() => {
    if (expandedCluster) {
      return clusterArticlesCache.get(expandedCluster.cluster_id) ?? [];
    }
    return [];
  }, [clusterArticlesCache, expandedCluster]);

  return { expandedCluster, expandedClusterArticles, sortedClusters };
};

interface GridTopicLoadTask extends Omit<GridTopicLoadingOptions, "viewMode"> {
  readonly isCancelled: () => boolean;
  readonly scheduleRetry: () => void;
}

interface GridTopicDataUpdateOptions {
  readonly data: DeepReadonly<Awaited<ReturnType<typeof fetchAllClusters>>>;
  readonly scheduleRetry: () => void;
  readonly setClusters: Dispatch<SetStateAction<AllCluster[]>>;
  readonly setClustersStatus: Dispatch<SetStateAction<string | null>>;
  readonly setExpandedClusterId: Dispatch<SetStateAction<number | null>>;
}

const getRetainedExpandedClusterId = (
  previous: number | null,
  clusters: readonly AllCluster[],
): number | null => {
  if (previous !== null && clusters.some((cluster) => cluster.cluster_id === previous)) {
    return previous;
  }
  return null;
};

const applyGridTopicData = ({
  data,
  scheduleRetry,
  setClusters,
  setClustersStatus,
  setExpandedClusterId,
}: Readonly<GridTopicDataUpdateOptions>): void => {
  setClusters([...data.clusters]);
  setClustersStatus(data.status ?? null);
  setExpandedClusterId((previous) => getRetainedExpandedClusterId(previous, data.clusters));
  if (data.status === "initializing") {
    scheduleRetry();
  }
};

const loadGridTopicClusters = async ({
  clusterWindow,
  isCancelled,
  scheduleRetry,
  setClusters,
  setClustersLoading,
  setClustersStatus,
  setExpandedClusterId,
}: Readonly<GridTopicLoadTask>): Promise<void> => {
  setClustersLoading(true);
  try {
    const data = await fetchAllClusters(clusterWindow, 2, 100);
    if (isCancelled()) {
      return;
    }
    applyGridTopicData({
      data,
      scheduleRetry,
      setClusters,
      setClustersStatus,
      setExpandedClusterId,
    });
  } catch (error) {
    if (!isCancelled()) {
      logger.error("Failed to load clusters:", error);
    }
  } finally {
    if (!isCancelled()) {
      setClustersLoading(false);
    }
  }
};

const useGridTopicLoading = ({
  clusterWindow,
  setClusters,
  setClustersLoading,
  setClustersStatus,
  setExpandedClusterId,
  viewMode,
}: Readonly<GridTopicLoadingOptions>): void => {
  useEffect(() => {
    if (viewMode !== "topic") {
      return () => {};
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const loadClusters = (): Promise<void> =>
      loadGridTopicClusters({
        clusterWindow,
        isCancelled: () => cancelled,
        scheduleRetry: () => {
          retryTimer = setTimeout(() => {
            void loadClusters();
          }, 15_000);
        },
        setClusters,
        setClustersLoading,
        setClustersStatus,
        setExpandedClusterId,
      });
    void loadClusters();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [clusterWindow, setClusters, setClustersLoading, setClustersStatus, setExpandedClusterId, viewMode]);
};

const loadGridClusterArticles = async (
  clusterId: number,
  setClusterArticlesCache: Dispatch<SetStateAction<Map<number, NewsArticle[]>>>,
): Promise<void> => {
  try {
    const fullArticles = await fetchClusterArticles(clusterId);
    setClusterArticlesCache((previous) => new Map(previous).set(clusterId, fullArticles));
  } catch (error) {
    logger.warn("Failed to load full topic cluster articles", { clusterId, error });
  }
};

const scheduleGridClusterScroll = (clusterId: number): void => {
  const section = document.querySelector<HTMLElement>(`[data-cluster-id="${clusterId}"]`);
  globalThis.setTimeout(() => {
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
};

const useGridTopicState = () => {
  const [clusters, setClusters] = useState<AllCluster[]>([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersStatus, setClustersStatus] = useState<string | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<number | null>(null);
  const [clusterArticlesCache, setClusterArticlesCache] = useState<Map<number, NewsArticle[]>>(
    new Map(),
  );
  return {
    clusterArticlesCache,
    clusters,
    clustersLoading,
    clustersStatus,
    expandedClusterId,
    setClusterArticlesCache,
    setClusters,
    setClustersLoading,
    setClustersStatus,
    setExpandedClusterId,
  };
};

const useGridTopicController = ({
  clusterWindow,
  viewMode,
  topicSortMode,
}: Readonly<GridTopicControllerOptions>) => {
  const state = useGridTopicState();
  const { clusterArticlesCache, expandedClusterId, setClusterArticlesCache, setExpandedClusterId } =
    state;
  useGridTopicLoading({
    clusterWindow,
    ...state,
    viewMode,
  });
  const data = useGridTopicData({
    clusterArticlesCache,
    clusters: state.clusters,
    expandedClusterId,
    topicSortMode,
  });
  const handleExpandCluster = useCallback(
    async (cluster: ReadonlyGridCluster): Promise<void> => {
      const clusterId = cluster.cluster_id;
      if (expandedClusterId === clusterId) {
        setExpandedClusterId(null);
        return;
      }

      setExpandedClusterId(clusterId);
      scheduleGridClusterScroll(clusterId);
      const cachedArticles = clusterArticlesCache.get(clusterId);
      if (cachedArticles && cachedArticles.length > 0) {
        return;
      }

      await loadGridClusterArticles(clusterId, setClusterArticlesCache);
    },
    [clusterArticlesCache, expandedClusterId, setClusterArticlesCache, setExpandedClusterId],
  );

  return {
    ...state,
    ...data,
    handleExpandCluster,
  };
};

export { useGridTopicController };
