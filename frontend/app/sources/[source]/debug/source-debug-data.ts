import type { SourceDebugData } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { parseStoredJson } from "@/lib/storage";

type DebugValue =
  | string
  | number
  | boolean
  | null
  | readonly DebugValue[]
  | DebugObject
  | undefined;

interface DebugObject extends Readonly<Record<string, DebugValue>> {
  readonly __debugObject?: never;
}

type FilteredDebugValue = DebugObject | readonly FilteredDebugValue[] | null;
type DebugJsonValue = DebugObject | readonly DebugValue[];
type ReadonlySourceDebugData = DeepReadonly<SourceDebugData>;

type MutableDebugObject = Record<string, DebugValue>;

const isDebugArray = (value: DebugValue): value is readonly DebugValue[] => Array.isArray(value);

const isDebugObject = (value: DebugValue): value is DebugObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDebugString = (value: DebugValue): value is string => typeof value === "string";

const hasFilteredContent = (value: FilteredDebugValue | undefined): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (isDebugArray(value)) {
    return value.length > 0;
  }
  return Object.keys(value).length > 0;
};

const filterDebugArray = (value: readonly DebugValue[], query: string): FilteredDebugValue[] => {
  const filtered: FilteredDebugValue[] = [];
  for (const item of value) {
    const nested = filterDebugValue(item, query);
    if (hasFilteredContent(nested)) {
      filtered.push(nested);
    }
  }
  return filtered;
};

const filterDebugValue = (value: DebugValue, query: string): FilteredDebugValue => {
  if (isDebugArray(value)) {
    return filterDebugArray(value, query);
  }
  if (!isDebugObject(value)) {
    return null;
  }
  const filtered = filterDebugRecord(value, query);
  if (filtered === undefined) {
    return null;
  }
  return filtered;
};

const filterDebugEntry = (
  key: string,
  value: DebugValue,
  query: string,
): Readonly<{ readonly value: DebugValue }> | null => {
  const keyMatches = key.toLowerCase().includes(query);
  const valueMatches = isDebugString(value) && value.toLowerCase().includes(query);
  if (keyMatches || valueMatches) {
    return { value };
  }
  const nested = filterDebugValue(value, query);
  if (hasFilteredContent(nested)) {
    return { value: nested };
  }
  return null;
};

const filterDebugRecord = (
  record: Readonly<DebugObject>,
  query: string,
): DebugObject | undefined => {
  const filtered: MutableDebugObject = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    const match = filterDebugEntry(key, value, query);
    if (match !== null) {
      filtered[key] = match.value;
    }
  }
  if (Object.keys(filtered).length === 0) {
    return void 0;
  }
  return filtered;
};

const cloneDebugData = (debugData: ReadonlySourceDebugData): DebugObject => {
  const serialized = JSON.stringify(debugData);
  if (serialized === undefined) {
    return {};
  }
  const parsed = parseStoredJson(serialized);
  if (isDebugObject(parsed)) {
    return parsed;
  }
  return {};
};

const filterSourceDebugData = (
  debugData: ReadonlySourceDebugData,
  searchQuery: string,
): DebugJsonValue => {
  const cloned = cloneDebugData(debugData);
  if (searchQuery.length === 0) {
    return cloned;
  }
  const filtered = filterDebugValue(cloned, searchQuery.toLowerCase());
  if (filtered !== null && !isDebugArray(filtered)) {
    return filtered;
  }
  if (isDebugArray(filtered)) {
    return filtered;
  }
  return {};
};

const getImagePercentage = (debugData: ReadonlySourceDebugData): number => {
  const totalEntries = debugData.image_analysis.total_entries;
  if (totalEntries <= 0) {
    return 0;
  }
  return Math.round(
    (debugData.image_analysis.entries_with_images / totalEntries) * 100,
  );
};

export type { DebugJsonValue };
export { filterSourceDebugData, getImagePercentage };
