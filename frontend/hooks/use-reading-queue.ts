import { hasText } from "@/lib/utils";
import {
  API_BASE_URL,
  analyzeArticle,
  addToReadingQueue as apiAddToQueue,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
} from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsArticle } from "@/lib/api";
import { toast } from "sonner";

const READING_QUEUE_STORAGE_KEY = "readingQueue",
  USE_DATABASE = process.env.NEXT_PUBLIC_USE_DB_QUEUE === "true",
  WORDS_PER_MINUTE_READING = 230;

type QueueDataPatch = Readonly<Partial<NonNullable<NewsArticle["_queueData"]>>>;
const QUEUE_DATA_KEY = "_queueData" as const;
type QueueStorageEvent = Readonly<Pick<StorageEvent, "key" | "newValue">>;

// Event emitter for cross-component updates
type QueueListener = (articles: readonly NewsArticle[]) => void;
const queueListeners = new Set<QueueListener>();

const notifyQueueListeners = (articles: readonly NewsArticle[]) => {
  queueListeners.forEach((listener) => {
    listener(articles);
  });
};

const subscribeToQueueChanges = (listener: QueueListener) => {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
};

const areQueueArticlesEqual = (left: readonly NewsArticle[], right: readonly NewsArticle[]) =>
  JSON.stringify(left) === JSON.stringify(right);

