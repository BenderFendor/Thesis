"use client";

import {
  createStorageSchema,
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

const EMPTY_READING_HISTORY: ReadingHistoryEntry[] = [],
  MAX_HISTORY_SIZE = 100,
  STORAGE_KEY = "thesis_reading_history";

interface ReadingHistoryEntry {
  articleId: number;
  readAt: string;
  title?: string;
  source?: string;
}

const ReadingHistoryEntrySchema = z.object({
  articleId: z.number(),
  readAt: z.string(),
  source: z.string().optional(),
  title: z.string().optional(),
});

const ReadingHistorySchema = createStorageSchema(z.array(ReadingHistoryEntrySchema));

const markArticleAsRead = (articleId: number, title?: string, source?: string): void => {
  const currentHistory = getStorageSnapshot(
      STORAGE_KEY,
      EMPTY_READING_HISTORY,
      ReadingHistorySchema,
    ),
    existing = currentHistory.find((entry) => entry.articleId === articleId);
  if (existing) {
    const nextSource = existing.source ?? source,
      nextTitle = existing.title ?? title;
    if (nextTitle === existing.title && nextSource === existing.source) {
      return;
    }

    const updated = currentHistory.map((entry) => {
      if (entry.articleId === articleId) {
        return {
          ...entry,
          source: nextSource,
          title: nextTitle,
        };
      }
      return entry;
    });
    saveToStorage(STORAGE_KEY, updated);
    return;
  }

  const newEntry: ReadingHistoryEntry = {
      articleId,
      readAt: new Date().toISOString(),
      source,
      title,
    },
    updated = [newEntry, ...currentHistory].slice(0, MAX_HISTORY_SIZE);
  saveToStorage(STORAGE_KEY, updated);
};

function useReadingHistory() {
  const history = useSyncExternalStore(
      (onChange) => subscribeToStorageKey(STORAGE_KEY, onChange),
      () => getStorageSnapshot(STORAGE_KEY, EMPTY_READING_HISTORY, ReadingHistorySchema),
      () => EMPTY_READING_HISTORY,
    );
  const markAsRead = useCallback((articleId: number, title?: string, source?: string) => {
    markArticleAsRead(articleId, title, source);
  }, []);
  const isRead = useCallback(
      (articleId: number) => history.some((entry) => entry.articleId === articleId),
      [history],
    );
  const getArticleIds = useCallback(() => history.map((entry) => entry.articleId), [history]);
  const clearHistory = useCallback(() => {
      removeFromStorage(STORAGE_KEY);
    }, []);
  const getRecentIds = useCallback(
      (limit = 50) => history.slice(0, limit).map((entry) => entry.articleId),
      [history],
    );

  return {
    clearHistory,
    getArticleIds,
    getRecentIds,
    history,
    historySize: history.length,
    isRead,
    markAsRead,
  };
}
export { useReadingHistory };
