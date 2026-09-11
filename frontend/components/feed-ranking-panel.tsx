"use client";

import { Brain, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { RANKING_WEIGHTS } from "@/lib/feed-ranking";
import type { FeedScoreBreakdown } from "@/lib/feed-ranking";
import { cn, hasText } from "@/lib/utils";
import { useState } from "react";

const formatRankingStatus = (status: "basic" | "loading" | "ready" | "fallback"): string => {
  if (status === "ready") {
    return "Personalized";
  }
  if (status === "loading") {
    return "Personalizing";
  }
  if (status === "fallback") {
    return "Basic fallback";
  }
  return "Basic";
};

const formatScore = (value: number): string =>
  (() => {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return value.toFixed(1);
  })();

interface RankingPanelProps {
  status: "basic" | "loading" | "ready" | "fallback";
  totalLoaded: number;
  renderedCount: number;
  bufferRemaining: number;
  breakdown: FeedScoreBreakdown | null;
  topicsLoaded: number;
  seedCount: number;
  topKeywords: readonly string[];
  topClusters: readonly WeightedClusterView[];
  debugMode: boolean;
}

interface WeightedClusterView {
  readonly label: string;
  readonly weight: number;
}

const RankingPanel = ({
  status,
  totalLoaded,
  renderedCount,
  bufferRemaining,
  breakdown,
  topicsLoaded,
  seedCount,
  topKeywords,
  topClusters,
  debugMode,
}: Readonly<RankingPanelProps>) => {
  const [isOpen, setIsOpen] = useState(false),
    triggerLabel = formatRankingStatus(status);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="absolute top-6 right-6 z-20 flex w-80 max-w-full flex-col items-end gap-2 md:top-8 md:right-8">
        <RankingPanelTrigger isOpen={isOpen} status={status} triggerLabel={triggerLabel} />
        <RankingPanelDetails
          breakdown={breakdown}
          bufferRemaining={bufferRemaining}
          debugMode={debugMode}
          renderedCount={renderedCount}
          seedCount={seedCount}
          topClusters={topClusters}
          topKeywords={topKeywords}
          topicsLoaded={topicsLoaded}
          totalLoaded={totalLoaded}
        />
      </div>
    </Collapsible>
  );
};

interface RankingPanelTriggerProps {
  isOpen: boolean;
  status: RankingPanelProps["status"];
  triggerLabel: string;
}

const getRankingTriggerClassName = (isOpen: boolean): string => {
  if (isOpen) {
    return "px-3 py-2 text-[10px] md:text-xs gap-1.5 md:gap-2";
  }
  return "w-8 h-8 p-0 justify-center md:w-auto md:h-auto md:px-3 md:py-2 md:text-xs md:gap-2 md:justify-start";
};

const getRankingVisibilityClassName = (isOpen: boolean): string => {
  if (isOpen) {
    return "block";
  }
  return "hidden md:block";
};

const RankingPanelIcon = ({ status }: Readonly<Pick<RankingPanelTriggerProps, "status">>) => {
  if (status === "loading") {
    return <Loader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin shrink-0" />;
  }
  return <Brain className="h-4 w-4 md:h-3.5 md:w-3.5 shrink-0" />;
};

const RankingPanelLabel = ({
  isOpen,
  triggerLabel,
}: Readonly<Pick<RankingPanelTriggerProps, "isOpen" | "triggerLabel">>) => (
  <span className={cn("whitespace-nowrap", getRankingVisibilityClassName(isOpen))}>
    <span className="hidden sm:inline">Ranking: </span>
    {triggerLabel}
  </span>
);

const RankingPanelChevronIcon = ({
  isOpen,
}: Readonly<Pick<RankingPanelTriggerProps, "isOpen">>) => {
  if (isOpen) {
    return <ChevronUp className="h-3.5 w-3.5" />;
  }
  return <ChevronDown className="h-3.5 w-3.5" />;
};

const RankingPanelChevron = ({ isOpen }: Readonly<Pick<RankingPanelTriggerProps, "isOpen">>) => (
  <span className={cn("shrink-0", getRankingVisibilityClassName(isOpen))}>
    <RankingPanelChevronIcon isOpen={isOpen} />
  </span>
);

const RankingPanelTrigger = ({
  isOpen,
  status,
  triggerLabel,
}: Readonly<RankingPanelTriggerProps>) => (
  <CollapsibleTrigger asChild>
    <Button
      variant="outline"
      size="sm"
      title={`Ranking: ${triggerLabel}`}
      className={cn(
        "h-auto rounded-md border-white/20 bg-black/40 font-sans uppercase tracking-wider text-white/80 backdrop-blur-md hover:bg-black/55 transition-all duration-200 flex items-center",
        getRankingTriggerClassName(isOpen),
      )}
    >
      <RankingPanelIcon status={status} />
      <RankingPanelLabel isOpen={isOpen} triggerLabel={triggerLabel} />
      <RankingPanelChevron isOpen={isOpen} />
    </Button>
  </CollapsibleTrigger>
);

