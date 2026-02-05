import { useCallback, useEffect, useState } from "react"
import { createBookmark, deleteBookmark, fetchBookmarks } from "@/lib/api"

type BookmarkListener = (ids: Set<number>) => void

let bookmarkCache: Set<number> | null = null
let bookmarkLoaded = false
let bookmarkLoading = false
const bookmarkListeners = new Set<BookmarkListener>()

const notifyBookmarkListeners = (ids: Set<number>) => {
  bookmarkListeners.forEach((listener) => listener(new Set(ids)))
}

const loadBookmarksFromApi = async () => {
  if (bookmarkLoading) return
  bookmarkLoading = true
  try {
    const entries = await fetchBookmarks()
    bookmarkCache = new Set(entries.map((entry) => entry.articleId))
    bookmarkLoaded = true
    notifyBookmarkListeners(bookmarkCache)
    return entries
  } catch (error) {
    console.error("Failed to load bookmarks:", error)
    return []
  } finally {
    bookmarkLoading = false
  }
}

export function useBookmarks() {
  const [bookmarkIds, setBookmarkIds] = useState<Set<number>>(
    bookmarkCache ? new Set(bookmarkCache) : new Set()
  )
  const [isLoaded, setIsLoaded] = useState(bookmarkLoaded)

  useEffect(() => {
    const listener = (ids: Set<number>) => {
      setBookmarkIds(ids)
      setIsLoaded(true)
    }
    bookmarkListeners.add(listener)

    if (!bookmarkLoaded) {
      void loadBookmarksFromApi()
    }

    return () => {
      bookmarkListeners.delete(listener)
    }
  }, [])

  const refresh = useCallback(async () => {
    return loadBookmarksFromApi()
  }, [])

  const isBookmarked = useCallback(
    (articleId: number) => {
      return bookmarkIds.has(articleId)
    },
    [bookmarkIds]
  )

  const toggleBookmark = useCallback(
    async (articleId: number) => {
      if (!articleId) return
      const current = bookmarkCache ?? bookmarkIds
      const next = new Set(current)
      const wasBookmarked = next.has(articleId)

      if (wasBookmarked) {
        next.delete(articleId)
      } else {
        next.add(articleId)
      }

      bookmarkCache = next
      notifyBookmarkListeners(next)

      try {
        if (wasBookmarked) {
          await deleteBookmark(articleId)
        } else {
          await createBookmark(articleId)
        }
      } catch (error) {
        console.error("Failed to toggle bookmark:", error)
        bookmarkCache = new Set(current)
        notifyBookmarkListeners(bookmarkCache)
      }
    },
    [bookmarkIds]
  )

  return {
    bookmarkIds,
    isBookmarked,
    toggleBookmark,
    refresh,
    isLoaded,
  }
}
