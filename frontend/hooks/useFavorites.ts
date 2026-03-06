"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  getStorageSnapshot,
  saveToStorage,
  STORAGE_KEYS,
  subscribeToStorageKey,
} from "@/lib/storage";

const EMPTY_FAVORITE_IDS: string[] = [];

/**
 * Hook for managing favorite sources
 * Persists to localStorage and survives page reloads
 */
export function useFavorites() {
  const favoriteIds = useSyncExternalStore(
    (onChange) =>
      subscribeToStorageKey(STORAGE_KEYS.FAVORITE_SOURCES, onChange),
    () =>
      getStorageSnapshot<string[]>(
        STORAGE_KEYS.FAVORITE_SOURCES,
        EMPTY_FAVORITE_IDS
      ),
    () => EMPTY_FAVORITE_IDS
  );
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  /**
   * Toggle favorite status of a source
   */
  const toggleFavorite = (sourceId: string) => {
    const updated = new Set(favorites);
    if (updated.has(sourceId)) {
      updated.delete(sourceId);
    } else {
      updated.add(sourceId);
    }

    saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, Array.from(updated));
  };

  /**
   * Check if a source is favorited
   */
  const isFavorite = (sourceId: string): boolean => {
    return favorites.has(sourceId);
  };

  /**
   * Add multiple sources to favorites
   */
  const addMultipleFavorites = (sourceIds: string[]) => {
    const updated = new Set(favorites);
    sourceIds.forEach((id) => updated.add(id));
    saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, Array.from(updated));
  };

  /**
   * Remove multiple sources from favorites
   */
  const removeMultipleFavorites = (sourceIds: string[]) => {
    const updated = new Set(favorites);
    sourceIds.forEach((id) => updated.delete(id));
    saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, Array.from(updated));
  };

  /**
   * Clear all favorites
   */
  const clearFavorites = () => {
    saveToStorage(STORAGE_KEYS.FAVORITE_SOURCES, []);
  };

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    addMultipleFavorites,
    removeMultipleFavorites,
    clearFavorites,
    isLoaded: true,
  };
}
