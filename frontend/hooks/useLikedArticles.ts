import { useCallback, useEffect, useState } from "react"
import {
  createLikedArticle,
  deleteLikedArticle,
  fetchLikedArticles,
} from "@/lib/api"

type LikedListener = (ids: Set<number>) => void

let likedCache: Set<number> | null = null
let likedLoaded = false
let likedLoading = false
const likedListeners = new Set<LikedListener>()

const notifyLikedListeners = (ids: Set<number>) => {
  likedListeners.forEach((listener) => listener(new Set(ids)))
}

const loadLikedFromApi = async () => {
  if (likedLoading) return
  likedLoading = true
  try {
    const entries = await fetchLikedArticles()
    likedCache = new Set(entries.map((entry) => entry.articleId))
    likedLoaded = true
    notifyLikedListeners(likedCache)
    return entries
  } catch (error) {
    console.error("Failed to load liked articles:", error)
    return []
  } finally {
    likedLoading = false
  }
}

export function useLikedArticles() {
  const [likedIds, setLikedIds] = useState<Set<number>>(
    likedCache ? new Set(likedCache) : new Set()
  )
  const [isLoaded, setIsLoaded] = useState(likedLoaded)

  useEffect(() => {
    const listener = (ids: Set<number>) => {
      setLikedIds(ids)
      setIsLoaded(true)
    }
    likedListeners.add(listener)

    if (!likedLoaded) {
      void loadLikedFromApi()
    }

    return () => {
      likedListeners.delete(listener)
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
  }
}
