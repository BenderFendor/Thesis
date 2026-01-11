"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "thesis_reading_history";
const MAX_HISTORY_SIZE = 100;

export interface ReadingHistoryEntry {
  articleId: number;
  readAt: string;
  title?: string;
  source?: string;
}

export function useReadingHistory() {
  const [history, setHistory] = useState<ReadingHistoryEntry[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to load reading history:", err);
    }
  }, []);

  const saveHistory = useCallback((entries: ReadingHistoryEntry[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (err) {
      console.error("Failed to save reading history:", err);
    }
  }, []);

  const markAsRead = useCallback(
    (articleId: number, title?: string, source?: string) => {
      setHistory((prev) => {
        const exists = prev.find((e) => e.articleId === articleId);
        if (exists) {
          const updated = [
            { ...exists, readAt: new Date().toISOString() },
            ...prev.filter((e) => e.articleId !== articleId),
          ].slice(0, MAX_HISTORY_SIZE);
          saveHistory(updated);
          return updated;
        }

        const newEntry: ReadingHistoryEntry = {
          articleId,
          readAt: new Date().toISOString(),
          title,
          source,
        };
        const updated = [newEntry, ...prev].slice(0, MAX_HISTORY_SIZE);
        saveHistory(updated);
        return updated;
      });
    },
    [saveHistory]
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
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to clear reading history:", err);
    }
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
