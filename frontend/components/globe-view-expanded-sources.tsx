import { Badge } from "@/components/ui/badge";
import { useCallback } from "react";
import type { NewsArticle } from "@/lib/api";
import type { RefObject } from "react";
import type { CoverageEntry, WorkspaceLeader, WorkspaceSource } from "@/lib/globe-workspace";
import { formatArticleDateTime } from "@/lib/date-formatters";
import {
  EMPTY_COUNT,
  MAX_PERCENT,
  MIN_COVERAGE_BAR,
  percentageStyle,
  positiveValueOrFallback,
} from "./globe-view-shared";

interface ExpandedSourceDossierProps {
  readonly source: WorkspaceSource;
  readonly onSelect: (article: NewsArticle) => void;
}

const ExpandedSourceDossierHeader = (
  props: Readonly<Pick<ExpandedSourceDossierProps, "source">>,
) => (
  <div className="mb-2 flex flex-wrap items-center gap-3">
    <Badge
      variant="outline"
      className="rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-primary"
    >
      {props.source.name}
    </Badge>
    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      {props.source.count} articles
    </span>
    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      {props.source.credibilityShare}% high credibility
    </span>
  </div>
);

const ExpandedSourceDossierLatest = (
  props: Readonly<Pick<ExpandedSourceDossierProps, "source">>,
) => {
  const { source } = props;
  if (source.latestArticle === undefined) {
    return <div className="text-sm text-muted-foreground">No recent article available.</div>;
  }
  const latestDate = source.latestPublishedAt ?? source.latestArticle.publishedAt;
  return (
    <div>
      <div className="line-clamp-1 font-serif text-lg text-foreground">
        {source.latestArticle.title}
      </div>
      <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {source.latestArticle.summary}
      </div>
      <div className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Latest dispatch {formatArticleDateTime(latestDate)}
      </div>
    </div>
  );
};

const ExpandedSourceDossierCountryBadges = (
  props: Readonly<Pick<WorkspaceSource, "countries" | "name">>,
) => {
  if (props.countries.length === EMPTY_COUNT) {
    return <span className="text-xs text-muted-foreground">No country tags</span>;
  }
  return (
    <>
      {props.countries.map((country) => (
        <Badge
          key={`${props.name}-${country}`}
          variant="outline"
          className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-muted-foreground"
        >
          {country}
        </Badge>
      ))}
    </>
  );
};

const ExpandedSourceDossierCoverage = (
  props: Readonly<Pick<ExpandedSourceDossierProps, "source">>,
) => (
  <div className="w-[180px] shrink-0">
    <div className="mb-2 text-right text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Coverage Footprint
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <ExpandedSourceDossierCountryBadges
        countries={props.source.countries}
        name={props.source.name}
      />
    </div>
  </div>
);

const ExpandedSourceDossierContent = (
  props: Readonly<Pick<ExpandedSourceDossierProps, "source">>,
) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0 flex-1">
      <ExpandedSourceDossierHeader source={props.source} />
      <ExpandedSourceDossierLatest source={props.source} />
    </div>
    <ExpandedSourceDossierCoverage source={props.source} />
  </div>
);

const ExpandedSourceDossier = (props: Readonly<ExpandedSourceDossierProps>) => {
  const { onSelect, source } = props;
  const handleClick = useCallback((): void => {
    if (source.latestArticle !== undefined) {
      onSelect(source.latestArticle);
    }
  }, [onSelect, source]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
    >
      <ExpandedSourceDossierContent source={source} />
    </button>
  );
};

const MIN_ARTICLE_DENOMINATOR = 1;

interface ExpandedSourcesTabProps {
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly focusLabel: string;
  readonly sourceWorkspace: readonly WorkspaceSource[];
  readonly sourceCoverageLeaders: readonly WorkspaceLeader[];
  readonly coverageBreakdown: readonly CoverageEntry[];
  readonly originVolume: number;
  readonly sourceVolume: number;
  readonly selectedCountryCoverage: number;
  readonly onArticleSelect: (article: NewsArticle) => void;
  readonly sourceBreakdownRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly coverageMapRef: Readonly<RefObject<HTMLDivElement | null>>;
}

const expandedTopSourceShare = (
  sources: readonly WorkspaceSource[],
  articleCount: number,
): string => {
  const [topSource] = sources;
  if (topSource === undefined) {
    return "0%";
  }
  const share = Math.round(
    (topSource.count / Math.max(articleCount, MIN_ARTICLE_DENOMINATOR)) * MAX_PERCENT,
  );
  return `${share}%`;
};

interface ExpandedSourceStatProps {
  readonly label: string;
  readonly value: string | number;
}

