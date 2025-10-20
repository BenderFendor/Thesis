/**
 * Storage utilities for managing LocalStorage operations
 * Provides safe, type-safe helpers for persistence layer
 */

const isBrowser = typeof window !== "undefined";

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
    return true;
  } catch (error) {
    console.error("Error clearing localStorage:", error);
    return false;
  }
}

// Storage keys
export const STORAGE_KEYS = {
  FAVORITE_SOURCES: "favoriteSourceIds",
  SELECTED_SOURCES: "selectedSourceIds",
} as const;
