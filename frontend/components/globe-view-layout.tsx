"use client";

import { ArticleDetailModal } from "./article-detail-modal";
import { CollapsedPanel } from "./globe-view-collapsed-panel";
import { FloatingHeader, IntensityPanel } from "./globe-view-shared";
import { GlobeViewExpandedDashboard } from "./globe-view-expanded-dashboard";
import { InteractiveGlobe } from "./interactive-globe";
import type { GlobeArticleModalProps, GlobeViewLayoutProps } from "./globe-view-layout-props";
import type { CollapsedPanelProps } from "./globe-view-collapsed-panel";
import type { FloatingHeaderProps, IntensityPanelProps } from "./globe-view-shared";
import type { GlobeViewExpandedDashboardProps } from "./globe-view-expanded-dashboard";

type GlobeFloatingHeaderAdapterProps = Readonly<{
  readonly header: FloatingHeaderProps;
}>;

const GlobeFloatingHeader = ({ header }: GlobeFloatingHeaderAdapterProps) => {
  const { onResetFocus: handleResetFocus } = header;
  return (
    <FloatingHeader
      articleCount={header.articleCount}
      focusLabel={header.focusLabel}
      globalArticleCount={header.globalArticleCount}
      isFocusExpanded={header.isFocusExpanded}
      localLensData={header.localLensData}
      onResetFocus={handleResetFocus}
      selectedCountry={header.selectedCountry}
    />
  );
};

type GlobeIntensityPanelAdapterProps = Readonly<{
  readonly panel: IntensityPanelProps;
}>;

const GlobeIntensityPanel = ({ panel }: GlobeIntensityPanelAdapterProps) => {
  const { onLightingChange: handleLightingChange } = panel;
  return (
    <IntensityPanel
      heatLabel={panel.heatLabel}
      isFocusExpanded={panel.isFocusExpanded}
      lightingMode={panel.lightingMode}
      onLightingChange={handleLightingChange}
    />
  );
};

type GlobeCollapsedPanelAdapterProps = Readonly<{
  readonly panel: CollapsedPanelProps;
}>;

const GlobeCollapsedPanel = ({ panel }: GlobeCollapsedPanelAdapterProps) => (
  <CollapsedPanel panel={panel} />
);

type GlobeExpandedDashboardAdapterProps = Readonly<{
  readonly dashboard: GlobeViewExpandedDashboardProps;
}>;

const GlobeExpandedDashboard = ({ dashboard }: GlobeExpandedDashboardAdapterProps) => {
  const { onClose: handleClose } = dashboard;
  return (
    <GlobeViewExpandedDashboard
      briefingTab={dashboard.briefingTab}
      isFocusExpanded={dashboard.isFocusExpanded}
      leftSidebar={dashboard.leftSidebar}
      onClose={handleClose}
      rightSidebar={dashboard.rightSidebar}
      sidebarTab={dashboard.sidebarTab}
      sourcesTab={dashboard.sourcesTab}
      topNav={dashboard.topNav}
    />
  );
};

type GlobeArticleModalAdapterProps = Readonly<{
  readonly modal: GlobeArticleModalProps;
}>;

const GlobeArticleModal = ({ modal }: GlobeArticleModalAdapterProps) => {
  const { onClose: handleClose } = modal;
  return <ArticleDetailModal article={modal.article} isOpen={modal.isOpen} onClose={handleClose} />;
};

const GlobeViewLayout = (props: GlobeViewLayoutProps) => {
  const { onCountrySelect: handleCountrySelect } = props;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <div className="absolute inset-0 z-0">
        <InteractiveGlobe
          articles={props.articles}
          countryMetrics={props.countryMetrics}
          onCountrySelect={handleCountrySelect}
          selectedCountry={props.selectedCountry}
          lightingMode={props.lightingMode}
        />
        <div className="pointer-events-none absolute inset-0 bg-black/20" />
      </div>
      <GlobeFloatingHeader header={props.floatingHeader} />
      <GlobeIntensityPanel panel={props.intensityPanel} />
      <GlobeCollapsedPanel panel={props.collapsedPanel} />
      <GlobeExpandedDashboard dashboard={props.expandedDashboard} />
      <GlobeArticleModal modal={props.articleModal} />
    </div>
  );
};

export { GlobeViewLayout };
