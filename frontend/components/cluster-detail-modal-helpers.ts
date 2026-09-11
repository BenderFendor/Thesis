import type { CSSProperties } from "react";
import type { BreakingCluster } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { ClusterDetailCluster, GdeltContextLike } from "./cluster-detail-modal-types";

interface ToneView {
  readonly toneDelta: number | null;
  readonly toneAvg: number | null;
}

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

const clusterContextOf = (
  clusterDetail: DeepReadonly<{ gdelt_context?: GdeltContextLike | null }> | null | undefined,
  cluster: Readonly<{ gdelt_context?: GdeltContextLike | null }>,
): GdeltContextLike | null => clusterDetail?.gdelt_context ?? cluster.gdelt_context ?? null;

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

export {
  clusterContextOf,
  formatSignedNumber,
  getCameoSummary,
  getClusterArticleCount,
  getClusterSourceCount,
  getGoldsteinMarkerStyle,
  getGoldsteinRangeStyle,
  isBreakingCluster,
  resolveToneView,
};