const preloadFullText = async (article: NewsArticle): Promise<string | undefined> => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`,
    );
    if (!response.ok) {
      return void 0;
    }
    const data = await response.json();
    const text = data.text ?? data.full_text;
    if (text === "") {
      return void 0;
    }
    return text;
  } catch (error) {
    console.error("Failed to preload full text:", error);
    return void 0;
  }
};

const preloadAiAnalysis = async (
  article: NewsArticle,
): Promise<Awaited<ReturnType<typeof analyzeArticle>> | undefined> => {
  try {
    return await analyzeArticle(article.url, article.source);
  } catch (error) {
    console.error("Failed to preload AI analysis:", error);
    return void 0;
  }
};

const withQueueData = (
  article: NewsArticle,
  patch: QueueDataPatch,
): NewsArticle => {
  const enhanced = { ...article };
  enhanced[QUEUE_DATA_KEY] = { ...enhanced[QUEUE_DATA_KEY], ...patch };
  return enhanced;
};

const preloadArticleData = async (
  article: NewsArticle,
  options: Readonly<{ includeAiAnalysis?: boolean }> = {},
): Promise<NewsArticle> => {
  const { includeAiAnalysis = false } = options;
  let enhancedArticle = { ...article };
  const fullText = await preloadFullText(article);
  if (hasText(fullText)) {
    const wordCount = fullText.trim().split(/\s+/u).length;
    enhancedArticle = withQueueData(enhancedArticle, {
      fullText,
      readingTimeMinutes: Math.ceil(wordCount / WORDS_PER_MINUTE_READING),
    });
  }

  if (includeAiAnalysis) {
    const analysis = await preloadAiAnalysis(article);
    if (analysis) {
      enhancedArticle = withQueueData(enhancedArticle, { aiAnalysis: analysis });
    }
  }

  if (enhancedArticle[QUEUE_DATA_KEY]) {
    enhancedArticle[QUEUE_DATA_KEY] = {
      ...enhancedArticle[QUEUE_DATA_KEY],
      preloadedAt: Date.now(),
    };
  }
  return enhancedArticle;
};

const useQueueIndexers = (
  queuedArticles: readonly NewsArticle[],
  setQueuedArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>,
) => {
  const { getArticleIndex, getCurrentArticle, isArticleInQueue } =
      useQueueSelectors(queuedArticles),
    { goNext, goPrev, markAsRead } = useQueueNavigation(queuedArticles, setQueuedArticles);
  return { getArticleIndex, getCurrentArticle, goNext, goPrev, isArticleInQueue, markAsRead };
};

const useQueueMutations = (
  setQueuedArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>,
) => {
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
        setQueuedArticles((prev) =>
          prev.map((a) => ((() => {
  if (a.url === article.url) {
    return preloadedArticle;
  }
  return a;
})())),
        );

        // Also sync to database if enabled
        if (USE_DATABASE && article.isPersisted !== false) {
          try {
            await apiAddToQueue(article, "daily");
          } catch (error) {
            console.error("Failed to sync to database:", error);
          }
        }
      },
      [setQueuedArticles],
    ),
    removeArticleFromQueue = useCallback(
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
      [setQueuedArticles],
    );

  return { addArticleToQueue, removeArticleFromQueue };
};

const useQueueSelectors = (queuedArticles: readonly NewsArticle[]) => {
  const getArticleIndex = useCallback(
      (articleUrl: string) => queuedArticles.findIndex((a) => a.url === articleUrl),
      [queuedArticles],
    ),
    getCurrentArticle = useCallback(
      (index: number) => queuedArticles[index] ?? null,
      [queuedArticles],
    ),
    isArticleInQueue = useCallback(
      (articleUrl: string) => queuedArticles.some((a) => a.url === articleUrl),
      [queuedArticles],
    );
  return { getArticleIndex, getCurrentArticle, isArticleInQueue };
};

const useQueueNavigation = (
  queuedArticles: readonly NewsArticle[],
  setQueuedArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>,
) => {
  const goNext = useCallback(
      (currentIndex: number) => queuedArticles[currentIndex + 1],
      [queuedArticles],
    ),
    goPrev = useCallback(
      (currentIndex: number) => queuedArticles[currentIndex - 1],
      [queuedArticles],
    ),
    markAsRead = useCallback(
      (articleUrl: string) => {
        setQueuedArticles((prev) =>
          prev.map((a) => ((() => {
  if (a.url === articleUrl) {
    return {
      ...a,
      read_status: "completed"
    };
  }
  return a;
})())),
        );
      },
      [setQueuedArticles],
    );
  return { goNext, goPrev, markAsRead };
};

const useQueuePreload = (
  queuedArticles: readonly NewsArticle[],
  setQueuedArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>,
) => {
  const preloadMissingData = useCallback(async () => {
    // Check for articles that don't have preloaded data and preload them
    const articlesNeedingPreload = queuedArticles.filter(
      (article) => !hasText(article[QUEUE_DATA_KEY]?.fullText) || !article[QUEUE_DATA_KEY]?.aiAnalysis,
    );

    if (articlesNeedingPreload.length === 0) {
      return;
    }

    // Preload data for articles that don't have it
    let preloadedCount = 0;
    for (const article of articlesNeedingPreload) {
      const preloadedArticle = await preloadArticleData(article);
      setQueuedArticles((prev) => prev.map((a) => ((() => {
  if (a.url === article.url) {
    return preloadedArticle;
  }
  return a;
})())));
      preloadedCount++;
    }

    // Show completion toast
    if (preloadedCount > 0) {
      toast.success(`Preloaded ${preloadedCount} article${(() => {
  if (preloadedCount > 1) {
    return "s";
  }
  return "";
})()}`);
    }
  }, [queuedArticles, setQueuedArticles]);

  return { preloadMissingData };
};

const parseStoredQueue = (raw: string | null): NewsArticle[] | null => {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Error parsing storage queue:", error);
    return null;
  }
};

const useQueueListeners = (
  setQueuedArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>,
) => {
  useEffect(() => {
    // Listen for storage changes from other tabs/windows
    const handleStorageChange = (e: QueueStorageEvent) => {
        if (e.key === READING_QUEUE_STORAGE_KEY && hasText(e.newValue)) {
          try {
            const updated = JSON.parse(e.newValue);
            setQueuedArticles(updated);
            notifyQueueListeners(updated);
          } catch (error) {
            console.error("Error parsing storage change:", error);
          }
        }
      },
      // Subscribe to our own event emitter for same-tab updates
      unsubscribe = subscribeToQueueChanges((articles) => {
        setQueuedArticles((current) =>
          (() => {
  if (areQueueArticlesEqual(current, articles)) {
    return current;
  }
  return [...articles];
})(),
        );
      });

    globalThis.addEventListener("storage", handleStorageChange);
    return () => {
      globalThis.removeEventListener("storage", handleStorageChange);
      unsubscribe();
    };
  }, [setQueuedArticles]);
};

const persistQueue = (queuedArticles: readonly NewsArticle[], isLoaded: boolean) => {
  if (!isLoaded) {
    return;
  }
  try {
    globalThis.localStorage.setItem(READING_QUEUE_STORAGE_KEY, JSON.stringify(queuedArticles));
    // Notify all listeners of the change
    notifyQueueListeners(queuedArticles);
  } catch (error) {
    console.error("Error writing to localStorage:", error);
    toast.error("Could not save an item to your reading queue.");
  }
};

const useQueueHydration = (
  setQueuedArticles: React.Dispatch<React.SetStateAction<NewsArticle[]>>,
  setIsLoaded: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  const loadedSetterRef = useRef(setIsLoaded);
  useEffect(() => {
    // Prevent SSR errors by only accessing localStorage on the client
    if (globalThis.window !== undefined) {
      try {
        const parsed = parseStoredQueue(globalThis.localStorage.getItem(READING_QUEUE_STORAGE_KEY));
        if (parsed !== null) {
          setQueuedArticles(parsed);
        }
      } catch (error) {
        console.error("Error reading from localStorage:", error);
        toast.error("Could not load your reading queue.");
      } finally {
        loadedSetterRef.current(true);
      }
    }
  }, [setQueuedArticles]);

  useQueueListeners(setQueuedArticles);
};

const useQueuePersistence = (queuedArticles: readonly NewsArticle[], isLoaded: boolean) => {
  useEffect(() => {
    persistQueue(queuedArticles, isLoaded);
  }, [queuedArticles, isLoaded]);
};

const useQueuedArticlesStorage = () => {
  const [queuedArticles, setQueuedArticles] = useState<NewsArticle[]>([]),
    [isLoaded, setIsLoaded] = useState(false);
  useQueueHydration(setQueuedArticles, setIsLoaded);
  useQueuePersistence(queuedArticles, isLoaded);
  return { isLoaded, queuedArticles, setQueuedArticles };
};

export function useReadingQueue() {
  const { queuedArticles, setQueuedArticles, isLoaded } = useQueuedArticlesStorage();

  const { addArticleToQueue, removeArticleFromQueue } = useQueueMutations(setQueuedArticles),
    { getArticleIndex, getCurrentArticle, goNext, goPrev, isArticleInQueue, markAsRead } =
      useQueueIndexers(queuedArticles, setQueuedArticles),
    { preloadMissingData } = useQueuePreload(queuedArticles, setQueuedArticles);

  // Auto-preload disabled to prevent rate limiting and unnecessary network calls on load.
  // Users can manually call preloadMissingData() when they want to preload articles.
  // UseEffect(() => {
  //   If (isLoaded && queuedArticles.length > 0) {
  //     PreloadMissingData();
  //   }
  // }, [isLoaded]);

  return {
    addArticleToQueue,
    getArticleIndex,
    getCurrentArticle,
    goNext,
    goPrev,
    isArticleInQueue,
    isLoaded,
    markAsRead,
    preloadMissingData,
    queuedArticles,
    removeArticleFromQueue,
  };
}
