import {
  createLikedArticle,
  deleteLikedArticle,
  fetchLikedArticles,
} from "@/lib/api"
import { useCallback, useEffect, useState } from "react"

type LikedListener = (ids: Set<number>) => void
type ErrorListener = (error: string | null) => void

let likedCache: Set<number> | null = null,
 likedError: string | null = null,
 likedLoaded = false,
 likedLoading = false
const likedListeners = new Set<LikedListener>(),
 errorListeners = new Set<ErrorListener>(),

 notifyLikedListeners = (ids: Set<number>) => {
  likedListeners.forEach((listener) =>{  listener(new Set(ids)); })
},

 notifyErrorListeners = (error: string | null) => {
  errorListeners.forEach((listener) =>{  listener(error); })
},

 loadLikedFromApi = async () => {
  if (likedLoading) {return undefined}
  likedLoading = true
  likedError = null
  notifyErrorListeners(null)
  try {
    const response = await fetchLikedArticles()
    likedCache = new Set(response.liked.map((entry) => entry.articleId))
    likedLoaded = true
    notifyLikedListeners(likedCache)
    return response.liked
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
  ),
   [isLoaded, setIsLoaded] = useState(likedLoaded),
   [error, setError] = useState<string | null>(likedError)

  useEffect(() => {
    const errListener = (err: string | null) =>{  setError(err); },
     likedListener = (ids: Set<number>) => {
      setLikedIds(ids)
      setIsLoaded(true)
    }

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

  const isLiked = useCallback(
    (articleId: number) =>
      likedIds.has(articleId)
    ,
    [likedIds]
  ),

   refresh = useCallback(async () =>
    loadLikedFromApi()
  , []),

   toggleLike = useCallback(
    async (articleId: number) => {
      if (!articleId) {return}
      const current = likedCache ?? likedIds,
       next = new Set(current),
       wasLiked = next.has(articleId)

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
      } catch (caughtError) {
        console.error("Failed to toggle liked article:", caughtError)
        likedCache = new Set(current)
        notifyLikedListeners(likedCache)
      }
    },
    [likedIds]
  )

  return {
    error,
    isLiked,
    isLoaded,
    likedIds,
    refresh,
    toggleLike,
  }
}
