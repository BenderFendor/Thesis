/**
 * Storage utilities for managing LocalStorage operations
 * Provides safe, type-safe helpers for persistence layer
 */

import type { DeepReadonly } from "./deep-readonly";
import { z } from "zod";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type StorageValueSchema<TValue> = Readonly<{
  readonly isValue: (value: DeepReadonly<JsonValue> | Readonly<TValue>) => value is TValue;
}>;
type CachedStorageSchema = Readonly<{
  readonly isValue: (value: DeepReadonly<JsonValue>) => boolean;
}>;
type StorageKeyEvent = Readonly<Pick<StorageEvent, "key">>;

type SaveToStorage = (key: string, value: Parameters<typeof JSON.stringify>[0]) => boolean;

interface StorageParseSuccess<TValue> {
  readonly data: TValue;
  readonly success: true;
}

interface StorageParseFailure {
  readonly success: false;
}

type StorageParseResult<TValue> = StorageParseFailure | StorageParseSuccess<TValue>;

interface StorageSchemaChecker<TValue> {
  readonly safeParse: (
    value: DeepReadonly<JsonValue> | Readonly<TValue>,
  ) => StorageParseResult<TValue>;
}

const createStorageSchema = <TValue>(
  schema: StorageSchemaChecker<TValue>,
): StorageValueSchema<TValue> => ({
  isValue: (value: DeepReadonly<JsonValue> | Readonly<TValue>): value is TValue =>
    schema.safeParse(value).success,
});

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const readStorageValue = <TValue>(
  raw: string,
  defaultValue: TValue,
  schema: StorageValueSchema<TValue>,
): TValue => {
  const parsed = parseStoredJson(raw);
  if (schema.isValue(parsed)) {
    return parsed;
  }
  return defaultValue;
};

