import type { NewsArticle, CountryListItem } from "@/lib/api";
import type { RefObject } from "react";
import type { LightingMode } from "@/components/globe-ui-state";
import type { CollapsedPanelProps } from "./globe-view-collapsed-panel";
import type {
  FloatingHeaderProps,
  GlobeLensResponse,
  IntensityPanelProps,
} from "./globe-view-shared";
import type { GlobeViewExpandedDashboardProps } from "./globe-view-expanded-dashboard";
import type {
  CountrySelection,
  CoverageEntry,
  ExpandedSortMode,
  ReadonlyCountryArticleCounts,
  SourceSummaryEntry,
  TopicSignalEntry,
  WorkspaceLeader,
  WorkspaceSource,
} from "@/lib/globe-workspace";

interface GlobeArticleModalProps {
  readonly article: NewsArticle | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

interface GlobeViewLayoutProps {
  readonly articles: readonly NewsArticle[];
  readonly countryMetrics: ReadonlyCountryArticleCounts;
  readonly onCountrySelect: (country: string | null) => void;
  readonly selectedCountry: string | null;
  readonly lightingMode: LightingMode;
  readonly floatingHeader: FloatingHeaderProps;
  readonly intensityPanel: IntensityPanelProps;
  readonly collapsedPanel: CollapsedPanelProps;
  readonly expandedDashboard: GlobeViewExpandedDashboardProps;
  readonly articleModal: GlobeArticleModalProps;
}

interface GlobeViewLayoutInputs {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
  readonly countryMetrics: ReadonlyCountryArticleCounts;
  readonly earthLightingMode: LightingMode;
  readonly expandedSort: ExpandedSortMode;
  readonly isArticleModalOpen: boolean;
  readonly isFocusExpanded: boolean;
  readonly isMobileSheetExpanded: boolean;
  readonly lensBriefRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly selectedArticle: NewsArticle | null;
  readonly selectedCountry: CountrySelection;
  readonly setEarthLightingMode: (mode: LightingMode) => void;
  readonly setIsArticleModalOpen: (open: boolean) => void;
  readonly setIsFocusExpanded: (open: boolean) => void;
  readonly setLensLimit: (value: number | ((current: number) => number)) => void;
  readonly setSidebarTab: (value: string) => void;
  readonly setViewMode: (value: "internal" | "external") => void;
  readonly sidebarTab: string;
  readonly sourceBreakdownRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly topStoriesRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly trendingTopicsRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly coverageMapRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly viewMode: "internal" | "external";
  readonly articleCount: number;
  readonly coverageBreakdown: readonly CoverageEntry[];
  readonly expandedArticles: readonly NewsArticle[];
  readonly focusLabel: string;
  readonly heatLabel: string;
  readonly intensityScore: number;
  readonly latestLensTimestamp: number | undefined;
  readonly lensArticles: readonly NewsArticle[];
  readonly localLensData: GlobeLensResponse | undefined;
  readonly selectedCountryCoverage: number;
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined;
  readonly selectedCountryMentionVolume: number;
  readonly selectedCountryOriginVolume: number;
  readonly selectedCountrySourceVolume: number;
  readonly sourceCount: number;
  readonly sourceCoverageLeaders: readonly WorkspaceLeader[];
  readonly sourceSummary: readonly SourceSummaryEntry[];
  readonly sourceWorkspace: readonly WorkspaceSource[];
  readonly topSources: readonly SourceSummaryEntry[];
  readonly topicSignals: readonly TopicSignalEntry[];
  readonly verificationStats: Readonly<{ readonly highPct: number }>;
  readonly cancelSheetDrag: CollapsedPanelProps["onHandlePointerCancel"];
  readonly cycleExpandedSort: () => void;
  readonly finishSheetDrag: CollapsedPanelProps["onHandlePointerUp"];
  readonly handleArticleSelect: (article: NewsArticle) => void;
  readonly handleCountrySelect: (country: CountrySelection, name?: string | null) => void;
  readonly handleQuickNav: (
    tab: "briefing" | "intelligence" | "sources",
    ref: Readonly<RefObject<HTMLDivElement | null>>,
  ) => void;
  readonly handleResetFocus: () => void;
  readonly handleSheetDragMove: CollapsedPanelProps["onHandlePointerMove"];
  readonly handleSheetDragStart: CollapsedPanelProps["onHandlePointerDown"];
  readonly handleSheetHandleClick: () => void;
  readonly scrollToSection: (ref: Readonly<RefObject<HTMLDivElement | null>>) => void;
  readonly setAllLit: () => void;
  readonly setDayNight: () => void;
  readonly toggleMobileSheet: () => void;
  readonly isBookmarked: (articleId: number) => boolean;
  readonly toggleBookmark: (articleId: number) => Promise<void>;
}

const buildFloatingHeader = (inputs: GlobeViewLayoutInputs): FloatingHeaderProps => ({
  articleCount: inputs.articleCount,
  focusLabel: inputs.focusLabel,
  globalArticleCount: inputs.articles.length,
  isFocusExpanded: inputs.isFocusExpanded,
  localLensData: inputs.localLensData,
  onResetFocus: inputs.handleResetFocus,
  selectedCountry: inputs.selectedCountry,
});

const buildIntensityPanel = (inputs: GlobeViewLayoutInputs): IntensityPanelProps => ({
  heatLabel: inputs.heatLabel,
  isFocusExpanded: inputs.isFocusExpanded,
  lightingMode: inputs.earthLightingMode,
  onLightingChange: inputs.setEarthLightingMode,
});

const buildCollapsedPanel = (inputs: GlobeViewLayoutInputs): CollapsedPanelProps => ({
  articleCount: inputs.articleCount,
  coverage: inputs.selectedCountryCoverage,
  focusLabel: inputs.focusLabel,
  highPct: inputs.verificationStats.highPct,
  isFocusExpanded: inputs.isFocusExpanded,
  isMobileSheetExpanded: inputs.isMobileSheetExpanded,
  lensArticles: inputs.lensArticles,
  lightingMode: inputs.earthLightingMode,
  loading: inputs.loading,
  localLensData: inputs.localLensData,
  mentionVolume: inputs.selectedCountryMentionVolume,
  onArticleSelect: inputs.handleArticleSelect,
  onExpandFocus: () => {
    inputs.setIsFocusExpanded(true);
  },
  onHandleClick: inputs.handleSheetHandleClick,
  onHandlePointerCancel: inputs.cancelSheetDrag,
  onHandlePointerDown: inputs.handleSheetDragStart,
  onHandlePointerMove: inputs.handleSheetDragMove,
  onHandlePointerUp: inputs.finishSheetDrag,
  onLoadMore: () => {
    inputs.setLensLimit((current) => current + 20);
  },
  onResetFocus: inputs.handleResetFocus,
  onSetAllLit: inputs.setAllLit,
  onSetDayNight: inputs.setDayNight,
  onSidebarTabChange: inputs.setSidebarTab,
  onToggleMobileSheet: inputs.toggleMobileSheet,
  onViewModeChange: inputs.setViewMode,
  originVolume: inputs.selectedCountryOriginVolume,
  selectedCountry: inputs.selectedCountry,
  selectedCountryCoverage: inputs.selectedCountryCoverage,
  selectedCountryMeta: inputs.selectedCountryMeta,
  sidebarTab: inputs.sidebarTab,
  sourceCount: inputs.sourceCount,
  sourceSummaryLength: inputs.sourceSummary.length,
  sourceVolume: inputs.selectedCountrySourceVolume,
  sourceWorkspace: inputs.sourceWorkspace,
  topSources: inputs.topSources,
  viewMode: inputs.viewMode,
});

const buildBriefingTab = (
  inputs: GlobeViewLayoutInputs,
): GlobeViewExpandedDashboardProps["briefingTab"] => ({
  articleCount: inputs.articleCount,
  coverageBreakdown: inputs.coverageBreakdown,
  coverageMapRef: inputs.coverageMapRef,
  expandedArticles: inputs.expandedArticles,
  expandedSort: inputs.expandedSort,
  intensityScore: inputs.intensityScore,
  isBookmarked: inputs.isBookmarked,
  latestLensTimestamp: inputs.latestLensTimestamp,
  lensBriefRef: inputs.lensBriefRef,
  localLensData: inputs.localLensData,
  onArticleSelect: inputs.handleArticleSelect,
  onCycleSort: inputs.cycleExpandedSort,
  onToggleBookmark: inputs.toggleBookmark,
  selectedCountry: inputs.selectedCountry,
  selectedCountryCoverage: inputs.selectedCountryCoverage,
  sourceBreakdownRef: inputs.sourceBreakdownRef,
  sourceSummary: inputs.sourceSummary,
  topStoriesRef: inputs.topStoriesRef,
  topicSignals: inputs.topicSignals,
  trendingTopicsRef: inputs.trendingTopicsRef,
});

const buildLeftSidebar = (
  inputs: GlobeViewLayoutInputs,
): GlobeViewExpandedDashboardProps["leftSidebar"] => ({
  articleCount: inputs.articleCount,
  coverageMapRef: inputs.coverageMapRef,
  focusLabel: inputs.focusLabel,
  lensBriefRef: inputs.lensBriefRef,
  onNavigate: inputs.handleQuickNav,
  onViewModeChange: inputs.setViewMode,
  selectedCountryCoverage: inputs.selectedCountryCoverage,
  selectedCountryMeta: inputs.selectedCountryMeta,
  sidebarTab: inputs.sidebarTab,
  sourceBreakdownRef: inputs.sourceBreakdownRef,
  sourceCount: inputs.sourceCount,
  topSources: inputs.topSources,
  topStoriesRef: inputs.topStoriesRef,
  trendingTopicsRef: inputs.trendingTopicsRef,
  viewMode: inputs.viewMode,
});

const buildRightSidebar = (
  inputs: GlobeViewLayoutInputs,
): GlobeViewExpandedDashboardProps["rightSidebar"] => ({
  articleCount: inputs.articleCount,
  countryMetrics: inputs.countryMetrics,
  focusLabel: inputs.focusLabel,
  intensityScore: inputs.intensityScore,
  lensBriefRef: inputs.lensBriefRef,
  lightingMode: inputs.earthLightingMode,
  onLightingChange: inputs.setEarthLightingMode,
  onScrollTo: inputs.scrollToSection,
  onViewModeChange: inputs.setViewMode,
  selectedCountryCoverage: inputs.selectedCountryCoverage,
  sourceCount: inputs.sourceCount,
  topSources: inputs.topSources,
  viewMode: inputs.viewMode,
});

const buildSourcesTab = (
  inputs: GlobeViewLayoutInputs,
): GlobeViewExpandedDashboardProps["sourcesTab"] => ({
  articleCount: inputs.articleCount,
  coverageBreakdown: inputs.coverageBreakdown,
  coverageMapRef: inputs.coverageMapRef,
  focusLabel: inputs.focusLabel,
  onArticleSelect: inputs.handleArticleSelect,
  originVolume: inputs.selectedCountryOriginVolume,
  selectedCountryCoverage: inputs.selectedCountryCoverage,
  sourceBreakdownRef: inputs.sourceBreakdownRef,
  sourceCount: inputs.sourceCount,
  sourceCoverageLeaders: inputs.sourceCoverageLeaders,
  sourceVolume: inputs.selectedCountrySourceVolume,
  sourceWorkspace: inputs.sourceWorkspace,
});

const buildTopNav = (inputs: GlobeViewLayoutInputs): GlobeViewExpandedDashboardProps["topNav"] => ({
  lensBriefRef: inputs.lensBriefRef,
  onNavigate: inputs.handleQuickNav,
  sidebarTab: inputs.sidebarTab,
  sourceBreakdownRef: inputs.sourceBreakdownRef,
  trendingTopicsRef: inputs.trendingTopicsRef,
});

const buildExpandedDashboard = (
  inputs: GlobeViewLayoutInputs,
): GlobeViewExpandedDashboardProps => ({
  briefingTab: buildBriefingTab(inputs),
  isFocusExpanded: inputs.isFocusExpanded,
  leftSidebar: buildLeftSidebar(inputs),
  onClose: () => {
    inputs.setIsFocusExpanded(false);
  },
  rightSidebar: buildRightSidebar(inputs),
  sidebarTab: inputs.sidebarTab,
  sourcesTab: buildSourcesTab(inputs),
  topNav: buildTopNav(inputs),
});

const buildArticleModal = (inputs: GlobeViewLayoutInputs): GlobeArticleModalProps => ({
  article: inputs.selectedArticle,
  isOpen: inputs.isArticleModalOpen,
  onClose: () => {
    inputs.setIsArticleModalOpen(false);
  },
});

const buildGlobeViewLayoutProps = (inputs: GlobeViewLayoutInputs): GlobeViewLayoutProps => ({
  articleModal: buildArticleModal(inputs),
  articles: inputs.articles,
  collapsedPanel: buildCollapsedPanel(inputs),
  countryMetrics: inputs.countryMetrics,
  expandedDashboard: buildExpandedDashboard(inputs),
  floatingHeader: buildFloatingHeader(inputs),
  intensityPanel: buildIntensityPanel(inputs),
  lightingMode: inputs.earthLightingMode,
  onCountrySelect: inputs.handleCountrySelect,
  selectedCountry: inputs.selectedCountry,
});

export { buildGlobeViewLayoutProps };
export type { GlobeArticleModalProps, GlobeViewLayoutInputs, GlobeViewLayoutProps };
