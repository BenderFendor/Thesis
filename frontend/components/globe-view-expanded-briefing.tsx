import { Badge } from "@/components/ui/badge";
import { ChevronDown, MapPin, Radio } from "lucide-react";
import type { RefObject } from "react";
import type { NewsArticle } from "@/lib/api";
import type {
  CoverageEntry,
  CountrySelection,
  ExpandedSortMode,
  SourceSummaryEntry,
  TopicSignalEntry,
} from "@/lib/globe-workspace";
import {
  articleRenderKey,
  briefingDescriptionFor,
  hasText,
  MAX_INTENSITY_SCORE,
} from "@/lib/globe-workspace";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { COVERAGE_LIMIT, EMPTY_COUNT, ICON_SIZE } from "./globe-view-shared";
import type { GlobeLensResponse } from "./globe-view-shared";
import { ExpandedArticleRow } from "./globe-view-expanded-article";
import { ExpandedCoverageRow } from "./globe-view-expanded-sources";

interface ExpandedBriefingTabProps {
  readonly selectedCountry: CountrySelection;
  readonly localLensData: GlobeLensResponse | undefined;
  readonly latestLensTimestamp: number | undefined;
  readonly articleCount: number;
  readonly expandedArticles: readonly NewsArticle[];
  readonly expandedSort: ExpandedSortMode;
  readonly onCycleSort: () => void;
  readonly isBookmarked: (articleId: number) => boolean;
  readonly onToggleBookmark: (articleId: number) => Promise<void>;
  readonly onArticleSelect: (article: NewsArticle) => void;
  readonly topicSignals: readonly TopicSignalEntry[];
  readonly sourceSummary: readonly SourceSummaryEntry[];
  readonly selectedCountryCoverage: number;
  readonly intensityScore: number;
  readonly coverageBreakdown: readonly CoverageEntry[];
  readonly lensBriefRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly topStoriesRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly trendingTopicsRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly sourceBreakdownRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly coverageMapRef: Readonly<RefObject<HTMLDivElement | null>>;
}

const expandedSortLabel = (sortMode: ExpandedSortMode): string => {
  if (sortMode === "oldest") {
    return "Oldest First";
  }
  if (sortMode === "source") {
    return "Source A-Z";
  }
  return "Most Recent";
};

const formatLatestTimestamp = (timestamp: number | undefined): string => {
  if (timestamp === undefined) {
    return "N/A";
  }
  return formatArticleDateTime(new Date(timestamp).toISOString());
};

const ExpandedLensBriefHeader = () => (
  <div className="mb-4 flex items-center gap-2 text-primary">
    <MapPin size={ICON_SIZE} />
    <span className="text-[10px] font-mono uppercase tracking-[0.2em]">Lens Brief</span>
  </div>
);

const ExpandedLensBriefSignal = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "localLensData">>,
) => {
  if (props.localLensData?.geo_signal === undefined) {
    return null;
  }
  return (
    <Badge
      variant="outline"
      className="mb-4 rounded-full border-primary/25 bg-primary/10 px-3 py-1 text-[9px] uppercase tracking-widest text-primary"
    >
      {props.localLensData.geo_signal.label}
    </Badge>
  );
};

const matchingStrategyLabel = (strategy: string | undefined): string => {
  if (!hasText(strategy)) {
    return "N/A";
  }
  return strategy.replaceAll("_", " ");
};

const ExpandedLensBriefMetadata = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "latestLensTimestamp" | "localLensData">>,
) => {
  const matchingStrategy = props.localLensData?.matching_strategy;
  return (
    <div className="space-y-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      <div>Match: {matchingStrategyLabel(matchingStrategy)}</div>
      <div>Latest Indexed: {formatLatestTimestamp(props.latestLensTimestamp)}</div>
    </div>
  );
};

const ExpandedLensBriefCopy = (
  props: Readonly<
    Pick<ExpandedBriefingTabProps, "latestLensTimestamp" | "localLensData" | "selectedCountry">
  >,
) => (
  <div className="relative z-10 w-2/3">
    <ExpandedLensBriefHeader />
    <h2 className="mb-6 font-serif text-2xl text-foreground">
      {briefingDescriptionFor(props.selectedCountry, props.localLensData)}
    </h2>
    <ExpandedLensBriefSignal localLensData={props.localLensData} />
    <ExpandedLensBriefMetadata
      latestLensTimestamp={props.latestLensTimestamp}
      localLensData={props.localLensData}
    />
  </div>
);

const ExpandedLensBriefDecoration = () => (
  <div className="absolute right-8 top-1/2 flex -translate-y-1/2 items-center justify-center opacity-60">
    <div className="h-32 w-48 rounded-full bg-[radial-gradient(circle,rgba(186,137,63,0.45)_1px,transparent_1.4px)] blur-[0.2px] [background-size:8px_8px]" />
  </div>
);

