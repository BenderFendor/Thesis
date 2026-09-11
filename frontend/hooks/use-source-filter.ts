"use client";

import {
  STORAGE_KEYS,
  getStorageSnapshot,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";
import { useMemo, useSyncExternalStore } from "react";

interface SourceFilter {
  clearAll: () => void;
  getSelectedArray: () => string[];
  getSelectionCount: () => number;
  isFilterActive: () => boolean;
  isLoaded: true;
  isSelected: (sourceId: string) => boolean;
  selectAll: (sourceIds: readonly string[]) => void;
  selectedSources: Set<string>;
  setSelected: (sourceIds: readonly string[]) => void;
  toggleSource: (sourceId: string) => void;
}

const EMPTY_COUNT = 0,
 EMPTY_SELECTED_SOURCE_IDS: string[] = [],
 /**
  * Clear all selections (shows all sources).
  */
 clearAll = () => {
  saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, []);
},
 /**
  * Select all sources from provided list.
  * @param {readonly string[]} sourceIds - source ids to select
  */
 selectAll = (sourceIds: readonly string[]) => {
  saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, sourceIds);
},
 /**
  * Set selected sources (replaces current selection).
  * @param {readonly string[]} sourceIds - source ids to select
  */
 setSelected = (sourceIds: readonly string[]) => {
  saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, sourceIds);
},
 /**
  * Hook for managing source filtering/selection.
  * Persists to localStorage and survives page reloads.
  * Empty selection = show all sources.
  * @returns {SourceFilter} the source filter state and controls
  */
 useSourceFilter = (): SourceFilter => {
  const isFilterActive = (): boolean => selectedSources.size > EMPTY_COUNT,
   isSelected = (sourceId: string): boolean => selectedSources.has(sourceId),
   selectedSourceIds = useSyncExternalStore(
    (onChange) =>
      subscribeToStorageKey(STORAGE_KEYS.SELECTED_SOURCES, onChange),
    () =>
      getStorageSnapshot<string[]>(
        STORAGE_KEYS.SELECTED_SOURCES,
        EMPTY_SELECTED_SOURCE_IDS,
      ),
    () => EMPTY_SELECTED_SOURCE_IDS,
  ),
   selectedSources = useMemo(
    () => new Set(selectedSourceIds),
    [selectedSourceIds],
  ),
   toggleSource = (sourceId: string) => {
    const updated = new Set(selectedSources);
    if (updated.has(sourceId)) {
      updated.delete(sourceId);
    } else {
      updated.add(sourceId);
    }

    saveToStorage(STORAGE_KEYS.SELECTED_SOURCES, [...updated]);
  };

  return {
    clearAll,
    getSelectedArray: () => [...selectedSources],
    getSelectionCount: () => selectedSources.size,
    isFilterActive,
    isLoaded: true,
    isSelected,
    selectAll,
    selectedSources,
    setSelected,
    toggleSource,
  };
};

export { useSourceFilter };
