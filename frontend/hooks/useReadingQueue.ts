import { useState, useEffect, useCallback } from "react";
import { NewsArticle } from "@/lib/api";
import {
  addToReadingQueue as apiAddToQueue,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
} from "@/lib/api";
import { toast } from "sonner";

const READING_QUEUE_STORAGE_KEY = "readingQueue";
const USE_DATABASE = process.env.NEXT_PUBLIC_USE_DB_QUEUE === "true";

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

  return {
    queuedArticles,
    addArticleToQueue,
    removeArticleFromQueue,
    isArticleInQueue,
    isLoaded,
  };
}
