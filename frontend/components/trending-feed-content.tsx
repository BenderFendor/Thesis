import { TrendingUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReadonlyNewsArticle } from "@/lib/api";
import { BreakingCard, TrendingCard } from "./trending-feed-cards";
import type {
  MousePropagationEvent,
  ReadonlyBreakingCluster,
  ReadonlyTrendingCluster,
  TrendingWindow,
} from "./trending-feed-helpers";

interface TrendingFeedContentProps {
  readonly breakingClusters: readonly ReadonlyBreakingCluster[];
  readonly isInQueue: (url: string) => boolean;
  readonly isLiked: ReadonlySet<number>;
  readonly onClusterClick: (
    cluster: ReadonlyTrendingCluster | ReadonlyBreakingCluster,
    isBreaking: boolean,
  ) => void;
  readonly onLike: (articleId: number, event: MousePropagationEvent) => void;
  readonly onQueueToggle: (article: ReadonlyNewsArticle, event: MousePropagationEvent) => void;
  readonly onWindowChange: (window: TrendingWindow) => void;
  readonly trendingClusters: readonly ReadonlyTrendingCluster[];
  readonly trendingWindow: TrendingWindow;
}

const BreakingCount = ({ count }: Readonly<{ count: number }>) => (
  <span className="flex items-center gap-1.5 border border-red-500/20 bg-red-500/10 px-2 py-1 text-[8px] font-mono text-red-500 uppercase tracking-widest animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.2)] sm:gap-2 sm:px-3 sm:text-[10px]">
    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
    {count} Breaking
  </span>
);

const TrendingFeedTitle = ({ breakingCount }: Readonly<{ breakingCount: number }>) => (
  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
    <TrendingUp className="h-4 w-4 text-primary/80 sm:h-6 sm:w-6" />
    <h3 className="font-serif text-2xl font-bold tracking-tight text-foreground/90 sm:text-4xl md:text-5xl">
      Latest & Trending
    </h3>
    {breakingCount > 0 && <BreakingCount count={breakingCount} />}
  </div>
);

const TrendingSelectTrigger = () => (
  <SelectTrigger
    className="h-6 border-none bg-transparent px-2 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/80 focus:ring-0"
    title="Filter by time"
  >
    <SelectValue placeholder="Window" />
  </SelectTrigger>
);

const TrendingSelectContent = () => (
  <SelectContent className="bg-[var(--card)] border-white/10">
    <SelectItem value="1d" className="text-[9px] font-mono uppercase tracking-widest">
      Last 24h
    </SelectItem>
    <SelectItem value="1w" className="text-[9px] font-mono uppercase tracking-widest">
      Last 7d
    </SelectItem>
    <SelectItem value="1m" className="text-[9px] font-mono uppercase tracking-widest">
      Last 30d
    </SelectItem>
  </SelectContent>
);

const TrendingWindowSelect = ({
  trendingWindow,
  onWindowChange,
}: Readonly<Pick<TrendingFeedContentProps, "trendingWindow" | "onWindowChange">>) => (
  <div className="flex items-center gap-1 rounded-sm bg-white/[0.03] p-1 border border-white/5">
    <Select value={trendingWindow} onValueChange={onWindowChange}>
      <TrendingSelectTrigger />
      <TrendingSelectContent />
    </Select>
  </div>
);

const TrendingFeedControls = ({
  breakingCount,
  trendingCount,
  trendingWindow,
  onWindowChange,
}: Readonly<
  Pick<TrendingFeedContentProps, "trendingWindow" | "onWindowChange"> & {
    breakingCount: number;
    trendingCount: number;
  }
>) => (
  <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-3">
    <TrendingWindowSelect trendingWindow={trendingWindow} onWindowChange={onWindowChange} />
    <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
      {trendingCount + breakingCount} updates
    </span>
  </div>
);

const TrendingFeedHeader = ({
  breakingCount,
  trendingCount,
  trendingWindow,
  onWindowChange,
}: Readonly<
  Pick<TrendingFeedContentProps, "trendingWindow" | "onWindowChange"> & {
    breakingCount: number;
    trendingCount: number;
  }
>) => (
  <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pb-6">
    <TrendingFeedTitle breakingCount={breakingCount} />
    <TrendingFeedControls
      breakingCount={breakingCount}
      trendingCount={trendingCount}
      trendingWindow={trendingWindow}
      onWindowChange={onWindowChange}
    />
  </div>
);

const TrendingClusterGrid = ({
  breakingClusters,
  trendingClusters,
  isInQueue,
  isLiked,
  onClusterClick,
  onLike,
  onQueueToggle,
}: Readonly<
  Pick<
    TrendingFeedContentProps,
    | "breakingClusters"
    | "trendingClusters"
    | "isInQueue"
    | "isLiked"
    | "onClusterClick"
    | "onLike"
    | "onQueueToggle"
  >
>) => (
  <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
    {breakingClusters.map((cluster) => (
      <BreakingCard
        key={`breaking-${cluster.cluster_id}`}
        cluster={cluster}
        onClusterClick={onClusterClick}
        onQueueToggle={onQueueToggle}
        onLike={onLike}
        isInQueue={isInQueue}
        isLiked={isLiked}
      />
    ))}
    {trendingClusters.map((cluster, index) => (
      <TrendingCard
        key={`trending-${cluster.cluster_id}`}
        cluster={cluster}
        rank={index + 1}
        onClusterClick={onClusterClick}
        onQueueToggle={onQueueToggle}
        onLike={onLike}
        isInQueue={isInQueue}
        isLiked={isLiked}
      />
    ))}
  </div>
);

const TrendingFeedContent = (props: Readonly<TrendingFeedContentProps>) => (
  <div className="flex flex-col space-y-3 sm:space-y-6">
    <TrendingFeedHeader
      breakingCount={props.breakingClusters.length}
      trendingCount={props.trendingClusters.length}
      trendingWindow={props.trendingWindow}
      onWindowChange={props.onWindowChange}
    />
    <TrendingClusterGrid
      breakingClusters={props.breakingClusters}
      trendingClusters={props.trendingClusters}
      isInQueue={props.isInQueue}
      isLiked={props.isLiked}
      onClusterClick={props.onClusterClick}
      onLike={props.onLike}
      onQueueToggle={props.onQueueToggle}
    />
  </div>
);

export { TrendingFeedContent };
