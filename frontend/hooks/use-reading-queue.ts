import { fetchArticleContentText } from "@/lib/article-content";
import { hasText } from "@/lib/utils";
import {
  analyzeArticle,
  addToReadingQueue as apiAddToQueue,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
} from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsArticle } from "@/lib/api";
import { toast } from "sonner";
import { z } from "zod";

const READING_QUEUE_STORAGE_KEY = "readingQueue",
  USE_DATABASE = process.env.NEXT_PUBLIC_USE_DB_QUEUE === "true",
  WORDS_PER_MINUTE_READING = 230;

type QueueDataPatch = Readonly<Partial<NonNullable<NewsArticle["_queueData"]>>>;
const QUEUE_DATA_KEY = "_queueData" as const;
type QueueStorageEvent = Readonly<Pick<StorageEvent, "key" | "newValue">>;

const STORED_ARTICLE_CONTRACT_SCHEMA = z
  .object({
    _parsedTimestamp: z.number().optional(),
    _queueData: z
      .object({
        aiAnalysis: z.unknown().optional(),
        fullText: z.string().optional(),
        preloadedAt: z.number().optional(),
        readingTimeMinutes: z.number().optional(),
      })
      .passthrough()
      .optional(),
    author: z.string().optional(),
    authors: z.array(z.string()).optional(),
    bias: z.enum(["left", "center", "right"]),
    category: z.string(),
    content: z.string().optional(),
    country: z.string(),
    credibility: z.enum(["high", "medium", "low"]),
    geo_signal: z
      .object({
        id: z.string(),
        label: z.string(),
      })
      .optional(),
    hasFullContent: z.boolean().optional(),
    id: z.number(),
    image: z.string(),
    isPersisted: z.boolean().optional(),
    mentioned_countries: z.array(z.string()).optional(),
    originalLanguage: z.string(),
    publishedAt: z.string(),
    source: z.string(),
    sourceId: z.string(),
    source_country: z.string().optional(),
    summary: z.string(),
    tags: z.array(z.string()),
    title: z.string(),
    translated: z.boolean(),
    url: z.string(),
  })
  .passthrough();
const STORED_ARTICLE_SCHEMA = z.custom<NewsArticle>(
  (value) => STORED_ARTICLE_CONTRACT_SCHEMA.safeParse(value).success,
);
const STORED_QUEUE_SCHEMA = z.array(STORED_ARTICLE_SCHEMA);

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
    return (await fetchArticleContentText(article.url)) ?? undefined;
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

const withQueueData = (article: NewsArticle, patch: QueueDataPatch): NewsArticle => {
  const enhanced = { ...article };
  enhanced[QUEUE_DATA_KEY] = { ...enhanced[QUEUE_DATA_KEY], ...patch };
  return enhanced;
};

const addFullTextData = (article: NewsArticle, fullText: string | undefined): NewsArticle => {
  if (!hasText(fullText)) {
    return article;
  }
  const wordCount = fullText.trim().split(/\s+/u).length;
  return withQueueData(article, {
    fullText,
    readingTimeMinutes: Math.ceil(wordCount / WORDS_PER_MINUTE_READING),
  });
};

const addAiAnalysisData = async (
  article: NewsArticle,
  includeAiAnalysis: boolean,
): Promise<QueueDataPatch> => {
  if (!includeAiAnalysis) {
    return {};
  }
  const analysis = await preloadAiAnalysis(article);
  if (analysis === undefined) {
    return {};
  }
  return { aiAnalysis: analysis };
};

const markAsPreloaded = (article: NewsArticle): NewsArticle => {
  if (article[QUEUE_DATA_KEY] === undefined) {
    return article;
  }
  return withQueueData(article, { preloadedAt: Date.now() });
};

const addQueueData = (article: NewsArticle, patch: QueueDataPatch): NewsArticle => {
  if (Object.keys(patch).length === 0) {
    return article;
  }
  return withQueueData(article, patch);
};

const preloadArticleData = async (
  article: NewsArticle,
  options: Readonly<{ includeAiAnalysis?: boolean }> = {},
): Promise<NewsArticle> => {
  const { includeAiAnalysis = false } = options;
  const fullText = await preloadFullText(article);
  const articleWithText = addFullTextData({ ...article }, fullText);
  const analysisData = await addAiAnalysisData(article, includeAiAnalysis);
  return markAsPreloaded(addQueueData(articleWithText, analysisData));
};