const STORAGE_CHANGE_EVENT = "thesis-storage-change";
  const STORAGE_KEYS = {
    APPEARANCE_SETTINGS: "appearanceSettings",
    FAVORITE_SOURCES: "favoriteSourceIds",
    NEWS_LENS: "newsLensPreset",
    SELECTED_SOURCES: "selectedSourceIds",
  } as const;
  /**
   * Notify listeners that a storage key changed in this tab.
   * @param {string} [key] - Storage key (empty: all keys)
   * @returns {void}
   */
  const dispatchStorageChange = (key?: string): void => {
    if (!isBrowser) {
      return;
    }

    globalThis.dispatchEvent(
      new CustomEvent<{ key?: string }>(STORAGE_CHANGE_EVENT, {
        detail: { key },
      }),
    );
  };
  /**
   * Retrieve a JSON value stored for a key.
   * @param {string} key - Storage key
   * @param {TValue} defaultValue - Fallback value if key missing or unparsable
   * @param {StorageValueSchema<TValue>} schema - Validator for the stored value
   * @returns {TValue} Parsed value or default
   */
  const getFromStorage = <TValue>(
    key: string,
    defaultValue: TValue,
    schema: StorageValueSchema<TValue>,
  ): TValue => {
    if (!isBrowser) {
      return defaultValue;
    }

    try {
      const item = globalThis.localStorage.getItem(key);
      if (item === null || item === "") {
        return defaultValue;
      }
      return readStorageValue(item, defaultValue, schema);
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return defaultValue;
    }
  };
  /**
   * Read a key once and cache the parsed value until the raw string changes.
   * @param {string} key - Storage key
   * @param {TValue} defaultValue - Fallback value if key missing or unparsable
   * @param {StorageValueSchema<TValue>} schema - Validator for the stored value
   * @returns {TValue} Parsed value or default
   */
  const getStorageSnapshot = <TValue>(
    key: string,
    defaultValue: TValue,
    schema: StorageValueSchema<TValue>,
  ): TValue => {
    if (!isBrowser) {
      return defaultValue;
    }

    try {
      return readSnapshot(key, defaultValue, schema);
    } catch (error) {
      console.error(`Error reading localStorage snapshot for key "${key}":`, error);
      return defaultValue;
    }
  };
  const isBrowser = globalThis.window !== undefined;
  /** Check whether an event is one of this module's storage change events.
   * @param {Event} event - Event to inspect
   * @returns {boolean} Whether the event carries a storage change key
   */
  const isStorageChangeEvent = (
    event: Readonly<Event>,
  ): event is Readonly<CustomEvent<{ key?: string }>> => event instanceof CustomEvent;
  /**
   * Parse a stored JSON string into an unvalidated JSON value.
   * @param {string} raw - Raw JSON text
   * @returns {JsonValue} Parsed JSON value
   */
  const parseStoredJson = (raw: string): JsonValue => JsonValueSchema.parse(JSON.parse(raw));
  /**
   * Cache a freshly parsed snapshot and return it.
   * @param {string} key - Storage key
   * @param {string} raw - Raw JSON text
   * @param {StorageValueSchema<TValue>} schema - Validator for the stored value
   * @returns {TValue} Parsed value or default
   */
  const parseAndCacheSnapshot = <TValue>(
    key: string,
    raw: string,
    schema: StorageValueSchema<TValue>,
  ): TValue => {
    const parsed = parseStoredJson(raw);
    if (!schema.isValue(parsed)) {
      throw new Error(`Invalid stored value for ${key}`);
    }
    storageSnapshotCache.set(key, { parsed, raw, schema });
    return parsed;
  };
  /**
   * Validate the cached raw string against the snapshot cache before parsing.
   * @param {string} key - Storage key
   * @param {TValue} defaultValue - Fallback value if key missing or unparsable
   * @param {StorageValueSchema<TValue>} schema - Validator for the stored value
   * @returns {TValue} Parsed value or default
   */
  const readSnapshot = <TValue>(
    key: string,
    defaultValue: TValue,
    schema: StorageValueSchema<TValue>,
  ): TValue => {
    const cached = storageSnapshotCache.get(key),
      raw = globalThis.localStorage.getItem(key);
    if (cached?.raw === raw && cached.schema === schema && schema.isValue(cached.parsed)) {
      return cached.parsed;
    }
    if (raw === null || raw === "") {
      return defaultValue;
    }
    return parseAndCacheSnapshot(key, raw, schema);
  };
  /**
   * Remove a stored value.
   * @param {string} key - Storage key
   * @returns {boolean} Success status
   */
  const removeFromStorage = (key: string): boolean => {
    if (!isBrowser) {
      return false;
    }

    try {
      globalThis.localStorage.removeItem(key);
      storageSnapshotCache.delete(key);
      dispatchStorageChange(key);
      return true;
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
      return false;
    }
  };
  /**
   * Store a JSON-serializable value.
   * @param {string} key - Storage key
   * @param {TValue} value - Value to store
   * @returns {boolean} Success status
   */
  const saveToStorage: SaveToStorage = (key, value) => {
    if (!isBrowser) {
      return false;
    }

    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
      storageSnapshotCache.delete(key);
      dispatchStorageChange(key);
      return true;
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
      return false;
    }
  };
  const storageSnapshotCache = new Map<
    string,
    { raw: string | null; parsed: JsonValue; schema: CachedStorageSchema }
  >();
  /**
   * Subscribe to storage events for a key (same-tab writes and cross-tab changes).
   * @param {string} key - Storage key
   * @param {() => void} onChange - Listener invoked when the key changes
   * @returns {() => void} Unsubscribe function
   */
  const subscribeToStorageKey = (key: string, onChange: () => void) => {
    if (!isBrowser) {
      return () => {};
    }

    const handleCustomEvent = (event: Readonly<Event>) => {
        if (!isStorageChangeEvent(event)) {
          return;
        }
        if (
          event.detail?.key === undefined ||
          event.detail.key === "" ||
          event.detail.key === key
        ) {
          onChange();
        }
      },
      handleStorage = (event: StorageKeyEvent) => {
        if (event.key === key || event.key === null) {
          onChange();
        }
      };

    globalThis.addEventListener("storage", handleStorage);
    globalThis.addEventListener(STORAGE_CHANGE_EVENT, handleCustomEvent);

    return () => {
      globalThis.removeEventListener("storage", handleStorage);
      globalThis.removeEventListener(STORAGE_CHANGE_EVENT, handleCustomEvent);
    };
  };

export {
  STORAGE_KEYS,
  createStorageSchema,
  getFromStorage,
  getStorageSnapshot,
  removeFromStorage,
  parseStoredJson,
  saveToStorage,
  subscribeToStorageKey,
};
