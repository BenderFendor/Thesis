import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBookmarks } from "@/hooks/useBookmarks";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import {
  createReadingShelf,
  fetchBookmarks,
  fetchLikedArticles,
  getAllHighlights,
  getReadingShelves,
} from "@/lib/api";
import type { NewsArticle, ReadingShelf } from "@/lib/api";
import { logger } from "@/lib/logger";
import {
  mergeSavedArticles,
  requestQueueDigest,
} from "@/app/saved/saved-workspace-model";
import type { SavedArticle } from "@/app/saved/saved-workspace-model";

const SHELF_QUERY_RETRY_COUNT = 1;

interface SavedLibraryState {
  readonly bookmarkIds: ReadonlySet<number>;
  readonly bookmarks: readonly NewsArticle[];
  readonly highlightCount: number;
  readonly likedArticles: readonly NewsArticle[];
  readonly likedIds: ReadonlySet<number>;
  readonly loadIssues: readonly string[];
  readonly loading: boolean;
  readonly reload: () => Promise<void>;
  readonly toggleBookmark: (articleId: number) => Promise<void>;
  readonly toggleLike: (articleId: number) => Promise<void>;
}

interface ShelfState {
  readonly createShelf: () => void;
  readonly isPending: boolean;
  readonly newShelfName: string;
  readonly setNewShelfName: (name: string) => void;
  readonly shelves: readonly ReadingShelf[] | undefined;
  readonly shelvesLoading: boolean;
}

interface DigestState {
  readonly digest: string | undefined;
  readonly generateDigest: () => Promise<void>;
  readonly hideDigest: () => void;
  readonly loading: boolean;
  readonly showDigest: boolean;
}

export interface SavedWorkspaceController {
  readonly activeTab: string;
  readonly allSavedArticles: readonly SavedArticle[];
  readonly bookmarkIds: ReadonlySet<number>;
  readonly bookmarks: readonly NewsArticle[];
  readonly closeArticle: () => void;
  readonly createShelf: () => void;
  readonly digest: string | undefined;
  readonly digestLoading: boolean;
  readonly expandedArticleUrl: string | undefined;
  readonly generateDigest: () => Promise<void>;
  readonly hideDigest: () => void;
  readonly highlightCount: number;
  readonly isArticleInQueue: (articleUrl: string) => boolean;
  readonly isArticleModalOpen: boolean;
  readonly likedArticles: readonly NewsArticle[];
  readonly likedIds: ReadonlySet<number>;
  readonly loadIssues: readonly string[];
  readonly loading: boolean;
  readonly newShelfName: string;
  readonly openArticle: (article: Readonly<NewsArticle>) => void;
  readonly queuedArticles: readonly NewsArticle[];
  readonly reload: () => Promise<void>;
  readonly selectedArticle: NewsArticle | null;
  readonly setActiveTab: (tab: string) => void;
  readonly setExpandedArticleUrl: (articleUrl: string | undefined) => void;
  readonly setNewShelfName: (name: string) => void;
  readonly shelfPending: boolean;
  readonly shelves: readonly ReadingShelf[] | undefined;
  readonly shelvesLoading: boolean;
  readonly showDigest: boolean;
  readonly toggleBookmark: (articleId: number) => Promise<void>;
  readonly toggleLike: (articleId: number) => Promise<void>;
  readonly toggleQueue: (article: Readonly<NewsArticle>) => void;
}

function useSavedLibraryState(): SavedLibraryState {
  const [bookmarks, setBookmarks] = useState<readonly NewsArticle[]>([]),
   [likedArticles, setLikedArticles] = useState<readonly NewsArticle[]>([]),
   [highlightCount, setHighlightCount] = useState(0),
   [loadIssues, setLoadIssues] = useState<readonly string[]>([]),
   [loading, setLoading] = useState(true),
   { bookmarkIds, toggleBookmark } = useBookmarks(),
   { likedIds, toggleLike } = useLikedArticles(),

   reload = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetchBookmarks(),
      fetchLikedArticles(),
      getAllHighlights(),
    ]),
     issues: string[] = [],
     [bookmarksResult, likedResult, highlightsResult] = results;

    if (bookmarksResult.status === "fulfilled") {
      setBookmarks(bookmarksResult.value.map((entry) => entry.article));
    } else {
      issues.push("Bookmarks could not be loaded.");
    }
    if (likedResult.status === "fulfilled") {
      setLikedArticles(likedResult.value.map((entry) => entry.article));
    } else {
      issues.push("Liked articles could not be loaded.");
    }
    if (highlightsResult.status === "fulfilled") {
      setHighlightCount(highlightsResult.value.length);
    } else {
      issues.push("Highlights could not be loaded.");
    }
    setLoadIssues(issues);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    bookmarkIds,
    bookmarks,
    highlightCount,
    likedArticles,
    likedIds,
    loadIssues,
    loading,
    reload,
    toggleBookmark,
    toggleLike,
  };
}

