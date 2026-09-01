"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";

const MAX_HISTORY_SIZE = 100,
 STORAGE_KEY = "thesis_reading_history",
 EMPTY_READING_HISTORY: ReadingHistoryEntry[] = [];

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
  ),

   markAsRead = useCallback(
    (articleId: number, title?: string, source?: string) => {
      const currentHistory = getStorageSnapshot<ReadingHistoryEntry[]>(
        STORAGE_KEY,
        EMPTY_READING_HISTORY
      ),
       exists = currentHistory.find((entry) => entry.articleId === articleId);
      if (exists) {
        const nextTitle = exists.title ?? title,
         nextSource = exists.source ?? source;
        if (nextTitle === exists.title && nextSource === exists.source) {
          return;
        }

        const updated = currentHistory.map((entry) =>
          entry.articleId === articleId
            ? {
                ...entry,
                source: nextSource,
                title: nextTitle,
              }
            : entry
        );
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
    },
    []
  ),

   isRead = useCallback(
    (articleId: number) => 
      history.some((e) => e.articleId === articleId)
    ,
    [history]
  ),

   getArticleIds = useCallback(() => 
    history.map((e) => e.articleId)
  , [history]),

   clearHistory = useCallback(() => {
    removeFromStorage(STORAGE_KEY);
  }, []),

   getRecentIds = useCallback(
    (limit: number = 50) => 
      history.slice(0, limit).map((e) => e.articleId)
    ,
    [history]
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
