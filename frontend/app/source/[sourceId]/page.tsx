"use client";

import { use } from "react";
import { getWebsiteHostname } from "./source-page-helpers";
import { useSourcePageController } from "./source-page-controller";
import { SourcePageError, SourcePageLayout, SourcePageLoading } from "./source-page-shell";
import type { SourcePageProps } from "./source-page-types";

const SourcePage = (props: Readonly<SourcePageProps>) => {
  const params = use(props.params);
  const sourceId = decodeURIComponent(params.sourceId);
  const controller = useSourcePageController(sourceId);

  if (controller.sourceLoading) {
    return <SourcePageLoading />;
  }
  if (controller.sourceError || controller.source === undefined) {
    return (
      <SourcePageError
        hasError={controller.sourceError !== null && controller.sourceError !== undefined}
        onBack={controller.handleBack}
      />
    );
  }
  return (
    <SourcePageLayout
      source={controller.source}
      websiteHostname={getWebsiteHostname(controller.source.url)}
      debugMode={controller.debugMode}
      isFavorite={controller.isFavorite}
      toggleFavorite={controller.toggleFavorite}
      onBack={controller.handleBack}
      articles={controller.articles}
      articlesLoading={controller.articlesLoading}
      selectedArticle={controller.selectedArticle}
      modalOpen={controller.modalOpen}
      onArticleClick={controller.handleArticleClick}
      onCloseModal={controller.handleCloseModal}
    />
  );
};

export default SourcePage;
