"use client"

import {
  STORAGE_KEYS,
  getStorageSnapshot,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage"
import { useCallback, useMemo, useSyncExternalStore } from "react"

const EMPTY_FAVORITE_IDS: readonly string[] = [],
  toggleFavoriteId = (
  favoriteIds: readonly string[],
  sourceId: string,
): void => {
  const updated = new Set(favoriteIds)
  if (updated.has(sourceId)) {
    updated.delete(sourceId)
  } else {
    updated.add(sourceId)
  }
  saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, [...updated])
},
  updateMultipleFavorites = (
  favoriteIds: readonly string[],
  sourceIds: readonly string[],
  shouldAdd: boolean,
): void => {
  const updated = new Set(favoriteIds)
  sourceIds.forEach((id) => {
    if (shouldAdd) {
      updated.add(id)
    } else {
      updated.delete(id)
    }
  })
  saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, [...updated])
  },
  useFavorites = () => {
    const clearFavorites = useCallback(() => {
      saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, [])
    }, []),
      favoriteIds = useSyncExternalStore(
        (onChange) =>
          subscribeToStorageKey(STORAGE_KEYS.FAVORITE_SOURCES, onChange),
        () =>
          getStorageSnapshot<string[]>(
            STORAGE_KEYS.FAVORITE_SOURCES,
            [...EMPTY_FAVORITE_IDS],
          ),
        () => EMPTY_FAVORITE_IDS,
      ),
      favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]),
      isFavorite = useCallback(
        (sourceId: string): boolean => favorites.has(sourceId),
        [favorites],
      ),
      persistAddedFavorites = useCallback(
        (sourceIds: readonly string[]) => {
          updateMultipleFavorites(favoriteIds, sourceIds, true)
        },
        [favoriteIds],
      ),
      persistRemovedFavorites = useCallback(
        (sourceIds: readonly string[]) => {
          updateMultipleFavorites(favoriteIds, sourceIds, false)
        },
        [favoriteIds],
      ),
      toggleFavorite = useCallback(
        (sourceId: string) => {
          toggleFavoriteId(favoriteIds, sourceId)
        },
        [favoriteIds],
      )

    return {
      addMultipleFavorites: persistAddedFavorites,
      clearFavorites,
      favorites,
      isFavorite,
      isLoaded: true,
      removeMultipleFavorites: persistRemovedFavorites,
      toggleFavorite,
    }
  }

export { EMPTY_FAVORITE_IDS, useFavorites }
