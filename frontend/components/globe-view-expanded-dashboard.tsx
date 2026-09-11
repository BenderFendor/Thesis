import { cn } from "@/lib/utils";
import { ExpandedBriefingTab } from "./globe-view-expanded-briefing";
import { ExpandedLeftSidebar, ExpandedTopNav } from "./globe-view-expanded-left";
import { ExpandedRightSidebar } from "./globe-view-expanded-right";
import { ExpandedSourcesTab } from "./globe-view-expanded-sources";

type GlobeViewExpandedDashboardProps = Readonly<{
  isFocusExpanded: boolean;
  sidebarTab: string;
  leftSidebar: Readonly<Parameters<typeof ExpandedLeftSidebar>[0]>;
  topNav: Readonly<Omit<Parameters<typeof ExpandedTopNav>[0], "onClose">>;
  sourcesTab: Readonly<Parameters<typeof ExpandedSourcesTab>[0]>;
  briefingTab: Readonly<Parameters<typeof ExpandedBriefingTab>[0]>;
  rightSidebar: Readonly<Parameters<typeof ExpandedRightSidebar>[0]>;
  onClose: () => void;
}>;

const expandedDashboardVisibility = (isFocusExpanded: boolean): string => {
  if (isFocusExpanded) {
    return "opacity-100 pointer-events-auto";
  }
  return "opacity-0 pointer-events-none hidden";
};

type ExpandedLeftSidebarAdapterProps = Readonly<{
  readonly sidebar: GlobeViewExpandedDashboardProps["leftSidebar"];
}>;

const ExpandedLeftSidebarAdapter = (props: ExpandedLeftSidebarAdapterProps) => {
  const { sidebar } = props;
  const { onNavigate: handleNavigate, onViewModeChange: handleViewModeChange } = sidebar;
  return (
    <ExpandedLeftSidebar
      articleCount={sidebar.articleCount}
      coverageMapRef={sidebar.coverageMapRef}
      focusLabel={sidebar.focusLabel}
      lensBriefRef={sidebar.lensBriefRef}
      onNavigate={handleNavigate}
      onViewModeChange={handleViewModeChange}
      selectedCountryCoverage={sidebar.selectedCountryCoverage}
      selectedCountryMeta={sidebar.selectedCountryMeta}
      sidebarTab={sidebar.sidebarTab}
      sourceBreakdownRef={sidebar.sourceBreakdownRef}
      sourceCount={sidebar.sourceCount}
      topSources={sidebar.topSources}
      topStoriesRef={sidebar.topStoriesRef}
      trendingTopicsRef={sidebar.trendingTopicsRef}
      viewMode={sidebar.viewMode}
    />
  );
};

type ExpandedTopNavAdapterProps = Readonly<{
  readonly navigation: GlobeViewExpandedDashboardProps["topNav"];
  readonly onClose: () => void;
}>;

const ExpandedTopNavAdapter = (props: ExpandedTopNavAdapterProps) => {
  const { navigation } = props;
  const { onClose: handleClose } = props;
  const { onNavigate: handleNavigate } = navigation;
  return (
    <ExpandedTopNav
      onClose={handleClose}
      lensBriefRef={navigation.lensBriefRef}
      onNavigate={handleNavigate}
      sidebarTab={navigation.sidebarTab}
      sourceBreakdownRef={navigation.sourceBreakdownRef}
      trendingTopicsRef={navigation.trendingTopicsRef}
    />
  );
};

type ExpandedSourcesAdapterProps = Readonly<{
  readonly sources: GlobeViewExpandedDashboardProps["sourcesTab"];
}>;

const ExpandedSourcesAdapter = (props: ExpandedSourcesAdapterProps) => {
  const { sources } = props;
  const { onArticleSelect: handleArticleSelect } = sources;
  return (
    <ExpandedSourcesTab
      articleCount={sources.articleCount}
      coverageBreakdown={sources.coverageBreakdown}
      coverageMapRef={sources.coverageMapRef}
      focusLabel={sources.focusLabel}
      onArticleSelect={handleArticleSelect}
      originVolume={sources.originVolume}
      selectedCountryCoverage={sources.selectedCountryCoverage}
      sourceBreakdownRef={sources.sourceBreakdownRef}
      sourceCount={sources.sourceCount}
      sourceCoverageLeaders={sources.sourceCoverageLeaders}
      sourceVolume={sources.sourceVolume}
      sourceWorkspace={sources.sourceWorkspace}
    />
  );
};

type ExpandedBriefingAdapterProps = Readonly<{
  readonly briefing: GlobeViewExpandedDashboardProps["briefingTab"];
}>;

