"use client";

import {
  DEFAULT_NEWS_RESEARCH_PAGE_SERVICES,
  useResearchPageController,
} from "./hooks/use-research-controller";
import type { NewsResearchPageServices } from "./hooks/use-research-controller";
import { ResearchPageView } from "./components/research-page";
import { Suspense } from "react";

const NewsResearchPageContent = ({ services }: { readonly services: NewsResearchPageServices }) => {
  const controller = useResearchPageController(services);
  return (
    <ResearchPageView
      sidebar={controller.sidebar}
      workspace={controller.workspace}
      articleModal={controller.articleModal}
    />
  );
};

const NewsResearchPage = ({
  services = DEFAULT_NEWS_RESEARCH_PAGE_SERVICES,
}: { readonly services?: NewsResearchPageServices } = {}) => (
  <Suspense fallback={null}>
    <NewsResearchPageContent services={services} />
  </Suspense>
);
export type { NewsResearchPageServices } from "./hooks/use-research-controller";
export default NewsResearchPage;
