import { useArticleReaction } from "./use-article-reaction";

export function useLikedArticles() {
  const { error, ids, isLoaded, refresh, isSelected, isLoading, toggle } =
    useArticleReaction("like");

  return {
    error: error?.message ?? null,
    isLiked: isSelected,
    isLoaded,
    isLoading,
    likedIds: ids,
    refresh,
    toggleLike: toggle,
  };
}
