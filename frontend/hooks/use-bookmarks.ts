import { useArticleReaction } from "./use-article-reaction";

export const useBookmarks = () => {
  const { error, ids, isLoaded, refresh, isSelected, isLoading, toggle } =
    useArticleReaction("bookmark");

  return {
    bookmarkIds: ids,
    error,
    isBookmarked: isSelected,
    isLoaded,
    isLoading,
    refresh,
    toggleBookmark: toggle,
  };
};