const ExpandedSourceStat = (props: Readonly<ExpandedSourceStatProps>) => (
  <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
    <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
      {props.label}
    </div>
    <div className="mt-2 font-serif text-2xl text-foreground">{props.value}</div>
  </div>
);

const ExpandedSourceStats = (
  props: Readonly<
    Pick<ExpandedSourcesTabProps, "articleCount" | "sourceCount" | "sourceWorkspace">
  >,
) => (
  <div className="grid grid-cols-3 gap-3">
    <ExpandedSourceStat label="Active Sources" value={props.sourceCount} />
    <ExpandedSourceStat label="Routed Articles" value={props.articleCount} />
    <ExpandedSourceStat
      label="Top Source Share"
      value={expandedTopSourceShare(props.sourceWorkspace, props.articleCount)}
    />
  </div>
);

const ExpandedSourceWorkspaceIntro = (
  props: Readonly<Pick<ExpandedSourcesTabProps, "focusLabel">>,
) => (
  <div>
    <div className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Source Workspace
    </div>
    <h2 className="font-serif text-3xl text-foreground">
      Source network behind {props.focusLabel}
    </h2>
    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
      This tab tracks which outlets are driving the current lens, where those outlets are based, and
      which source clusters are actually carrying the story.
    </p>
  </div>
);

const ExpandedSourceWorkspaceHeader = (
  props: Readonly<
    Pick<ExpandedSourcesTabProps, "articleCount" | "focusLabel" | "sourceCount" | "sourceWorkspace">
  >,
) => (
  <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
    <ExpandedSourceWorkspaceIntro focusLabel={props.focusLabel} />
    <ExpandedSourceStats
      articleCount={props.articleCount}
      sourceCount={props.sourceCount}
      sourceWorkspace={props.sourceWorkspace}
    />
  </div>
);

const ExpandedSourceDossierHeaderBar = () => (
  <div className="mb-5 flex items-center justify-between">
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Source Dossiers
    </div>
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Live Data
    </div>
  </div>
);

const ExpandedSourceDossierList = (
  props: Readonly<Pick<ExpandedSourcesTabProps, "onArticleSelect" | "sourceWorkspace">>,
) => {
  if (props.sourceWorkspace.length === EMPTY_COUNT) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-10 text-center text-sm text-muted-foreground">
        No sources available for this lens.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {props.sourceWorkspace.map((source) => (
        <ExpandedSourceDossier key={source.name} onSelect={props.onArticleSelect} source={source} />
      ))}
    </div>
  );
};

const ExpandedSourceDossierSection = (
  props: Readonly<Pick<ExpandedSourcesTabProps, "onArticleSelect" | "sourceWorkspace">>,
) => (
  <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
    <ExpandedSourceDossierHeaderBar />
    <ExpandedSourceDossierList
      onArticleSelect={props.onArticleSelect}
      sourceWorkspace={props.sourceWorkspace}
    />
  </div>
);

const ExpandedLeaderboardBar = (props: Readonly<Pick<WorkspaceLeader, "share">>) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
    <div
      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(186,137,63,0.95),rgba(231,118,43,0.95))]"
      style={percentageStyle(props.share)}
    />
  </div>
);

const ExpandedLeaderboardRow = (props: Readonly<{ readonly source: WorkspaceLeader }>) => (
  <div>
    <div className="mb-2 flex items-center justify-between text-sm">
      <span className="truncate pr-4 text-foreground">{props.source.name}</span>
      <span className="shrink-0 text-muted-foreground">{props.source.count}</span>
    </div>
    <ExpandedLeaderboardBar share={props.source.share} />
  </div>
);

const ExpandedSourceLeaderboard = (
  props: Readonly<Pick<ExpandedSourcesTabProps, "sourceCoverageLeaders">>,
) => (
  <div className="rounded-[24px] border border-white/10 bg-black/20 p-6">
    <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Source Leaderboard
    </div>
    <div className="space-y-4">
      {props.sourceCoverageLeaders.map((source) => (
        <ExpandedLeaderboardRow key={source.name} source={source} />
      ))}
    </div>
  </div>
);

const ExpandedSourceMetric = (props: Readonly<ExpandedSourceStatProps>) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
    <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
      {props.label}
    </div>
    <div className="mt-2 font-serif text-2xl text-foreground">{props.value}</div>
  </div>
);

const ExpandedSourceBreakdown = (
  props: Readonly<
    Pick<
      ExpandedSourcesTabProps,
      "originVolume" | "selectedCountryCoverage" | "sourceBreakdownRef" | "sourceVolume"
    >
  >,
) => {
  const { sourceBreakdownRef } = props;
  return (
    <div ref={sourceBreakdownRef} className="rounded-[24px] border border-white/10 bg-black/20 p-6">
      <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Source Breakdown
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ExpandedSourceMetric
          label="Local Outlet Volume"
          value={positiveValueOrFallback(props.sourceVolume, props.originVolume)}
        />
        <ExpandedSourceMetric label="Coverage Heat" value={props.selectedCountryCoverage} />
      </div>
    </div>
  );
};