function useShelfState(): ShelfState {
  const [newShelfName, setNewShelfName] = useState(""),
   queryClient = useQueryClient(),
   shelvesQuery = useQuery({
    queryFn: getReadingShelves,
    queryKey: ["reading-shelves"],
    retry: SHELF_QUERY_RETRY_COUNT,
  }),
   createShelfMutation = useMutation({
    mutationFn: createReadingShelf,
    onSuccess: () => {
      setNewShelfName("");
      void queryClient.invalidateQueries({ queryKey: ["reading-shelves"] });
    },
  }),

   createShelf = useCallback(() => {
    const name = newShelfName.trim();
    if (name.length === 0) {
      return;
    }
    createShelfMutation.mutate({ name });
  }, [createShelfMutation, newShelfName]);

  return {
    createShelf,
    isPending: createShelfMutation.isPending,
    newShelfName,
    setNewShelfName,
    shelves: shelvesQuery.data,
    shelvesLoading: shelvesQuery.isLoading,
  };
}

function useDigestState(queuedArticles: readonly NewsArticle[]): DigestState {
  const [digest, setDigest] = useState<string>(),
   [loading, setLoading] = useState(false),
   [showDigest, setShowDigest] = useState(false),

   generateDigest = useCallback(async () => {
    if (queuedArticles.length === 0) {
      return;
    }
    setLoading(true);
    try {
      setDigest(await requestQueueDigest(queuedArticles));
      setShowDigest(true);
    } catch (error: unknown) {
      logger.error("Failed to generate queue digest", error);
    } finally {
      setLoading(false);
    }
  }, [queuedArticles]),

   hideDigest = useCallback(() => {
    setShowDigest(false);
  }, []);

  return { digest, generateDigest, hideDigest, loading, showDigest };
}

export function useSavedWorkspaceController(): SavedWorkspaceController {
  const [activeTab, setActiveTab] = useState("all"),
   [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null),
   [isArticleModalOpen, setIsArticleModalOpen] = useState(false),
   [expandedArticleUrl, setExpandedArticleUrl] = useState<string>(),
   library = useSavedLibraryState(),
   shelf = useShelfState(),
   queue = useReadingQueue(),
   digest = useDigestState(queue.queuedArticles),
   allSavedArticles = useMemo(
    () => mergeSavedArticles(library.bookmarks, library.likedArticles),
    [library.bookmarks, library.likedArticles],
  ),

   openArticle = useCallback((article: Readonly<NewsArticle>) => {
    setSelectedArticle(article);
    setIsArticleModalOpen(true);
  }, []),
   closeArticle = useCallback(() => {
    setIsArticleModalOpen(false);
    setSelectedArticle(null);
  }, []),
   toggleQueue = useCallback(
    (article: Readonly<NewsArticle>) => {
      if (queue.isArticleInQueue(article.url)) {
        void queue.removeArticleFromQueue(article.url);
        return;
      }
      void queue.addArticleToQueue(article);
    },
    [queue],
  );

  return {
    activeTab,
    allSavedArticles,
    bookmarkIds: library.bookmarkIds,
    bookmarks: library.bookmarks,
    closeArticle,
    createShelf: shelf.createShelf,
    digest: digest.digest,
    digestLoading: digest.loading,
    expandedArticleUrl,
    generateDigest: digest.generateDigest,
    hideDigest: digest.hideDigest,
    highlightCount: library.highlightCount,
    isArticleInQueue: queue.isArticleInQueue,
    isArticleModalOpen,
    likedArticles: library.likedArticles,
    likedIds: library.likedIds,
    loadIssues: library.loadIssues,
    loading: library.loading,
    newShelfName: shelf.newShelfName,
    openArticle,
    queuedArticles: queue.queuedArticles,
    reload: library.reload,
    selectedArticle,
    setActiveTab,
    setExpandedArticleUrl,
    setNewShelfName: shelf.setNewShelfName,
    shelfPending: shelf.isPending,
    shelves: shelf.shelves,
    shelvesLoading: shelf.shelvesLoading,
    showDigest: digest.showDigest,
    toggleBookmark: library.toggleBookmark,
    toggleLike: library.toggleLike,
    toggleQueue,
  };
}