const replaceQueueArticle = (
  articles: readonly NewsArticle[],
  articleUrl: string,
  replacement: NewsArticle,
): NewsArticle[] =>
  articles.map((queuedArticle) => {
    if (queuedArticle.url === articleUrl) {
      return replacement;
    }
    return queuedArticle;
  });

const markQueueArticleAsRead = (
  articles: readonly NewsArticle[],
  articleUrl: string,
): NewsArticle[] =>
  articles.map((queuedArticle) => {
    if (queuedArticle.url === articleUrl) {
      return { ...queuedArticle, read_status: "completed" };
    }
    return queuedArticle;
  });

const replacePreloadedArticles = (
  queuedArticles: readonly NewsArticle[],
  preloadedArticles: readonly NewsArticle[],
): NewsArticle[] =>
  preloadedArticles.reduce(
    (currentArticles, preloadedArticle) =>
      replaceQueueArticle(currentArticles, preloadedArticle.url, preloadedArticle),
    [...queuedArticles],
  );

const getArticleCountSuffix = (count: number): string => {
  if (count > 1) {
    return "s";
  }
  return "";
};

const preloadArticlesSequentially = (articles: readonly NewsArticle[]): Promise<NewsArticle[]> =>
  articles.reduce<Promise<NewsArticle[]>>(async (preloadedPromise, article) => {
    const preloadedArticles = await preloadedPromise;
    preloadedArticles.push(await preloadArticleData(article));
    return preloadedArticles;
  }, Promise.resolve([]));

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
          if (prev.some((queuedArticle) => queuedArticle.url === article.url)) {
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
        setQueuedArticles((prev) => replaceQueueArticle(prev, article.url, preloadedArticle));

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
        setQueuedArticles((prev) =>
          prev.filter((queuedArticle) => queuedArticle.url !== articleUrl),
        );
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
      (articleUrl: string) =>
        queuedArticles.findIndex((queuedArticle) => queuedArticle.url === articleUrl),
      [queuedArticles],
    ),
    getCurrentArticle = useCallback(
      (index: number) => queuedArticles[index] ?? null,
      [queuedArticles],
    ),
    isArticleInQueue = useCallback(
      (articleUrl: string) =>
        queuedArticles.some((queuedArticle) => queuedArticle.url === articleUrl),
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
        setQueuedArticles((prev) => markQueueArticleAsRead(prev, articleUrl));
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
      (article) =>
        !hasText(article[QUEUE_DATA_KEY]?.fullText) || !article[QUEUE_DATA_KEY]?.aiAnalysis,
    );

    if (articlesNeedingPreload.length === 0) {
      return;
    }

    const preloadedArticles = await preloadArticlesSequentially(articlesNeedingPreload);
    setQueuedArticles((prev) => replacePreloadedArticles(prev, preloadedArticles));

    // Show completion toast
    const preloadedCount = preloadedArticles.length;
    if (preloadedCount > 0) {
      toast.success(`Preloaded ${preloadedCount} article${getArticleCountSuffix(preloadedCount)}`);
    }
  }, [queuedArticles, setQueuedArticles]);

  return { preloadMissingData };
};

const parseStoredQueue = (raw: string | null): NewsArticle[] | null => {
  if (raw === null) {
    return null;
  }
  try {
    const parsed = STORED_QUEUE_SCHEMA.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
    return null;
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
    const handleStorageChange = (event: QueueStorageEvent) => {
        if (event.key !== READING_QUEUE_STORAGE_KEY || !hasText(event.newValue)) {
          return;
        }
        const updated = parseStoredQueue(event.newValue);
        if (updated === null) {
          return;
        }
        setQueuedArticles(updated);
        notifyQueueListeners(updated);
      },
      // Subscribe to our own event emitter for same-tab updates
      unsubscribe = subscribeToQueueChanges((articles) => {
        setQueuedArticles((current) => {
          if (areQueueArticlesEqual(current, articles)) {
            return current;
          }
          return [...articles];
        });
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
