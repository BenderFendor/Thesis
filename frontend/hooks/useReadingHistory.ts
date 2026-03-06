"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getFromStorage,
  removeFromStorage,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";

const STORAGE_KEY = "thesis_reading_history";
const MAX_HISTORY_SIZE = 100;

export interface ReadingHistoryEntry {
  articleId: number;
  readAt: string;
  title?: string;
  source?: string;
}

export function useReadingHistory() {
  const history = useSyncExternalStore(
    (onChange) => subscribeToStorageKey(STORAGE_KEY, onChange),
    () => getFromStorage<ReadingHistoryEntry[]>(STORAGE_KEY, []),
    () => []
  );

  const markAsRead = useCallback(
    (articleId: number, title?: string, source?: string) => {
      const exists = history.find((entry) => entry.articleId === articleId);
      if (exists) {
        const updated = [
          { ...exists, readAt: new Date().toISOString() },
          ...history.filter((entry) => entry.articleId !== articleId),
        ].slice(0, MAX_HISTORY_SIZE);
        saveToStorage(STORAGE_KEY, updated);
        return;
      }

      const newEntry: ReadingHistoryEntry = {
        articleId,
        readAt: new Date().toISOString(),
        title,
        source,
      };
      const updated = [newEntry, ...history].slice(0, MAX_HISTORY_SIZE);
      saveToStorage(STORAGE_KEY, updated);
    },
    [history]
  );

  const isRead = useCallback(
    (articleId: number) => {
      return history.some((e) => e.articleId === articleId);
    },
    [history]
  );

  const getArticleIds = useCallback(() => {
    return history.map((e) => e.articleId);
  }, [history]);

  const clearHistory = useCallback(() => {
    removeFromStorage(STORAGE_KEY);
  }, []);

  const getRecentIds = useCallback(
    (limit: number = 50) => {
      return history.slice(0, limit).map((e) => e.articleId);
    },
    [history]
  );

  return {
    history,
    markAsRead,
    isRead,
    getArticleIds,
    getRecentIds,
    clearHistory,
    historySize: history.length,
  };
}
