"use client";

import { useState, useEffect } from "react";
import { getFromStorage, saveToStorage, STORAGE_KEYS } from "@/lib/storage";

/**
 * Hook for managing source filtering/selection
 * Persists to localStorage and survives page reloads
 * Empty selection = show all sources
 */

// Event emitter for cross-component updates
type SourceFilterListener = (selectedSources: Set<string>) => void;
const sourceFilterListeners = new Set<SourceFilterListener>();

function notifySourceFilterListeners(selectedSources: Set<string>) {
  sourceFilterListeners.forEach((listener) => listener(selectedSources));
}

function subscribeToSourceFilterChanges(listener: SourceFilterListener) {
  sourceFilterListeners.add(listener);
  return () => sourceFilterListeners.delete(listener);
}

export function useSourceFilter() {
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Load selected sources from localStorage on mount
  useEffect(() => {
    const stored = getFromStorage<string[]>(STORAGE_KEYS.SELECTED_SOURCES, []);
    const initialSources = new Set<string>(stored);
    setSelectedSources(initialSources);
    setIsLoaded(true);
    // Notify listeners of initial load
    notifySourceFilterListeners(initialSources);

    // Listen for storage changes from other tabs/windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SELECTED_SOURCES && e.newValue) {
        try {
          const updated = new Set<string>(JSON.parse(e.newValue));
          setSelectedSources(updated);
          notifySourceFilterListeners(updated);
        } catch (error) {
          console.error("Error parsing storage change:", error);
        }
      }
    };

    // Subscribe to our own event emitter for same-tab updates
    const unsubscribe = subscribeToSourceFilterChanges((sources) => {
      setSelectedSources(sources);
    });

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      unsubscribe();
    };
  }, []);

  // Persist selected sources to localStorage whenever they change
  useEffect(() => {
    if (isLoaded) {
      saveToStorage(
        STORAGE_KEYS.SELECTED_SOURCES,
        Array.from(selectedSources)
      );
      // Notify all listeners of the change
      notifySourceFilterListeners(selectedSources);
    }
  }, [selectedSources, isLoaded]);

  /**
   * Toggle a source's selection status
   */
  const toggleSource = (sourceId: string) => {
    setSelectedSources((prev) => {
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
    setSelectedSources(new Set(sourceIds));
  };

  /**
   * Clear all selections (shows all sources)
   */
  const clearAll = () => {
    setSelectedSources(new Set());
  };

  /**
   * Set selected sources (replaces current selection)
   */
  const setSelected = (sourceIds: string[]) => {
    setSelectedSources(new Set(sourceIds));
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
    isLoaded,
  };
}
