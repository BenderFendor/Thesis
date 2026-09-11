"use client";

import { fetchCountryGeoData } from "@/lib/api";
import type { NewsArticle } from "@/lib/api";
import { useGlobeInteractionActions, useGlobeSelectionState } from "@/components/globe-ui-state";
import { useGlobeDisplayData } from "@/components/globe-view-model";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useQuery } from "@tanstack/react-query";
import type { GlobeViewLayoutInputs, GlobeViewLayoutProps } from "./globe-view-layout-props";
import { buildGlobeViewLayoutProps } from "./globe-view-layout-props";

type GlobeSelectionState = Pick<
  GlobeViewLayoutInputs,
  | "earthLightingMode"
  | "expandedSort"
  | "isArticleModalOpen"
  | "isFocusExpanded"
  | "isMobileSheetExpanded"
  | "lensBriefRef"
  | "selectedArticle"
  | "selectedCountry"
  | "setEarthLightingMode"
  | "setIsArticleModalOpen"
  | "setIsFocusExpanded"
  | "setLensLimit"
  | "setSidebarTab"
  | "setViewMode"
  | "sidebarTab"
  | "sourceBreakdownRef"
  | "topStoriesRef"
  | "trendingTopicsRef"
  | "coverageMapRef"
  | "viewMode"
>;

type GlobeDisplayState = Pick<
  GlobeViewLayoutInputs,
  | "articleCount"
  | "countryMetrics"
  | "coverageBreakdown"
  | "expandedArticles"
  | "focusLabel"
  | "heatLabel"
  | "intensityScore"
  | "latestLensTimestamp"
  | "lensArticles"
  | "localLensData"
  | "selectedCountryCoverage"
  | "selectedCountryMeta"
  | "selectedCountryMentionVolume"
  | "selectedCountryOriginVolume"
  | "selectedCountrySourceVolume"
  | "sourceCount"
  | "sourceCoverageLeaders"
  | "sourceSummary"
  | "sourceWorkspace"
  | "topSources"
  | "topicSignals"
  | "verificationStats"
>;

type GlobeActionState = Pick<
  GlobeViewLayoutInputs,
  | "cancelSheetDrag"
  | "cycleExpandedSort"
  | "finishSheetDrag"
  | "handleArticleSelect"
  | "handleCountrySelect"
  | "handleQuickNav"
  | "handleSheetDragMove"
  | "handleSheetDragStart"
  | "handleSheetHandleClick"
  | "scrollToSection"
  | "setAllLit"
  | "setDayNight"
  | "toggleMobileSheet"
>;

type GlobeBookmarkState = Pick<GlobeViewLayoutInputs, "isBookmarked" | "toggleBookmark">;

interface GlobeViewRuntimeParts {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
  readonly selectionState: GlobeSelectionState;
  readonly displayData: GlobeDisplayState;
  readonly actions: GlobeActionState;
  readonly bookmarks: GlobeBookmarkState;
}

type GlobeSelectionInputs = GlobeSelectionState;
type GlobeDisplayInputs = GlobeDisplayState;
type GlobeActionInputs = Pick<
  GlobeViewLayoutInputs,
  | "cancelSheetDrag"
  | "cycleExpandedSort"
  | "finishSheetDrag"
  | "handleArticleSelect"
  | "handleCountrySelect"
  | "handleQuickNav"
  | "handleResetFocus"
  | "handleSheetDragMove"
  | "handleSheetDragStart"
  | "handleSheetHandleClick"
  | "scrollToSection"
  | "setAllLit"
  | "setDayNight"
  | "toggleMobileSheet"
>;

const buildSelectionInputs = (state: GlobeSelectionState): GlobeSelectionInputs => ({
  coverageMapRef: state.coverageMapRef,
  earthLightingMode: state.earthLightingMode,
  expandedSort: state.expandedSort,
  isArticleModalOpen: state.isArticleModalOpen,
  isFocusExpanded: state.isFocusExpanded,
  isMobileSheetExpanded: state.isMobileSheetExpanded,
  lensBriefRef: state.lensBriefRef,
  selectedArticle: state.selectedArticle,
  selectedCountry: state.selectedCountry,
  setEarthLightingMode: state.setEarthLightingMode,
  setIsArticleModalOpen: state.setIsArticleModalOpen,
  setIsFocusExpanded: state.setIsFocusExpanded,
  setLensLimit: state.setLensLimit,
  setSidebarTab: state.setSidebarTab,
  setViewMode: state.setViewMode,
  sidebarTab: state.sidebarTab,
  sourceBreakdownRef: state.sourceBreakdownRef,
  topStoriesRef: state.topStoriesRef,
  trendingTopicsRef: state.trendingTopicsRef,
  viewMode: state.viewMode,
});

