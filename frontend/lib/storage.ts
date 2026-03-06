/**
 * Storage utilities for managing LocalStorage operations
 * Provides safe, type-safe helpers for persistence layer
 */

const isBrowser = typeof window !== "undefined";
const STORAGE_CHANGE_EVENT = "thesis-storage-change";

function dispatchStorageChange(key?: string): void {
  if (!isBrowser) return;

  window.dispatchEvent(
    new CustomEvent<{ key?: string }>(STORAGE_CHANGE_EVENT, {
      detail: { key },
    })
  );
}

/**
 * Safely retrieve value from localStorage
 * @param key - Storage key
 * @param defaultValue - Fallback value if key not found
 * @returns Parsed value or default
 */
export function getFromStorage<T>(key: string, defaultValue: T): T {
  if (!isBrowser) return defaultValue;

  try {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : defaultValue;
  } catch (error) {
    console.error(`Error reading localStorage key "${key}":`, error);
    return defaultValue;
  }
}

/**
 * Safely save value to localStorage
 * @param key - Storage key
 * @param value - Value to store
 * @returns Success status
 */
export function saveToStorage<T>(key: string, value: T): boolean {
  if (!isBrowser) return false;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    dispatchStorageChange(key);
    return true;
  } catch (error) {
    console.error(`Error setting localStorage key "${key}":`, error);
    return false;
  }
}

/**
 * Safely remove value from localStorage
 * @param key - Storage key
 * @returns Success status
 */
export function removeFromStorage(key: string): boolean {
  if (!isBrowser) return false;

  try {
    window.localStorage.removeItem(key);
    dispatchStorageChange(key);
    return true;
  } catch (error) {
    console.error(`Error removing localStorage key "${key}":`, error);
    return false;
  }
}

/**
 * Clear all localStorage (use with caution)
 * @returns Success status
 */
export function clearStorage(): boolean {
  if (!isBrowser) return false;

  try {
    window.localStorage.clear();
    dispatchStorageChange();
    return true;
  } catch (error) {
    console.error("Error clearing localStorage:", error);
    return false;
  }
}

export function subscribeToStorageKey(
  key: string,
  onChange: () => void
): () => void {
  if (!isBrowser) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      onChange();
    }
  };

  const handleCustomEvent = (event: Event) => {
    const storageEvent = event as CustomEvent<{ key?: string }>;
    if (!storageEvent.detail?.key || storageEvent.detail.key === key) {
      onChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(
    STORAGE_CHANGE_EVENT,
    handleCustomEvent as EventListener
  );

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      STORAGE_CHANGE_EVENT,
      handleCustomEvent as EventListener
    );
  };
}

// Storage keys
export const STORAGE_KEYS = {
  FAVORITE_SOURCES: "favoriteSourceIds",
  SELECTED_SOURCES: "selectedSourceIds",
} as const;