const ExpandedLensBrief = (
  props: Readonly<
    Pick<
      ExpandedBriefingTabProps,
      "latestLensTimestamp" | "lensBriefRef" | "localLensData" | "selectedCountry"
    >
  >,
) => {
  const { lensBriefRef } = props;
  return (
    <div
      ref={lensBriefRef}
      className="relative mb-8 overflow-hidden rounded-[28px] border border-primary/15 bg-[linear-gradient(135deg,rgba(186,137,63,0.12),rgba(10,10,10,0.78)_45%,rgba(10,10,10,0.92))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
    >
      <ExpandedLensBriefCopy
        latestLensTimestamp={props.latestLensTimestamp}
        localLensData={props.localLensData}
        selectedCountry={props.selectedCountry}
      />
      <ExpandedLensBriefDecoration />
    </div>
  );
};

const ExpandedArticleUpdated = (props: Readonly<{ readonly timestampLabel: string }>) => (
  <span>
    Updated {props.timestampLabel} <Radio size={ICON_SIZE - 2} className="ml-1 inline" />
  </span>
);

const ExpandedArticleListControls = (
  props: Readonly<
    Pick<ExpandedBriefingTabProps, "expandedSort" | "latestLensTimestamp" | "onCycleSort">
  >,
) => (
  <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
    <ExpandedArticleUpdated timestampLabel={formatLatestTimestamp(props.latestLensTimestamp)} />
    <button
      type="button"
      onClick={props.onCycleSort}
      className="flex items-center gap-1 transition-colors hover:text-foreground"
    >
      {expandedSortLabel(props.expandedSort)} <ChevronDown size={ICON_SIZE - 2} />
    </button>
  </div>
);

const ExpandedArticleListHeader = (
  props: Readonly<
    Pick<
      ExpandedBriefingTabProps,
      "articleCount" | "expandedSort" | "latestLensTimestamp" | "onCycleSort" | "topStoriesRef"
    >
  >,
) => {
  const { topStoriesRef } = props;
  return (
    <div
      ref={topStoriesRef}
      className="mb-4 flex items-center justify-between border-b border-white/10 pb-4"
    >
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        {props.articleCount} Articles
      </div>
      <ExpandedArticleListControls
        expandedSort={props.expandedSort}
        latestLensTimestamp={props.latestLensTimestamp}
        onCycleSort={props.onCycleSort}
      />
    </div>
  );
};

const ExpandedArticleList = (
  props: Readonly<
    Pick<
      ExpandedBriefingTabProps,
      "expandedArticles" | "isBookmarked" | "onArticleSelect" | "onToggleBookmark"
    >
  >,
) => {
  if (props.expandedArticles.length === EMPTY_COUNT) {
    return (
      <div className="rounded-[28px] border border-white/10 bg-black/30 p-12 text-center text-sm font-mono uppercase tracking-widest text-muted-foreground">
        No articles available
      </div>
    );
  }
  return (
    <div className="space-y-0 overflow-hidden rounded-[28px] border border-white/10 bg-black/30 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      {props.expandedArticles.map((article, index) => (
        <ExpandedArticleRow
          key={articleRenderKey(article, index)}
          article={article}
          isBookmarked={props.isBookmarked}
          onSelect={props.onArticleSelect}
          onToggleBookmark={props.onToggleBookmark}
        />
      ))}
    </div>
  );
};

const ExpandedTopicSignalList = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "topicSignals">>,
) => {
  if (props.topicSignals.length === EMPTY_COUNT) {
    return <p className="text-sm text-muted-foreground">No topic signals yet for this lens.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {props.topicSignals.map((topic) => (
        <Badge
          key={topic.label}
          variant="outline"
          className="rounded-full border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-wider text-primary"
        >
          {topic.label} · {topic.count}
        </Badge>
      ))}
    </div>
  );
};

const ExpandedTopicSignals = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "topicSignals" | "trendingTopicsRef">>,
) => {
  const { trendingTopicsRef } = props;
  return (
    <div
      ref={trendingTopicsRef}
      className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl"
    >
      <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Trending Topics
      </div>
      <ExpandedTopicSignalList topicSignals={props.topicSignals} />
    </div>
  );
};

const ExpandedSourceSummaryRows = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "sourceSummary">>,
) => (
  <div className="space-y-3">
    {props.sourceSummary.slice(0, COVERAGE_LIMIT).map((source) => (
      <div key={source.name} className="flex items-center justify-between text-sm">
        <span className="text-foreground">{source.name}</span>
        <span className="text-muted-foreground">{source.count}</span>
      </div>
    ))}
  </div>
);