const buildDisplayInputs = (data: GlobeDisplayState): GlobeDisplayInputs => ({
  articleCount: data.articleCount,
  countryMetrics: data.countryMetrics,
  coverageBreakdown: data.coverageBreakdown,
  expandedArticles: data.expandedArticles,
  focusLabel: data.focusLabel,
  heatLabel: data.heatLabel,
  intensityScore: data.intensityScore,
  latestLensTimestamp: data.latestLensTimestamp,
  lensArticles: data.lensArticles,
  localLensData: data.localLensData,
  selectedCountryCoverage: data.selectedCountryCoverage,
  selectedCountryMentionVolume: data.selectedCountryMentionVolume,
  selectedCountryMeta: data.selectedCountryMeta,
  selectedCountryOriginVolume: data.selectedCountryOriginVolume,
  selectedCountrySourceVolume: data.selectedCountrySourceVolume,
  sourceCount: data.sourceCount,
  sourceCoverageLeaders: data.sourceCoverageLeaders,
  sourceSummary: data.sourceSummary,
  sourceWorkspace: data.sourceWorkspace,
  topSources: data.topSources,
  topicSignals: data.topicSignals,
  verificationStats: data.verificationStats,
});

const buildActionInputs = (actions: GlobeActionState): GlobeActionInputs => ({
  cancelSheetDrag: actions.cancelSheetDrag,
  cycleExpandedSort: actions.cycleExpandedSort,
  finishSheetDrag: actions.finishSheetDrag,
  handleArticleSelect: actions.handleArticleSelect,
  handleCountrySelect: actions.handleCountrySelect,
  handleQuickNav: actions.handleQuickNav,
  handleResetFocus: () => {
    actions.handleCountrySelect(null);
  },
  handleSheetDragMove: actions.handleSheetDragMove,
  handleSheetDragStart: actions.handleSheetDragStart,
  handleSheetHandleClick: actions.handleSheetHandleClick,
  scrollToSection: actions.scrollToSection,
  setAllLit: actions.setAllLit,
  setDayNight: actions.setDayNight,
  toggleMobileSheet: actions.toggleMobileSheet,
});

const buildBookmarkInputs = (
  bookmarks: GlobeBookmarkState,
): Pick<GlobeViewLayoutInputs, "isBookmarked" | "toggleBookmark"> => ({
  isBookmarked: bookmarks.isBookmarked,
  toggleBookmark: bookmarks.toggleBookmark,
});

const buildLayoutInputs = (runtime: GlobeViewRuntimeParts): GlobeViewLayoutInputs => ({
  ...buildActionInputs(runtime.actions),
  ...buildBookmarkInputs(runtime.bookmarks),
  ...buildDisplayInputs(runtime.displayData),
  ...buildSelectionInputs(runtime.selectionState),
  articles: runtime.articles,
  loading: runtime.loading,
});

const useGlobeViewRuntime = (
  articles: readonly NewsArticle[],
  loading: boolean,
): GlobeViewRuntimeParts => {
  const selectionState = useGlobeSelectionState();
  const bookmarks = useBookmarks();
  const { data: geoData } = useQuery({
    queryFn: fetchCountryGeoData,
    queryKey: ["country-geo-data"],
    staleTime: Infinity,
  });
  const actions = useGlobeInteractionActions(selectionState, geoData);
  const displayData = useGlobeDisplayData({
    articles,
    expandedSort: selectionState.expandedSort,
    geoData,
    lensLimit: selectionState.lensLimit,
    selectedCountry: selectionState.selectedCountry,
    selectedCountryName: selectionState.selectedCountryName,
    viewMode: selectionState.viewMode,
  });
  return { actions, articles, bookmarks, displayData, loading, selectionState };
};

const useGlobeViewLayout = (
  articles: readonly NewsArticle[],
  loading: boolean,
): GlobeViewLayoutProps =>
  buildGlobeViewLayoutProps(buildLayoutInputs(useGlobeViewRuntime(articles, loading)));

export { useGlobeViewLayout };