const ExpandedCoverageBar = (props: Readonly<{ readonly percent: number }>) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
    <div className="h-full rounded-full bg-primary" style={percentageStyle(props.percent)} />
  </div>
);

const ExpandedCoverageRow = (
  props: Readonly<{ readonly entry: CoverageEntry; readonly leadCount: number }>,
) => {
  const percent = Math.max(MIN_COVERAGE_BAR, (props.entry.count / props.leadCount) * MAX_PERCENT);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{props.entry.country}</span>
        <span>{props.entry.count}</span>
      </div>
      <ExpandedCoverageBar percent={percent} />
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

const ExpandedCoverageMap = (
  props: Readonly<Pick<ExpandedSourcesTabProps, "coverageBreakdown" | "coverageMapRef">>,
) => {
  const { coverageMapRef } = props;
  const [leadEntry] = props.coverageBreakdown;
  return (
    <div ref={coverageMapRef} className="rounded-[24px] border border-white/10 bg-black/20 p-6">
      <div className="mb-5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Coverage Map
      </div>
      <ExpandedCoverageMapContent
        coverageBreakdown={props.coverageBreakdown}
        leadEntry={leadEntry}
      />
    </div>
  );
};

type ExpandedSourcesAsideProps = Readonly<
  Pick<
    ExpandedSourcesTabProps,
    | "coverageBreakdown"
    | "coverageMapRef"
    | "originVolume"
    | "selectedCountryCoverage"
    | "sourceBreakdownRef"
    | "sourceCoverageLeaders"
    | "sourceVolume"
  >
>;

const ExpandedSourcesAside = (props: ExpandedSourcesAsideProps) => (
  <div className="space-y-6">
    <ExpandedSourceLeaderboard sourceCoverageLeaders={props.sourceCoverageLeaders} />
    <ExpandedSourceBreakdown
      originVolume={props.originVolume}
      selectedCountryCoverage={props.selectedCountryCoverage}
      sourceBreakdownRef={props.sourceBreakdownRef}
      sourceVolume={props.sourceVolume}
    />
    <ExpandedCoverageMap
      coverageBreakdown={props.coverageBreakdown}
      coverageMapRef={props.coverageMapRef}
    />
  </div>
);

type ExpandedSourcesBodyProps = Readonly<
  Pick<
    ExpandedSourcesTabProps,
    | "coverageBreakdown"
    | "coverageMapRef"
    | "onArticleSelect"
    | "originVolume"
    | "selectedCountryCoverage"
    | "sourceBreakdownRef"
    | "sourceCoverageLeaders"
    | "sourceVolume"
    | "sourceWorkspace"
  >
>;

const ExpandedSourcesBody = (props: ExpandedSourcesBodyProps) => (
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
    <ExpandedSourceDossierSection
      onArticleSelect={props.onArticleSelect}
      sourceWorkspace={props.sourceWorkspace}
    />
    <ExpandedSourcesAside
      coverageBreakdown={props.coverageBreakdown}
      coverageMapRef={props.coverageMapRef}
      originVolume={props.originVolume}
      selectedCountryCoverage={props.selectedCountryCoverage}
      sourceBreakdownRef={props.sourceBreakdownRef}
      sourceCoverageLeaders={props.sourceCoverageLeaders}
      sourceVolume={props.sourceVolume}
    />
  </div>
);

const ExpandedSourcesTab = (props: Readonly<ExpandedSourcesTabProps>) => (
  <div className="space-y-8">
    <div className="rounded-[28px] border border-white/10 bg-black/30 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <ExpandedSourceWorkspaceHeader
        articleCount={props.articleCount}
        focusLabel={props.focusLabel}
        sourceCount={props.sourceCount}
        sourceWorkspace={props.sourceWorkspace}
      />
      <ExpandedSourcesBody
        coverageBreakdown={props.coverageBreakdown}
        coverageMapRef={props.coverageMapRef}
        onArticleSelect={props.onArticleSelect}
        originVolume={props.originVolume}
        selectedCountryCoverage={props.selectedCountryCoverage}
        sourceBreakdownRef={props.sourceBreakdownRef}
        sourceCoverageLeaders={props.sourceCoverageLeaders}
        sourceVolume={props.sourceVolume}
        sourceWorkspace={props.sourceWorkspace}
      />
    </div>
  </div>
);

export { ExpandedCoverageRow, ExpandedSourcesTab };
