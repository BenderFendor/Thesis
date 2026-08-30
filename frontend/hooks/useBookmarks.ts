import { createBookmark, deleteBookmark, fetchBookmarks } from "@/lib/api"
import { useCallback, useEffect, useState } from "react"

type BookmarkListener = (ids: ReadonlySet<number>) => void

let bookmarkCache: Set<number> | null,
  bookmarkLoaded: boolean,
  bookmarkLoading: boolean

export const bookmarkListeners = new Set<BookmarkListener>(),
  loadBookmarksFromApi = async () => {
    if (bookmarkLoading) {
      return
    }
    bookmarkLoading = true
    try {
      const entries = await fetchBookmarks()
      bookmarkCache = new Set(entries.map((entry) => entry.articleId))
      bookmarkLoaded = true
      notifyBookmarkListeners(bookmarkCache)
    } catch (error) {
      console.error("Failed to load bookmarks:", error)
    } finally {
      bookmarkLoading = false
    }
  },
  persistBookmark = async (wasBookmarked: boolean, articleId: number) => {
    if (!wasBookmarked) {
      await createBookmark(articleId)
      return
    }
    await deleteBookmark(articleId)
  },
  toggleBookmarkState = (articleId: number) => {
    const current = bookmarkCache ?? new Set<number>(),
      next = new Set(current),
      wasBookmarked = next.has(articleId)

    if (wasBookmarked) {
      next.delete(articleId)
    } else {
      next.add(articleId)
    }

    bookmarkCache = next
    notifyBookmarkListeners(next)
    return { current, wasBookmarked }
  },
  notifyBookmarkListeners = (ids: ReadonlySet<number>) => {
    bookmarkListeners.forEach((listener) => listener(new Set(ids)))
  },
  useBookmarks = () => {
    const [bookmarkIds, setBookmarkIds] = useState<Set<number>>(
        bookmarkCache === null || bookmarkCache === undefined
          ? new Set()
          : new Set(bookmarkCache),
      ),
      [isLoaded, setIsLoaded] = useState(bookmarkLoaded)

    useEffect(() => {
      const listener = (ids: ReadonlySet<number>) => {
        setBookmarkIds(new Set(ids))
        setIsLoaded(true)
      }
      bookmarkListeners.add(listener)

      if (bookmarkLoaded !== true) {
        void loadBookmarksFromApi()
      }

      return () => {
        bookmarkListeners.delete(listener)
      }
    }, [])

    const refresh = useCallback(() => {
        void loadBookmarksFromApi()
      }, []),
      isBookmarked = useCallback(
        (articleId: number) => bookmarkIds.has(articleId),
        [bookmarkIds],
      ),
      toggleBookmark = useCallback(
        async (articleId: number) => {
          if (!articleId) {
            return
          }
          const { current, wasBookmarked } = toggleBookmarkState(articleId)
          try {
            await persistBookmark(wasBookmarked, articleId)
          } catch (error) {
            console.error("Failed to toggle bookmark:", error)
            bookmarkCache = new Set(current)
            notifyBookmarkListeners(bookmarkCache)
          }
        },
        [bookmarkIds],
      )

    return {
      bookmarkIds,
      isBookmarked,
      isLoaded,
      refresh,
      toggleBookmark,
    }
  }
