import { useBookmarks } from "./useBookmarks"
import { useDebugMode } from "./use-debug-mode"
import { useFavorites } from "./use-favorites"
import { useInlineDefinition } from "./use-inline-definition"
import { useLikedArticles } from "./use-liked-articles"
import { useReadingHistory } from "./useReadingHistory"
import { useReadingQueue } from "./use-reading-queue"

const useModalIntegrations = () => {
  const bookmarks = useBookmarks(),
   debugMode = useDebugMode(),
   favorites = useFavorites(),
   inlineDefinition = useInlineDefinition(),
   likedArticles = useLikedArticles(),
   readingHistory = useReadingHistory(),
   readingQueue = useReadingQueue()

  return {
    bookmarks,
    debugMode,
    favorites,
    inlineDefinition,
    likedArticles,
    readingHistory,
    readingQueue,
  }
}

export { useModalIntegrations }
