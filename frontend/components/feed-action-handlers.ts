import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { NewsArticle } from "@/lib/api";

interface FeedActionHandlersOptions {
  readonly bookmarkIds: ReadonlySet<number>;
  readonly rankedArticles: readonly NewsArticle[];
  readonly selectedArticleIndex: number | null;
  readonly toggleLike: (articleId: number) => void | Promise<void>;
  readonly toggleBookmark: (articleId: number) => void | Promise<void>;
  readonly setSelectedArticle: Dispatch<SetStateAction<NewsArticle | null>>;
  readonly setSelectedArticleIndex: Dispatch<SetStateAction<number | null>>;
  readonly setIsArticleModalOpen: Dispatch<SetStateAction<boolean>>;
}

interface FeedActionHandlers {
  readonly handleLike: (articleId: number) => void;
  readonly handleBookmark: (articleId: number) => void;
  readonly handleModalBookmarkChange: (articleId: number, isBookmarked: boolean) => void;
  readonly handleArticlePreview: (article: NewsArticle, index: number) => void;
  readonly handleModalNavigate: (direction: "prev" | "next") => void;
  readonly handleModalClose: () => void;
}

type FeedArticleActionOptions = Pick<
  FeedActionHandlersOptions,
  "bookmarkIds" | "toggleLike" | "toggleBookmark"
>;

type FeedModalActionOptions = Pick<
  FeedActionHandlersOptions,
  | "rankedArticles"
  | "selectedArticleIndex"
  | "setSelectedArticle"
  | "setSelectedArticleIndex"
  | "setIsArticleModalOpen"
>;

const useFeedArticleActionHandlers = ({
  bookmarkIds,
  toggleLike,
  toggleBookmark,
}: FeedArticleActionOptions): Pick<
  FeedActionHandlers,
  "handleLike" | "handleBookmark" | "handleModalBookmarkChange"
> => {
  const handleLike = useCallback(
    (articleId: number) => {
      void toggleLike(articleId);
    },
    [toggleLike],
  );

  const handleBookmark = useCallback(
    (articleId: number) => {
      if (!articleId) {
        return;
      }
      void toggleBookmark(articleId);
    },
    [toggleBookmark],
  );

  const handleModalBookmarkChange = useCallback(
    (articleId: number, isBookmarked: boolean) => {
      if (isBookmarked !== bookmarkIds.has(articleId)) {
        void toggleBookmark(articleId);
      }
    },
    [bookmarkIds, toggleBookmark],
  );

  return { handleBookmark, handleLike, handleModalBookmarkChange };
};

const getModalNavigationIndex = (
  selectedArticleIndex: number,
  direction: "prev" | "next",
): number => {
  if (direction === "next") {
    return selectedArticleIndex + 1;
  }
  return selectedArticleIndex - 1;
};

const useFeedModalActionHandlers = ({
  rankedArticles,
  selectedArticleIndex,
  setSelectedArticle,
  setSelectedArticleIndex,
  setIsArticleModalOpen,
}: FeedModalActionOptions): Pick<
  FeedActionHandlers,
  "handleArticlePreview" | "handleModalNavigate" | "handleModalClose"
> => {
  const handleArticlePreview = useCallback(
    (article: NewsArticle, index: number) => {
      setSelectedArticle(article);
      setSelectedArticleIndex(index);
      setIsArticleModalOpen(true);
    },
    [setIsArticleModalOpen, setSelectedArticle, setSelectedArticleIndex],
  );

  const handleModalNavigate = useCallback(
    (direction: "prev" | "next") => {
      if (selectedArticleIndex === null) {
        return;
      }

      const nextIndex = getModalNavigationIndex(selectedArticleIndex, direction);
      if (nextIndex < 0 || nextIndex >= rankedArticles.length) {
        return;
      }

      setSelectedArticleIndex(nextIndex);
      setSelectedArticle(rankedArticles[nextIndex] ?? null);
    },
    [rankedArticles, selectedArticleIndex, setSelectedArticle, setSelectedArticleIndex],
  );

  const handleModalClose = useCallback(() => {
    setIsArticleModalOpen(false);
    setSelectedArticle(null);
    setSelectedArticleIndex(null);
  }, [setIsArticleModalOpen, setSelectedArticle, setSelectedArticleIndex]);

  return {
    handleArticlePreview,
    handleModalClose,
    handleModalNavigate,
  };
};

const useFeedActionHandlers = (options: FeedActionHandlersOptions): FeedActionHandlers => {
  const articleHandlers = useFeedArticleActionHandlers(options);
  const modalHandlers = useFeedModalActionHandlers(options);

  return {
    handleArticlePreview: modalHandlers.handleArticlePreview,
    handleBookmark: articleHandlers.handleBookmark,
    handleLike: articleHandlers.handleLike,
    handleModalBookmarkChange: articleHandlers.handleModalBookmarkChange,
    handleModalClose: modalHandlers.handleModalClose,
    handleModalNavigate: modalHandlers.handleModalNavigate,
  };
};

export { useFeedActionHandlers };
