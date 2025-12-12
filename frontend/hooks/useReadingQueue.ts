import { useState, useEffect, useCallback } from "react";
import { NewsArticle } from "@/lib/api";
import {
  addToReadingQueue as apiAddToQueue,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
  analyzeArticle,
} from "@/lib/api";
import { toast } from "sonner";

const READING_QUEUE_STORAGE_KEY = "readingQueue";
const USE_DATABASE = process.env.NEXT_PUBLIC_USE_DB_QUEUE === "true";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Event emitter for cross-component updates
type QueueListener = (articles: NewsArticle[]) => void;
const queueListeners = new Set<QueueListener>();

function notifyQueueListeners(articles: NewsArticle[]) {
  queueListeners.forEach((listener) => listener(articles));
}

function subscribeToQueueChanges(listener: QueueListener) {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}

async function preloadArticleData(
  article: NewsArticle,
  options: { includeAiAnalysis?: boolean } = {}
): Promise<NewsArticle> {
  // Preload full text and optionally AI analysis for an article.
  // By default, skip AI analysis to avoid rate limiting during bulk preloads.
  const { includeAiAnalysis = false } = options;

  try {
    const enhancedArticle = { ...article };

    // Preload full text (fast, no rate limits)
    try {
      const response = await fetch(
        `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`
      );
      if (response.ok) {
        const data = await response.json();
        const fullText = data.text || data.full_text || null;
        if (fullText) {
          // Calculate reading time (230 WPM average)
          const wordCount = fullText.trim().split(/\s+/).length;
          const readingTimeMinutes = Math.ceil(wordCount / 230);

          if (!enhancedArticle._queueData) {
            enhancedArticle._queueData = {};
          }
          enhancedArticle._queueData.fullText = fullText;
          enhancedArticle._queueData.readingTimeMinutes = readingTimeMinutes;
        }
      }
    } catch (error) {
      console.error("Failed to preload full text:", error);
    }

    // Only preload AI analysis if explicitly requested (to avoid rate limiting)
    if (includeAiAnalysis) {
      try {
        const analysis = await analyzeArticle(article.url, article.source);
        if (analysis) {
          if (!enhancedArticle._queueData) {
            enhancedArticle._queueData = {};
          }
          enhancedArticle._queueData.aiAnalysis = analysis;
        }
      } catch (error) {
        console.error("Failed to preload AI analysis:", error);
      }
    }

    // Mark preload timestamp
    if (enhancedArticle._queueData) {
      enhancedArticle._queueData.preloadedAt = Date.now();
    }

    return enhancedArticle;
  } catch (error) {
    console.error("Error preloading article data:", error);
    return article;
  }
}

