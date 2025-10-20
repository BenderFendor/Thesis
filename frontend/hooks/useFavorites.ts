"use client";

import { useState, useEffect } from "react";
import { getFromStorage, saveToStorage, STORAGE_KEYS } from "@/lib/storage";

/**
 * Hook for managing favorite sources
 * Persists to localStorage and survives page reloads
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);

  // Load favorites from localStorage on mount
  useEffect(() => {
    const stored = getFromStorage<string[]>(STORAGE_KEYS.FAVORITE_SOURCES, []);
    setFavorites(new Set(stored));
    setIsLoaded(true);
  }, []);

  // Persist favorites to localStorage whenever they change
  useEffect(() => {
    if (isLoaded) {
      saveToStorage(
        STORAGE_KEYS.FAVORITE_SOURCES,
        Array.from(favorites)
      );
    }
  }, [favorites, isLoaded]);

  /**
   * Toggle favorite status of a source
   */
  const toggleFavorite = (sourceId: string) => {
    setFavorites((prev) => {
      const updated = new Set(prev);
      if (updated.has(sourceId)) {
        updated.delete(sourceId);
      } else {
        updated.add(sourceId);
      }
      return updated;
    });
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
    setFavorites((prev) => {
      const updated = new Set(prev);
      sourceIds.forEach((id) => updated.add(id));
      return updated;
    });
  };

  /**
   * Remove multiple sources from favorites
   */
  const removeMultipleFavorites = (sourceIds: string[]) => {
    setFavorites((prev) => {
      const updated = new Set(prev);
      sourceIds.forEach((id) => updated.delete(id));
      return updated;
    });
  };

  /**
   * Clear all favorites
   */
  const clearFavorites = () => {
    setFavorites(new Set());
  };

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    addMultipleFavorites,
    removeMultipleFavorites,
    clearFavorites,
    isLoaded,
  };
}