const ExpandedBriefingAdapter = (props: ExpandedBriefingAdapterProps) => {
  const { briefing } = props;
  const {
    onArticleSelect: handleArticleSelect,
    onCycleSort: handleCycleSort,
    onToggleBookmark: handleToggleBookmark,
  } = briefing;
  return (
    <ExpandedBriefingTab
      articleCount={briefing.articleCount}
      coverageBreakdown={briefing.coverageBreakdown}
      coverageMapRef={briefing.coverageMapRef}
      expandedArticles={briefing.expandedArticles}
      expandedSort={briefing.expandedSort}
      onArticleSelect={handleArticleSelect}
      onCycleSort={handleCycleSort}
      onToggleBookmark={handleToggleBookmark}
      intensityScore={briefing.intensityScore}
      isBookmarked={briefing.isBookmarked}
      latestLensTimestamp={briefing.latestLensTimestamp}
      lensBriefRef={briefing.lensBriefRef}
      localLensData={briefing.localLensData}
      selectedCountry={briefing.selectedCountry}
      selectedCountryCoverage={briefing.selectedCountryCoverage}
      sourceBreakdownRef={briefing.sourceBreakdownRef}
      sourceSummary={briefing.sourceSummary}
      topicSignals={briefing.topicSignals}
      topStoriesRef={briefing.topStoriesRef}
      trendingTopicsRef={briefing.trendingTopicsRef}
    />
  );
};

type ExpandedRightSidebarAdapterProps = Readonly<{
  readonly sidebar: GlobeViewExpandedDashboardProps["rightSidebar"];
}>;

const ExpandedRightSidebarAdapter = (props: ExpandedRightSidebarAdapterProps) => {
  const { sidebar } = props;
  const {
    onLightingChange: handleLightingChange,
    onScrollTo: handleScrollTo,
    onViewModeChange: handleViewModeChange,
  } = sidebar;
  return (
    <ExpandedRightSidebar
      articleCount={sidebar.articleCount}
      countryMetrics={sidebar.countryMetrics}
      focusLabel={sidebar.focusLabel}
      onLightingChange={handleLightingChange}
      onScrollTo={handleScrollTo}
      onViewModeChange={handleViewModeChange}
      intensityScore={sidebar.intensityScore}
      lensBriefRef={sidebar.lensBriefRef}
      lightingMode={sidebar.lightingMode}
      selectedCountryCoverage={sidebar.selectedCountryCoverage}
      sourceCount={sidebar.sourceCount}
      topSources={sidebar.topSources}
      viewMode={sidebar.viewMode}
    />
  );
};

type ExpandedDashboardTabsProps = Readonly<{
  readonly briefing: GlobeViewExpandedDashboardProps["briefingTab"];
  readonly sidebarTab: string;
  readonly sources: GlobeViewExpandedDashboardProps["sourcesTab"];
}>;

const ExpandedDashboardTabs = (props: ExpandedDashboardTabsProps) => {
  if (props.sidebarTab === "sources") {
    return <ExpandedSourcesAdapter sources={props.sources} />;
  }
  return <ExpandedBriefingAdapter briefing={props.briefing} />;
};

type ExpandedDashboardMainColumnProps = Readonly<{
  readonly briefing: GlobeViewExpandedDashboardProps["briefingTab"];
  readonly navigation: GlobeViewExpandedDashboardProps["topNav"];
  readonly onClose: () => void;
  readonly sidebarTab: string;
  readonly sources: GlobeViewExpandedDashboardProps["sourcesTab"];
}>;

const ExpandedDashboardMainColumn = (props: ExpandedDashboardMainColumnProps) => (
  <div className="flex-1 flex flex-col min-w-0 bg-transparent">
    <ExpandedTopNavAdapter navigation={props.navigation} onClose={props.onClose} />
    <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
      <ExpandedDashboardTabs
        briefing={props.briefing}
        sidebarTab={props.sidebarTab}
        sources={props.sources}
      />
    </div>
  </div>
);

const ExpandedDashboardContent = (
  props: Readonly<{ readonly dashboard: GlobeViewExpandedDashboardProps }>,
) => {
  const { dashboard } = props;
  const { onClose: handleClose } = dashboard;
  return (
    <div className="relative z-10 flex h-full">
      <ExpandedLeftSidebarAdapter sidebar={dashboard.leftSidebar} />
      <ExpandedDashboardMainColumn
        briefing={dashboard.briefingTab}
        navigation={dashboard.topNav}
        onClose={handleClose}
        sidebarTab={dashboard.sidebarTab}
        sources={dashboard.sourcesTab}
      />
      <ExpandedRightSidebarAdapter sidebar={dashboard.rightSidebar} />
    </div>
  );
};

const GlobeViewExpandedDashboard = (props: GlobeViewExpandedDashboardProps) => (
  <div
    className={cn(
      "absolute inset-0 z-50 hidden text-foreground transition-all duration-500 lg:block",
      expandedDashboardVisibility(props.isFocusExpanded),
    )}
  >
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(186,137,63,0.14),transparent_28%),rgba(3,3,3,0.36)] backdrop-blur-md" />
    <ExpandedDashboardContent dashboard={props} />
  </div>
);

export { GlobeViewExpandedDashboard };
export type { GlobeViewExpandedDashboardProps };