export function useReadingQueue() {
  const [queuedArticles, setQueuedArticles] = useState<NewsArticle[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Prevent SSR errors by only accessing localStorage on the client
    if (typeof window !== "undefined") {
      try {
        const storedItems = window.localStorage.getItem(
          READING_QUEUE_STORAGE_KEY
        );
        if (storedItems) {
          const parsed = JSON.parse(storedItems);
          setQueuedArticles(parsed);
          // Notify listeners of initial load
          notifyQueueListeners(parsed);
        }
      } catch (error) {
        console.error("Error reading from localStorage:", error);
        toast.error("Could not load your reading queue.");
      } finally {
        setIsLoaded(true);
      }

      // Listen for storage changes from other tabs/windows
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === READING_QUEUE_STORAGE_KEY && e.newValue) {
          try {
            const updated = JSON.parse(e.newValue);
            setQueuedArticles(updated);
            notifyQueueListeners(updated);
          } catch (error) {
            console.error("Error parsing storage change:", error);
          }
        }
      };

      // Subscribe to our own event emitter for same-tab updates
      const unsubscribe = subscribeToQueueChanges((articles) => {
        setQueuedArticles(articles);
      });

      window.addEventListener("storage", handleStorageChange);
      return () => {
        window.removeEventListener("storage", handleStorageChange);
        unsubscribe();
      };
    }
  }, []);

  useEffect(() => {
    if (isLoaded) {
      try {
        window.localStorage.setItem(
          READING_QUEUE_STORAGE_KEY,
          JSON.stringify(queuedArticles)
        );
        // Notify all listeners of the change
        notifyQueueListeners(queuedArticles);
      } catch (error) {
        console.error("Error writing to localStorage:", error);
        toast.error("Could not save an item to your reading queue.");
      }
    }
  }, [queuedArticles, isLoaded]);

  const addArticleToQueue = useCallback(
    async (article: NewsArticle) => {
      setQueuedArticles((prev) => {
        // Avoid adding duplicates
        if (prev.some((a) => a.url === article.url)) {
          toast.info("Article is already in your reading queue.");
          return prev;
        }
        toast.success("Article added to reading queue.");
        // Add new articles to the top
        return [article, ...prev];
      });

      // Preload data in background
      const preloadedArticle = await preloadArticleData(article);

      // Update with preloaded data
      setQueuedArticles((prev) => {
        return prev.map((a) =>
          a.url === article.url ? preloadedArticle : a
        );
      });

      // Also sync to database if enabled
      if (USE_DATABASE) {
        try {
          await apiAddToQueue(article, "daily");
        } catch (error) {
          console.error("Failed to sync to database:", error);
        }
      }
    },
    []
  );

  const removeArticleFromQueue = useCallback(
    async (articleUrl: string) => {
      setQueuedArticles((prev) => prev.filter((a) => a.url !== articleUrl));
      toast.success("Article removed from queue.");

      // Also sync to database if enabled
      if (USE_DATABASE) {
        try {
          await apiRemoveFromQueue(articleUrl);
        } catch (error) {
          console.error("Failed to sync removal to database:", error);
        }
      }
    },
    []
  );

  const isArticleInQueue = useCallback(
    (articleUrl: string) => {
      return queuedArticles.some((a) => a.url === articleUrl);
    },
    [queuedArticles]
  );

  const getCurrentArticle = useCallback(
    (index: number) => {
      return queuedArticles[index] || null;
    },
    [queuedArticles]
  );

  const goNext = useCallback(
    (currentIndex: number) => {
      const nextIndex = currentIndex + 1;
      if (nextIndex >= queuedArticles.length) {
        return null; // No next article
      }
      return queuedArticles[nextIndex];
    },
    [queuedArticles]
  );

  const goPrev = useCallback(
    (currentIndex: number) => {
      const prevIndex = currentIndex - 1;
      if (prevIndex < 0) {
        return null; // No previous article
      }
      return queuedArticles[prevIndex];
    },
    [queuedArticles]
  );

  const getArticleIndex = useCallback(
    (articleUrl: string) => {
      return queuedArticles.findIndex((a) => a.url === articleUrl);
    },
    [queuedArticles]
  );

  const markAsRead = useCallback(
    (articleUrl: string) => {
      setQueuedArticles((prev) =>
        prev.map((a) =>
          a.url === articleUrl ? { ...a, read_status: "completed" } : a
        )
      );
    },
    []
  );

  const preloadMissingData = useCallback(async () => {
    // Check for articles that don't have preloaded data and preload them
    const articlesNeedingPreload = queuedArticles.filter(
      (a) => !a._queueData || !a._queueData.fullText || !a._queueData.aiAnalysis
    );

    if (articlesNeedingPreload.length === 0) {
      return;
    }

    // Preload data for articles that don't have it
    let preloadedCount = 0;
    for (const article of articlesNeedingPreload) {
      const preloadedArticle = await preloadArticleData(article);
      setQueuedArticles((prev) =>
        prev.map((a) =>
          a.url === article.url ? preloadedArticle : a
        )
      );
      preloadedCount++;
    }

    // Show completion toast
    if (preloadedCount > 0) {
      toast.success(
        `Preloaded ${preloadedCount} article${preloadedCount > 1 ? "s" : ""}`
      );
    }
  }, [queuedArticles]);

  // Auto-preload disabled to prevent rate limiting and unnecessary network calls on load.
  // Users can manually call preloadMissingData() when they want to preload articles.
  // useEffect(() => {
  //   if (isLoaded && queuedArticles.length > 0) {
  //     preloadMissingData();
  //   }
  // }, [isLoaded]);

  return {
    queuedArticles,
    addArticleToQueue,
    removeArticleFromQueue,
    isArticleInQueue,
    isLoaded,
    getCurrentArticle,
    goNext,
    goPrev,
    getArticleIndex,
    markAsRead,
    preloadMissingData,
  };
}
