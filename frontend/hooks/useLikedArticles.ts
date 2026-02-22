import { useCallback, useEffect, useState } from "react"
import {
  createLikedArticle,
  deleteLikedArticle,
  fetchLikedArticles,
} from "@/lib/api"

type LikedListener = (ids: Set<number>) => void
type ErrorListener = (error: string | null) => void

let likedCache: Set<number> | null = null
let likedLoaded = false
let likedLoading = false
let likedError: string | null = null
const likedListeners = new Set<LikedListener>()
const errorListeners = new Set<ErrorListener>()

const notifyLikedListeners = (ids: Set<number>) => {
  likedListeners.forEach((listener) => listener(new Set(ids)))
}

const notifyErrorListeners = (error: string | null) => {
  errorListeners.forEach((listener) => listener(error))
}

const loadLikedFromApi = async () => {
  if (likedLoading) return
  likedLoading = true
  likedError = null
  notifyErrorListeners(null)
  try {
    const entries = await fetchLikedArticles()
    likedCache = new Set(entries.map((entry) => entry.articleId))
    likedLoaded = true
    notifyLikedListeners(likedCache)
    return entries
  } catch (error) {
    likedError = error instanceof Error ? error.message : "Failed to load liked articles"
    notifyErrorListeners(likedError)
    return undefined
  } finally {
    likedLoading = false
  }
}

export function useLikedArticles() {
  const [likedIds, setLikedIds] = useState<Set<number>>(
    likedCache ? new Set(likedCache) : new Set()
  )
  const [isLoaded, setIsLoaded] = useState(likedLoaded)
  const [error, setError] = useState<string | null>(likedError)

  useEffect(() => {
    const likedListener = (ids: Set<number>) => {
      setLikedIds(ids)
      setIsLoaded(true)
    }
    const errListener = (err: string | null) => setError(err)

    likedListeners.add(likedListener)
    errorListeners.add(errListener)

    if (!likedLoaded) {
      void loadLikedFromApi()
    }

    return () => {
      likedListeners.delete(likedListener)
      errorListeners.delete(errListener)
    }
  }, [])

  const refresh = useCallback(async () => {
    return loadLikedFromApi()
  }, [])

  const isLiked = useCallback(
    (articleId: number) => {
      return likedIds.has(articleId)
    },
    [likedIds]
  )

  const toggleLike = useCallback(
    async (articleId: number) => {
      if (!articleId) return
      const current = likedCache ?? likedIds
      const next = new Set(current)
      const wasLiked = next.has(articleId)

      if (wasLiked) {
        next.delete(articleId)
      } else {
        next.add(articleId)
      }

      likedCache = next
      notifyLikedListeners(next)

      try {
        if (wasLiked) {
          await deleteLikedArticle(articleId)
        } else {
          await createLikedArticle(articleId)
        }
      } catch (error) {
        console.error("Failed to toggle liked article:", error)
        likedCache = new Set(current)
        notifyLikedListeners(likedCache)
      }
    },
    [likedIds]
  )

  return {
    likedIds,
    isLiked,
    toggleLike,
    refresh,
    isLoaded,
    error,
  }
}
