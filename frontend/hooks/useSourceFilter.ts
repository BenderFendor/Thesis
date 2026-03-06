"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  getFromStorage,
  saveToStorage,
  STORAGE_KEYS,
  subscribeToStorageKey,
} from "@/lib/storage";

/**
 * Hook for managing source filtering/selection
 * Persists to localStorage and survives page reloads
 * Empty selection = show all sources
 */

export function useSourceFilter() {
  const selectedSourceIds = useSyncExternalStore(
    (onChange) =>
      subscribeToStorageKey(STORAGE_KEYS.SELECTED_SOURCES, onChange),
    () => getFromStorage<string[]>(STORAGE_KEYS.SELECTED_SOURCES, []),
    () => []
  );
  const selectedSources = useMemo(
    () => new Set(selectedSourceIds),
    [selectedSourceIds]
  );

  /**
   * Toggle a source's selection status
   */
  const toggleSource = (sourceId: string) => {
    const updated = new Set(selectedSources);
    if (updated.has(sourceId)) {
      updated.delete(sourceId);
    } else {
      updated.add(sourceId);
    }

    saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, Array.from(updated));
  };

  /**
   * Check if a source is currently selected
   */
  const isSelected = (sourceId: string): boolean => {
    return selectedSources.has(sourceId);
  };

  /**
   * Check if filtering is active (any sources selected)
   * If true, only selected sources should be shown
   * If false, show all sources
   */
  const isFilterActive = (): boolean => {
    return selectedSources.size > 0;
  };

  /**
   * Select all sources from provided list
   */
  const selectAll = (sourceIds: string[]) => {
    saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, sourceIds);
  };

  /**
   * Clear all selections (shows all sources)
   */
  const clearAll = () => {
    saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, []);
  };

  /**
   * Set selected sources (replaces current selection)
   */
  const setSelected = (sourceIds: string[]) => {
    saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, sourceIds);
  };

  /**
   * Get array of selected source IDs
   */
  const getSelectedArray = (): string[] => {
    return Array.from(selectedSources);
  };

  /**
   * Get count of selected sources
   */
  const getSelectionCount = (): number => {
    return selectedSources.size;
  };

  return {
    selectedSources,
    toggleSource,
    isSelected,
    isFilterActive,
    selectAll,
    clearAll,
    setSelected,
    getSelectedArray,
    getSelectionCount,
    isLoaded: true,
  };
}