const ExpandedSourceSummary = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "sourceBreakdownRef" | "sourceSummary">>,
) => {
  const { sourceBreakdownRef } = props;
  return (
    <div
      ref={sourceBreakdownRef}
      className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl"
    >
      <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Source Breakdown
      </div>
      <ExpandedSourceSummaryRows sourceSummary={props.sourceSummary} />
    </div>
  );
};

const ExpandedSnapshotMetric = (
  props: Readonly<{ readonly label: string; readonly value: string }>,
) => (
  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
    <div className="mt-2 font-serif text-2xl text-foreground">{props.value}</div>
  </div>
);

const ExpandedLensSnapshot = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "intensityScore" | "selectedCountryCoverage">>,
) => (
  <div className="rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
    <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Lens Snapshot
    </div>
    <div className="grid grid-cols-2 gap-4">
      <ExpandedSnapshotMetric label="Coverage Heat" value={String(props.selectedCountryCoverage)} />
      <ExpandedSnapshotMetric
        label="Intensity"
        value={`${props.intensityScore}/${MAX_INTENSITY_SCORE}`}
      />
    </div>
  </div>
);

const ExpandedCoverageMapCard = (
  props: Readonly<Pick<ExpandedBriefingTabProps, "coverageBreakdown" | "coverageMapRef">>,
) => {
  const { coverageMapRef } = props;
  const [leadEntry] = props.coverageBreakdown;
  return (
    <div
      ref={coverageMapRef}
      className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl"
    >
      <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Coverage Map
      </div>
      <ExpandedCoverageMapContent
        coverageBreakdown={props.coverageBreakdown}
        leadEntry={leadEntry}
      />
    </div>
  );
};

interface ExpandedCoverageMapContentProps {
  readonly coverageBreakdown: readonly CoverageEntry[];
  readonly leadEntry: CoverageEntry | undefined;
}

const ExpandedCoverageMapContent = (props: Readonly<ExpandedCoverageMapContentProps>) => {
  if (props.leadEntry === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        Coverage breakdown appears after the lens resolves article geography.
      </p>
    );
  }
  const leadCount = props.leadEntry.count;
  return (
    <div className="space-y-3">
      {props.coverageBreakdown.map((entry) => (
        <ExpandedCoverageRow key={entry.country} entry={entry} leadCount={leadCount} />
      ))}
    </div>
  );
};

const ExpandedBriefingSummary = (
  props: Readonly<
    Pick<
      ExpandedBriefingTabProps,
      | "coverageBreakdown"
      | "coverageMapRef"
      | "intensityScore"
      | "selectedCountryCoverage"
      | "sourceBreakdownRef"
      | "sourceSummary"
    >
  >,
) => (
  <>
    <div className="mt-8 grid grid-cols-2 gap-6">
      <ExpandedSourceSummary
        sourceBreakdownRef={props.sourceBreakdownRef}
        sourceSummary={props.sourceSummary}
      />
      <ExpandedLensSnapshot
        intensityScore={props.intensityScore}
        selectedCountryCoverage={props.selectedCountryCoverage}
      />
    </div>
    <ExpandedCoverageMapCard
      coverageBreakdown={props.coverageBreakdown}
      coverageMapRef={props.coverageMapRef}
    />
  </>
);

const ExpandedBriefingTab = (props: Readonly<ExpandedBriefingTabProps>) => (
  <>
    <ExpandedLensBrief
      latestLensTimestamp={props.latestLensTimestamp}
      lensBriefRef={props.lensBriefRef}
      localLensData={props.localLensData}
      selectedCountry={props.selectedCountry}
    />
    <ExpandedArticleListHeader
      articleCount={props.articleCount}
      expandedSort={props.expandedSort}
      latestLensTimestamp={props.latestLensTimestamp}
      onCycleSort={props.onCycleSort}
      topStoriesRef={props.topStoriesRef}
    />
    <ExpandedArticleList
      expandedArticles={props.expandedArticles}
      isBookmarked={props.isBookmarked}
      onArticleSelect={props.onArticleSelect}
      onToggleBookmark={props.onToggleBookmark}
    />
    <ExpandedTopicSignals
      topicSignals={props.topicSignals}
      trendingTopicsRef={props.trendingTopicsRef}
    />
    <ExpandedBriefingSummary
      coverageBreakdown={props.coverageBreakdown}
      coverageMapRef={props.coverageMapRef}
      intensityScore={props.intensityScore}
      selectedCountryCoverage={props.selectedCountryCoverage}
      sourceBreakdownRef={props.sourceBreakdownRef}
      sourceSummary={props.sourceSummary}
    />
  </>
);

export { ExpandedBriefingTab };