interface RankingPanelDetailsProps {
  breakdown: FeedScoreBreakdown | null;
  bufferRemaining: number;
  debugMode: boolean;
  renderedCount: number;
  seedCount: number;
  topClusters: readonly WeightedClusterView[];
  topKeywords: readonly string[];
  topicsLoaded: number;
  totalLoaded: number;
}

const RankingPanelDetails = ({
  breakdown,
  bufferRemaining,
  debugMode,
  renderedCount,
  seedCount,
  topClusters,
  topKeywords,
  topicsLoaded,
  totalLoaded,
}: Readonly<RankingPanelDetailsProps>) => (
  <CollapsibleContent className="w-full rounded-xl border border-white/15 bg-black/65 p-4 text-left text-white/85 backdrop-blur-xl">
    <div className="space-y-3 text-xs">
      <RankingCounts
        totalLoaded={totalLoaded}
        renderedCount={renderedCount}
        bufferRemaining={bufferRemaining}
      />
      <RankingRules />
      <RankingWeights />
      <RankingProfile
        seedCount={seedCount}
        topClusters={topClusters}
        topKeywords={topKeywords}
        topicsLoaded={topicsLoaded}
      />
      {breakdown && <RankingBreakdown breakdown={breakdown} />}
      {debugMode && <RankingDebugNotice />}
    </div>
  </CollapsibleContent>
);

const RankingCounts = ({
  totalLoaded,
  renderedCount,
  bufferRemaining,
}: Readonly<
  Pick<RankingPanelDetailsProps, "totalLoaded" | "renderedCount" | "bufferRemaining">
>) => (
  <div className="flex flex-wrap gap-2 uppercase tracking-wider text-white/60">
    <span>{totalLoaded} loaded</span>
    <span>{renderedCount} rendered</span>
    <span>{bufferRemaining} buffered</span>
  </div>
);

const RankingRules = () => (
  <div className="space-y-1">
    <div className="font-sans uppercase tracking-wider text-white/60">Rules</div>
    <div>1. Favorite sources stay ahead of non-favorites.</div>
    <div>2. Real images stay ahead inside their bucket.</div>
    <div>3. Bookmarks count 2x likes in the profile.</div>
    <div>4. Ties keep original order.</div>
  </div>
);

const RankingWeights = () => (
  <div className="space-y-1">
    <div className="font-sans uppercase tracking-wider text-white/60">Weights</div>
    <div>bookmark = {RANKING_WEIGHTS.bookmarkWeight}</div>
    <div>like = {RANKING_WEIGHTS.likeWeight}</div>
    <div>keyword cap = {RANKING_WEIGHTS.keywordCap}</div>
    <div>category cap = {RANKING_WEIGHTS.categoryCap}</div>
    <div>source cap = {RANKING_WEIGHTS.sourceCap}</div>
  </div>
);

const RankingProfile = ({
  seedCount,
  topClusters,
  topKeywords,
  topicsLoaded,
}: Readonly<
  Pick<RankingPanelDetailsProps, "seedCount" | "topClusters" | "topKeywords" | "topicsLoaded">
>) => (
  <div className="space-y-1">
    <div className="font-sans uppercase tracking-wider text-white/60">Profile</div>
    <div>{seedCount} saved likes and bookmarks</div>
    <div>{topicsLoaded} topic payloads loaded</div>
    {topKeywords.length > 0 && <div>keywords: {topKeywords.join(", ")}</div>}
    {topClusters.length > 0 && (
      <div>
        clusters:{" "}
        {topClusters
          .map((cluster) => `${cluster.label} (${formatScore(cluster.weight)})`)
          .join(", ")}
      </div>
    )}
  </div>
);

const RankingBreakdown = ({ breakdown }: Readonly<{ breakdown: FeedScoreBreakdown }>) => (
  <div className="space-y-1 border-t border-white/10 pt-3">
    <div className="font-sans uppercase tracking-wider text-white/60">Current article</div>
    <div>bucket: {breakdown.bucketLabel}</div>
    <div>total score: {formatScore(breakdown.totalScore)}</div>
    <div>keyword score: {formatScore(breakdown.components.keywordScore)}</div>
    <div>category score: {formatScore(breakdown.components.categoryScore)}</div>
    <div>source score: {formatScore(breakdown.components.sourceScore)}</div>
    {breakdown.matchedKeywords.length > 0 && (
      <div>matched keywords: {breakdown.matchedKeywords.join(", ")}</div>
    )}
    {breakdown.matchedCategories.length > 0 && (
      <div>matched category: {breakdown.matchedCategories.join(", ")}</div>
    )}
    {hasText(breakdown.matchedSource) && <div>matched source: {breakdown.matchedSource}</div>}
  </div>
);

const RankingDebugNotice = () => (
  <div className="flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/55">
    <Sparkles className="h-3.5 w-3.5" />
    Scroll uses a 500-article ranked buffer and reveals items in chunks.
  </div>
);

export { RankingPanel, formatScore };
