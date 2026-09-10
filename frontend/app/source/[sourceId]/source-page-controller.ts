import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useArticleDetail } from "@/hooks/use-article-detail";
import { useDebugMode } from "@/hooks/use-debug-mode";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsIndex } from "@/hooks/use-news-index";
import { getSourceById } from "@/lib/api";
import { navigateBack } from "./source-page-helpers";
import type { SourcePageRouter } from "./source-page-types";

const useSourcePageController = (sourceId: string) => {
  const router: SourcePageRouter = useRouter();
  const articleDetail = useArticleDetail();
  const debugMode = useDebugMode();
  const favorites = useFavorites();
  const sourceQuery = useQuery({
    queryFn: () => getSourceById(sourceId),
    queryKey: ["source", sourceId],
    staleTime: 1000 * 60 * 5,
  });
  const news = useNewsIndex({
    enabled: Boolean(sourceId),
    mode: "browse",
    sources: [sourceId],
  });
  const handleBack = useCallback(() => {
    navigateBack(router.back, router.push);
  }, [router.back, router.push]);

  return {
    articles: news.articles,
    articlesLoading: news.isLoading,
    debugMode,
    handleArticleClick: articleDetail.open,
    handleBack,
    handleCloseModal: articleDetail.close,
    isFavorite: favorites.isFavorite,
    modalOpen: articleDetail.isOpen,
    selectedArticle: articleDetail.article,
    source: sourceQuery.data,
    sourceError: sourceQuery.error,
    sourceLoading: sourceQuery.isLoading,
    toggleFavorite: favorites.toggleFavorite,
  };
};

export { useSourcePageController };
