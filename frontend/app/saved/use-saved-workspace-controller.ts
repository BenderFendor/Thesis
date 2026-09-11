import type { NewsArticle, ReadingShelf } from "@/lib/api";
import {
  createReadingShelf,
  fetchBookmarks,
  fetchLikedArticles,
  getAllHighlights,
  getReadingShelves,
  mapBackendArticle,
} from "@/lib/api";

import { mergeSavedArticles, requestQueueDigest } from "@/app/saved/saved-workspace-model";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SavedArticle } from "@/app/saved/saved-workspace-model";
import { logger } from "@/lib/logger";
import { useArticleDetail } from "@/hooks/use-article-detail";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useReadingQueue } from "@/hooks/use-reading-queue";

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

interface SavedLibraryLoadResult {
  readonly bookmarks: readonly NewsArticle[];
  readonly highlightCount: number;
  readonly likedArticles: readonly NewsArticle[];
  readonly loadIssues: readonly string[];
}

type SettledResult<Value> = Readonly<PromiseSettledResult<Value>>;
type IssueCollector = Readonly<{ push: (message: string) => number }>;
const EMPTY_SAVED_ARTICLES: readonly NewsArticle[] = [];

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

interface SavedWorkspaceController {
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

const readSettledResult = <SourceValue, ResultValue>(
  result: SettledResult<SourceValue>,
  mapValue: (value: SourceValue) => ResultValue,
  fallback: ResultValue,
  issue: string,
  issues: IssueCollector,
): ResultValue => {
  if (result.status === "fulfilled") {
    return mapValue(result.value);
  }
  issues.push(issue);
  return fallback;
};

const loadSavedLibraryData = async (): Promise<SavedLibraryLoadResult> => {
  const issues: string[] = [];
  const [bookmarksResult, likedResult, highlightsResult] = await Promise.allSettled([
      fetchBookmarks(),
      fetchLikedArticles(),
      getAllHighlights(),
    ]);
  const bookmarks = readSettledResult(
      bookmarksResult,
      (value) => value.bookmarks.map((entry) => mapBackendArticle(entry)),
      EMPTY_SAVED_ARTICLES,
      "Bookmarks could not be loaded.",
      issues,
    );
  const likedArticles = readSettledResult(
      likedResult,
      (value) => value.liked.map((entry) => mapBackendArticle(entry)),
      EMPTY_SAVED_ARTICLES,
      "Liked articles could not be loaded.",
      issues,
    );
  const highlightCount = readSettledResult(
      highlightsResult,
      (value) => value.length,
      0,
      "Highlights could not be loaded.",
      issues,
    );

  return { bookmarks, highlightCount, likedArticles, loadIssues: issues };
};

const useSavedLibraryState = (): SavedLibraryState => {
  const [bookmarks, setBookmarks] = useState<readonly NewsArticle[]>([]),
    [likedArticles, setLikedArticles] = useState<readonly NewsArticle[]>([]),
    [highlightCount, setHighlightCount] = useState(0),
    [loadIssues, setLoadIssues] = useState<readonly string[]>([]),
    [loading, setLoading] = useState(true),
    { bookmarkIds, toggleBookmark } = useBookmarks(),
    { likedIds, toggleLike } = useLikedArticles(),
    reload = useCallback(async () => {
      setLoading(true);
      const result = await loadSavedLibraryData();
      setBookmarks(result.bookmarks);
      setLikedArticles(result.likedArticles);
      setHighlightCount(result.highlightCount);
      setLoadIssues(result.loadIssues);
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
};

const useShelfState = (): ShelfState => {
  const [newShelfName, setNewShelfName] = useState("");
  const queryClient = useQueryClient();
  const shelvesQuery = useQuery({
      queryFn: getReadingShelves,
      queryKey: ["reading-shelves"],
      retry: SHELF_QUERY_RETRY_COUNT,
    });
  const shelfMutation = useMutation({
      mutationFn: createReadingShelf,
      onSuccess: () => {
        setNewShelfName("");
        void queryClient.invalidateQueries({ queryKey: ["reading-shelves"] });
      },
    });
  const { isPending: shelfPending, mutate: mutateShelf } = shelfMutation;
  const createShelf = useCallback(() => {
      const name = newShelfName.trim();
      if (name.length === 0) {
        return;
      }
      mutateShelf({ name });
    }, [mutateShelf, newShelfName]);

  return {
    createShelf,
    isPending: shelfPending,
    newShelfName,
    setNewShelfName,
    shelves: shelvesQuery.data,
    shelvesLoading: shelvesQuery.isLoading,
  };
};

const useDigestState = (queuedArticles: readonly NewsArticle[]): DigestState => {
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
};

function useSavedWorkspaceController(): SavedWorkspaceController {
  const [activeTab, setActiveTab] = useState("all");
  const articleDetail = useArticleDetail();
  const [expandedArticleUrl, setExpandedArticleUrl] = useState<string>();
  const library = useSavedLibraryState();
  const shelf = useShelfState();
  const {
      addArticleToQueue,
      isArticleInQueue,
      queuedArticles,
      removeArticleFromQueue,
    } = useReadingQueue();
  const digest = useDigestState(queuedArticles);
  const allSavedArticles = useMemo(
      () => mergeSavedArticles(library.bookmarks, library.likedArticles),
      [library.bookmarks, library.likedArticles],
    ),
    toggleQueue = useCallback(
      (article: Readonly<NewsArticle>) => {
        if (isArticleInQueue(article.url)) {
          void removeArticleFromQueue(article.url);
          return;
        }
        void addArticleToQueue(article);
      },
      [addArticleToQueue, isArticleInQueue, removeArticleFromQueue],
    );
  const { isPending: shelfPending, ...shelfView } = shelf,
    { loading: digestLoading, ...digestView } = digest;

  return {
    ...library,
    ...shelfView,
    ...digestView,
    activeTab,
    allSavedArticles,
    closeArticle: articleDetail.close,
    digestLoading,
    expandedArticleUrl,
    isArticleInQueue,
    isArticleModalOpen: articleDetail.isOpen,
    openArticle: articleDetail.open,
    queuedArticles,
    selectedArticle: articleDetail.article,
    setActiveTab,
    setExpandedArticleUrl,
    shelfPending,
    toggleQueue,
  };
}
export { useSavedWorkspaceController };
export type { SavedWorkspaceController };
