"use client";

import type { NewsArticle } from "@/lib/api";
import { GlobeViewLayout } from "./globe-view-layout";
import { useGlobeViewLayout } from "./globe-view-runtime";

interface GlobeViewProps {
  readonly articles: readonly NewsArticle[];
  readonly loading: boolean;
}

const GlobeViewContent = (props: GlobeViewProps) => {
  const layoutProps = useGlobeViewLayout(props.articles, props.loading);
  const { onCountrySelect: handleCountrySelect } = layoutProps;
  return (
    <GlobeViewLayout
      articles={layoutProps.articles}
      countryMetrics={layoutProps.countryMetrics}
      onCountrySelect={handleCountrySelect}
      selectedCountry={layoutProps.selectedCountry}
      lightingMode={layoutProps.lightingMode}
      floatingHeader={layoutProps.floatingHeader}
      intensityPanel={layoutProps.intensityPanel}
      collapsedPanel={layoutProps.collapsedPanel}
      expandedDashboard={layoutProps.expandedDashboard}
      articleModal={layoutProps.articleModal}
    />
  );
};

export const GlobeView = ({ articles, loading }: GlobeViewProps) => (
  <GlobeViewContent articles={articles} loading={loading} />
);
