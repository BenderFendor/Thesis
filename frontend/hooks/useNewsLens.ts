"use client";

import { useSyncExternalStore } from "react";
import {
  getStorageSnapshot,
  saveToStorage,
  STORAGE_KEYS,
  subscribeToStorageKey,
} from "@/lib/storage";
import type { NewsLensId } from "@/lib/news-lens";

const DEFAULT_NEWS_LENS: NewsLensId = "all";
const VALID_NEWS_LENSES = new Set<NewsLensId>([
  "all",
  "wire",
  "primary",
  "local",
  "international",
  "opinion-off",
  "high-factual",
  "low-paywall",
]);

function coerceLens(value: unknown): NewsLensId {
  return typeof value === "string" && VALID_NEWS_LENSES.has(value as NewsLensId)
    ? (value as NewsLensId)
    : DEFAULT_NEWS_LENS;
}

export function useNewsLens() {
  const lens = useSyncExternalStore(
    (onChange) => subscribeToStorageKey(STORAGE_KEYS.NEWS_LENS, onChange),
    () => coerceLens(getStorageSnapshot(STORAGE_KEYS.NEWS_LENS, DEFAULT_NEWS_LENS)),
    () => DEFAULT_NEWS_LENS,
  );

  return {
    lens,
    setLens: (next: NewsLensId) => saveToStorage(STORAGE_KEYS.NEWS_LENS, next),
    clearLens: () => saveToStorage(STORAGE_KEYS.NEWS_LENS, DEFAULT_NEWS_LENS),
  };
}
