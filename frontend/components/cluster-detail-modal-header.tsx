"use client";

import { hasText } from "@/lib/utils";
import { Maximize2, Minimize2, TrendingUp, X, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type {
  ClusterDetailCluster,
  GdeltContextLike,
  GdeltContextStripProps,
} from "./cluster-detail-modal-types";
import {
  formatSignedNumber,
  getClusterArticleCount,
  getClusterSourceCount,
  getGoldsteinMarkerStyle,
  getGoldsteinRangeStyle,
  isBreakingCluster,
} from "./cluster-detail-modal-helpers";

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

export { ClusterHeader, GdeltContextStrip };
