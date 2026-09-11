import { cn } from "@/lib/utils";
import type { NewsArticle } from "@/lib/api";
import type { WorkspaceSource } from "@/lib/globe-workspace";
import type { LensViewMode } from "@/components/globe-ui-state";
import { hasCountrySelection } from "@/lib/globe-workspace";
import type { GlobeLensResponse } from "./globe-view-shared";
import { CollapsedPanelHeader } from "./globe-view-collapsed-header";
import type { CollapsedPanelHeaderProps } from "./globe-view-collapsed-header";
import { CollapsedBriefingTab, CollapsedIntelligenceTab } from "./globe-view-collapsed-tabs";
import { CollapsedSourcesTab } from "./globe-view-collapsed-sources";

interface CollapsedPanelProps extends CollapsedPanelHeaderProps {
  readonly isFocusExpanded: boolean;
  readonly viewMode: LensViewMode;
  readonly onViewModeChange: (value: LensViewMode) => void;
  readonly localLensData: GlobeLensResponse | undefined;
  readonly loading: boolean;
  readonly lensArticles: readonly NewsArticle[];
  readonly onArticleSelect: (article: NewsArticle) => void;
  readonly onLoadMore: () => void;
  readonly sourceWorkspace: readonly WorkspaceSource[];
  readonly sourceSummaryLength: number;
  readonly highPct: number;
  readonly originVolume: number;
  readonly sourceVolume: number;
  readonly mentionVolume: number;
  readonly coverage: number;
}

const collapsedPanelSize = (selectedCountry: CollapsedPanelProps["selectedCountry"]): string => {
  if (hasCountrySelection(selectedCountry)) {
    return "bottom-0 left-0 right-0 translate-y-0 overflow-y-auto rounded-t-3xl lg:bottom-4 lg:right-4 lg:top-4 lg:left-auto lg:h-auto lg:w-[420px] lg:rounded-2xl lg:overflow-hidden";
  }
  return "bottom-0 left-0 right-0 translate-y-0 overflow-y-auto rounded-t-3xl lg:bottom-4 lg:right-4 lg:top-auto lg:left-auto lg:h-auto lg:w-[420px] lg:translate-y-0 lg:rounded-2xl lg:overflow-hidden";
};

const collapsedPanelHeight = (
  props: Readonly<Pick<CollapsedPanelProps, "isMobileSheetExpanded" | "selectedCountry">>,
): string => {
  if (props.isMobileSheetExpanded) {
    return "h-[58vh]";
  }
  if (hasCountrySelection(props.selectedCountry)) {
    return "max-h-[26vh]";
  }
  return "max-h-[28vh]";
};

const collapsedPanelVisibility = (isFocusExpanded: boolean): string => {
  if (isFocusExpanded) {
    return "hidden opacity-0 pointer-events-none";
  }
  return "opacity-100 pointer-events-auto";
};

const collapsedPanelClassName = (
  props: Readonly<
    Pick<CollapsedPanelProps, "isFocusExpanded" | "isMobileSheetExpanded" | "selectedCountry">
  >,
): string => {
  const panelSize = collapsedPanelSize(props.selectedCountry);
  const heightClass = collapsedPanelHeight(props);
  const visibilityClass = collapsedPanelVisibility(props.isFocusExpanded);
  return cn(
    "absolute z-40 flex flex-col border border-white/10 bg-black/55 shadow-2xl backdrop-blur-2xl transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height,max-height]",
    panelSize,
    heightClass,
    visibilityClass,
  );
};

type CollapsedPanelTabAdapterProps = Readonly<{
  readonly panel: CollapsedPanelProps;
}>;

const CollapsedBriefingPanelTab = (props: CollapsedPanelTabAdapterProps) => {
  const { panel } = props;
  const {
    onArticleSelect: handleArticleSelect,
    onLoadMore: handleLoadMore,
    onViewModeChange: handleViewModeChange,
  } = panel;
  return (
    <CollapsedBriefingTab
      lensArticles={panel.lensArticles}
      localLensData={panel.localLensData}
      loading={panel.loading}
      onArticleSelect={handleArticleSelect}
      onLoadMore={handleLoadMore}
      onViewModeChange={handleViewModeChange}
      selectedCountry={panel.selectedCountry}
      selectedCountryMeta={panel.selectedCountryMeta}
      viewMode={panel.viewMode}
    />
  );
};

const CollapsedIntelligencePanelTab = (props: CollapsedPanelTabAdapterProps) => {
  const { panel } = props;
  const { onArticleSelect: handleArticleSelect } = panel;
  return (
    <CollapsedIntelligenceTab
      articleCount={panel.articleCount}
      coverage={panel.coverage}
      focusLabel={panel.focusLabel}
      highPct={panel.highPct}
      lensArticles={panel.lensArticles}
      mentionVolume={panel.mentionVolume}
      onArticleSelect={handleArticleSelect}
      originVolume={panel.originVolume}
      selectedCountry={panel.selectedCountry}
      sourceCount={panel.sourceCount}
      sourceSummaryLength={panel.sourceSummaryLength}
      sourceVolume={panel.sourceVolume}
    />
  );
};

const CollapsedSourcesPanelTab = (props: CollapsedPanelTabAdapterProps) => {
  const { panel } = props;
  const { onArticleSelect: handleArticleSelect } = panel;
  return (
    <CollapsedSourcesTab
      focusLabel={panel.focusLabel}
      onArticleSelect={handleArticleSelect}
      selectedCountry={panel.selectedCountry}
      sourceCount={panel.sourceCount}
      sourceSummaryLength={panel.sourceSummaryLength}
      sourceWorkspace={panel.sourceWorkspace}
    />
  );
};

const CollapsedPanelTabContent = (props: CollapsedPanelTabAdapterProps) => {
  if (props.panel.sidebarTab === "briefing") {
    return <CollapsedBriefingPanelTab panel={props.panel} />;
  }
  if (props.panel.sidebarTab === "intelligence") {
    return <CollapsedIntelligencePanelTab panel={props.panel} />;
  }
  return <CollapsedSourcesPanelTab panel={props.panel} />;
};

const CollapsedPanelContent = (props: Readonly<{ readonly panel: CollapsedPanelProps }>) => (
  <div
    className={cn(
      "relative flex min-h-0 flex-1 flex-col lg:overflow-hidden",
      !props.panel.isMobileSheetExpanded && "hidden lg:flex",
    )}
  >
    <CollapsedPanelTabContent panel={props.panel} />
  </div>
);

type CollapsedPanelAdapterProps = Readonly<{
  readonly panel: CollapsedPanelProps;
}>;

const CollapsedPanel = (props: CollapsedPanelAdapterProps) => (
  <div className={collapsedPanelClassName(props.panel)}>
    <CollapsedPanelHeader header={props.panel} />
    <CollapsedPanelContent panel={props.panel} />
  </div>
);

export { CollapsedPanel };
export type { CollapsedPanelProps };
