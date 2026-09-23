"use client";

import {
  STORAGE_KEYS,
  createStorageSchema,
  getStorageSnapshot,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";
import type { NewsLensId } from "@/lib/news-lens";
import { useSyncExternalStore } from "react";
import { z } from "zod";

const DEFAULT_NEWS_LENS: NewsLensId = "all",
  NEWS_LENS_SCHEMA = createStorageSchema(
    z.enum([
      "all",
      "wire",
      "primary",
      "local",
      "international",
      "opinion-off",
      "high-factual",
      "low-paywall",
    ]),
  );

export const useNewsLens = () => {
  const lens = useSyncExternalStore(
    (onChange) => subscribeToStorageKey(STORAGE_KEYS.NEWS_LENS, onChange),
    () =>
      getStorageSnapshot(STORAGE_KEYS.NEWS_LENS, DEFAULT_NEWS_LENS, NEWS_LENS_SCHEMA),
    () => DEFAULT_NEWS_LENS,
  );

  return {
    clearLens: () => saveToStorage(STORAGE_KEYS.NEWS_LENS, DEFAULT_NEWS_LENS),
    lens,
    setLens: (next: NewsLensId) => saveToStorage(STORAGE_KEYS.NEWS_LENS, next),
  };
};
