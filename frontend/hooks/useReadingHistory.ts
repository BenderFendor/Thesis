"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";

const STORAGE_KEY = "thesis_reading_history";
const MAX_HISTORY_SIZE = 100;
const EMPTY_READING_HISTORY: ReadingHistoryEntry[] = [];

export interface ReadingHistoryEntry {
  articleId: number;
  readAt: string;
  title?: string;
  source?: string;
}

export function useReadingHistory() {
  const history = useSyncExternalStore(
    (onChange) => subscribeToStorageKey(STORAGE_KEY, onChange),
    () =>
      getStorageSnapshot<ReadingHistoryEntry[]>(
        STORAGE_KEY,
        EMPTY_READING_HISTORY
      ),
    () => EMPTY_READING_HISTORY
  );

  const markAsRead = useCallback(
    (articleId: number, title?: string, source?: string) => {
      const currentHistory = getStorageSnapshot<ReadingHistoryEntry[]>(
        STORAGE_KEY,
        EMPTY_READING_HISTORY
      );
      const exists = currentHistory.find((entry) => entry.articleId === articleId);
      if (exists) {
        const nextTitle = exists.title ?? title;
        const nextSource = exists.source ?? source;
        if (nextTitle === exists.title && nextSource === exists.source) {
          return;
        }

        const updated = currentHistory.map((entry) =>
          entry.articleId === articleId
            ? {
                ...entry,
                title: nextTitle,
                source: nextSource,
              }
            : entry
        );
        saveToStorage(STORAGE_KEY, updated);
        return;
      }

      const newEntry: ReadingHistoryEntry = {
        articleId,
        readAt: new Date().toISOString(),
        title,
        source,
      };
      const updated = [newEntry, ...currentHistory].slice(0, MAX_HISTORY_SIZE);
      saveToStorage(STORAGE_KEY, updated);
    },
    []
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
