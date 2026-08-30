"use client"

import {
  STORAGE_KEYS,
  getStorageSnapshot,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage"
import { useCallback, useMemo, useSyncExternalStore } from "react"

export const EMPTY_FAVORITE_IDS: readonly string[] = [],
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
            EMPTY_FAVORITE_IDS,
          ),
        () => EMPTY_FAVORITE_IDS,
      ),
      favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]),
      isFavorite = useCallback(
        (sourceId: string): boolean => favorites.has(sourceId),
        [favorites],
      ),
      removeMultipleFavorites = useCallback(
        (sourceIds: readonly string[]) => {
          const updated = new Set(favorites)
          sourceIds.forEach((id) => { updated.delete(id) })
          saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, [...updated])
        },
        [favorites],
      ),
      toggleFavorite = useCallback(
        (sourceId: string) => {
          const updated = new Set(favorites)
          if (updated.has(sourceId)) {
            updated.delete(sourceId)
          } else {
            updated.add(sourceId)
          }
          saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, [...updated])
        },
        [favorites],
      )

    return {
      addMultipleFavorites: (sourceIds: readonly string[]) => {
        const updated = new Set(favorites)
        sourceIds.forEach((id) => { updated.add(id) })
        saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, [...updated])
      },
      clearFavorites,
      favorites,
      isFavorite,
      isLoaded: true,
      removeMultipleFavorites,
      toggleFavorite,
    }
  }
