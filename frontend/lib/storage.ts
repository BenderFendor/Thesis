/**
 * Storage utilities for managing LocalStorage operations
 * Provides safe, type-safe helpers for persistence layer
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const STORAGE_CHANGE_EVENT = "thesis-storage-change",
 STORAGE_KEYS = {
  APPEARANCE_SETTINGS: "appearanceSettings",
  FAVORITE_SOURCES: "favoriteSourceIds",
  NEWS_LENS: "newsLensPreset",
  SELECTED_SOURCES: "selectedSourceIds",
} as const,
 /**
  * Clear all localStorage (use with caution).
  * @returns {boolean} Success status
  */
 clearStorage = (): boolean => {
  if (!isBrowser) {return false;}

  try {
    globalThis.localStorage.clear();
    storageSnapshotCache.clear();
    dispatchStorageChange();
    return true;
  } catch (error) {
    console.error("Error clearing localStorage:", error);
    return false;
  }
},
 /**
  * Notify listeners that a storage key changed in this tab.
  * @param {string} [key] - Storage key (empty: all keys)
  * @returns {void}
  */
 dispatchStorageChange = (key?: string): void => {
  if (!isBrowser) {return;}

  globalThis.dispatchEvent(
    new CustomEvent<{ key?: string }>(STORAGE_CHANGE_EVENT, {
      detail: { key },
    })
  );
},
 /**
  * Retrieve a JSON value stored for a key.
  * @param {string} key - Storage key
  * @param {TValue} defaultValue - Fallback value if key missing or unparsable
  * @returns {TValue} Parsed value or default
  */
 getFromStorage = <TValue>(key: string, defaultValue: TValue): TValue => {
  if (!isBrowser) {return defaultValue;}

  try {
    const item = globalThis.localStorage.getItem(key);
    if (item === null || item === "") {return defaultValue;}
    return parseStoredJson(item) as TValue;
  } catch (error) {
    console.error(`Error reading localStorage key "${key}":`, error);
    return defaultValue;
  }
},
 /**
  * Read a key once and cache the parsed value until the raw string changes.
  * @param {string} key - Storage key
  * @param {TValue} defaultValue - Fallback value if key missing or unparsable
  * @returns {TValue} Parsed value or default
  */
 getStorageSnapshot = <TValue>(key: string, defaultValue: TValue): TValue => {
  if (!isBrowser) {
    return defaultValue;
  }

  try {
    return readSnapshot(key, defaultValue);
  } catch (error) {
    console.error(`Error reading localStorage snapshot for key "${key}":`, error);
    const raw = globalThis.localStorage.getItem(key);
    storageSnapshotCache.set(key, { parsed: defaultValue, raw });
    return defaultValue;
  }
},
 isBrowser = globalThis.window !== undefined,
 /** Check whether an event is one of this module's storage change events */
 isStorageChangeEvent = (event: Readonly<Event>): event is Readonly<CustomEvent<{ key?: string }>> =>
  event instanceof CustomEvent
,
 /**
  * Parse a stored JSON string into an unvalidated JSON value.
  * @param {string} raw - Raw JSON text
  * @returns {JsonValue} Parsed JSON value
  */
 parseStoredJson = (raw: string): JsonValue => JSON.parse(raw),
 /**
  * Cache a freshly parsed snapshot and return it.
  * @param {string} key - Storage key
  * @param {string} raw - Raw JSON text
  * @param {TValue} defaultValue - Fallback value if parsing fails
  * @returns {TValue} Parsed value or default
  */
 parseAndCacheSnapshot = <TValue>(key: string, raw: string, defaultValue: TValue): TValue => {
  const parsed = parseStoredJson(raw);
  storageSnapshotCache.set(key, { parsed, raw });
  // SAFETY: this module only stores JSON.stringify output of a TValue at this key.
  return parsed as TValue;
},
 /**
  * Validate the cached raw string against the snapshot cache before parsing.
  * @param {string} key - Storage key
  * @param {TValue} defaultValue - Fallback value if key missing or unparsable
  * @returns {TValue} Parsed value or default
  */
 readSnapshot = <TValue>(key: string, defaultValue: TValue): TValue => {
  const cached = storageSnapshotCache.get(key),
   raw = globalThis.localStorage.getItem(key);
  if (cached?.raw === raw) {
    // SAFETY: cached.parsed was stored as a TValue by this module for this key.
    return cached.parsed as TValue;
  }
  if (raw === null || raw === "") {
    storageSnapshotCache.set(key, { parsed: defaultValue, raw });
    return defaultValue;
  }
  return parseAndCacheSnapshot(key, raw, defaultValue);
},
 /**
  * Remove a stored value.
  * @param {string} key - Storage key
  * @returns {boolean} Success status
  */
 removeFromStorage = (key: string): boolean => {
  if (!isBrowser) {return false;}

  try {
    globalThis.localStorage.removeItem(key);
    storageSnapshotCache.delete(key);
    dispatchStorageChange(key);
    return true;
  } catch (error) {
    console.error(`Error removing localStorage key "${key}":`, error);
    return false;
  }
},
 /**
  * Store a JSON-serializable value.
  * @param {string} key - Storage key
  * @param {TValue} value - Value to store
  * @returns {boolean} Success status
  */
 saveToStorage = <TValue>(key: string, value: TValue): boolean => {
  if (!isBrowser) {return false;}

  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    storageSnapshotCache.delete(key);
    dispatchStorageChange(key);
    return true;
  } catch (error) {
    console.error(`Error setting localStorage key "${key}":`, error);
    return false;
  }
},
 storageSnapshotCache = new Map<string, { raw: string | null; parsed: unknown }>(),
 /**
  * Subscribe to storage events for a key (same-tab writes and cross-tab changes).
  * @param {string} key - Storage key
  * @param {() => void} onChange - Listener invoked when the key changes
  * @returns {() => void} Unsubscribe function
  */
 subscribeToStorageKey = (key: string, onChange: () => void) => {
  if (!isBrowser) {
    return () => {};
  }

  const handleCustomEvent = (event: Readonly<Event>) => {
    if (!isStorageChangeEvent(event)) {return;}
    if (event.detail?.key === undefined || event.detail.key === "" || event.detail.key === key) {
      onChange();
    }
  },

   handleStorage = (event: Readonly<StorageEvent>) => {
    if (event.key === key || event.key === null) {
      onChange();
    }
  };

  globalThis.addEventListener("storage", handleStorage);
  globalThis.addEventListener(
    STORAGE_CHANGE_EVENT,
    handleCustomEvent
  );

  return () => {
    globalThis.removeEventListener("storage", handleStorage);
    globalThis.removeEventListener(
      STORAGE_CHANGE_EVENT,
      handleCustomEvent
    );
  };
};

export {
  STORAGE_KEYS,
  clearStorage,
  getFromStorage,
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
  subscribeToStorageKey,
};
