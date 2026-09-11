"use client"

import {
  STORAGE_KEYS,
  getStorageSnapshot,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage"
import type { NewsLensId } from "@/lib/news-lens"
import { useSyncExternalStore } from "react"

const DEFAULT_NEWS_LENS: NewsLensId = "all",
  NEWS_LENS_CANDIDATES = new Set<string>([
    "all",
    "wire",
    "primary",
    "local",
    "international",
    "opinion-off",
    "high-factual",
    "low-paywall",
  ]),
  coerceLens = (value: string): NewsLensId => {
    if (isNewsLensId(value)) {
      return value
    }
    return DEFAULT_NEWS_LENS
  },
  isNewsLensId = (value: string): value is NewsLensId =>
    NEWS_LENS_CANDIDATES.has(value);

export const useNewsLens = () => {
  const lens = useSyncExternalStore(
    (onChange) => subscribeToStorageKey(STORAGE_KEYS.NEWS_LENS, onChange),
    () =>
      coerceLens(getStorageSnapshot(STORAGE_KEYS.NEWS_LENS, DEFAULT_NEWS_LENS)),
    () => DEFAULT_NEWS_LENS,
  )

  return {
    clearLens: () => saveToStorage(STORAGE_KEYS.NEWS_LENS, DEFAULT_NEWS_LENS),
    lens,
    setLens: (next: NewsLensId) => saveToStorage(STORAGE_KEYS.NEWS_LENS, next),
  }
}
