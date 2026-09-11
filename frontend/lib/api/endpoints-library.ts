import { z } from "zod";

import { mapBackendArticle } from "./article";
import { API_BASE_URL, api, query } from "./client";
import type {
  AllClustersResponse,
  BookmarkEntry,
  BookmarkListResponse,
  BreakingResponse,
  ClusterDetail,
  ContradictionPanelResponse,
  Highlight,
  LikedEntry,
  LikedListResponse,
  NewsArticle,
  QueueDigest,
  QueueOverview,
  ReadingQueueItem,
  ReadingShelf,
  StoryLineageResponse,
  TrendingResponse,
} from "./types";
import {
  AllClustersResponseSchema,
  BookmarkEntrySchema,
  BookmarkListResponseSchema,
  BreakingResponseSchema,
  ClusterDetailSchema,
  ContradictionPanelResponseSchema,
  HighlightSchema,
  LikedEntrySchema,
  LikedListResponseSchema,
  QueueDigestSchema,
  QueueOverviewSchema,
  ReadingQueueItemSchema,
  ReadingShelfSchema,
  StoryLineageResponseSchema,
  TrendingResponseSchema,
} from "./response-schemas";

const NOT_FOUND = 404;

const fetchBookmarks = (): Promise<BookmarkListResponse> =>
  api("/api/bookmarks", BookmarkListResponseSchema);

const createBookmark = async (articleId: number): Promise<BookmarkEntry | null> => {
  try {
    return await api("/api/bookmarks", BookmarkEntrySchema, {
      body: JSON.stringify({ article_id: articleId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to create bookmark:", error);
    return null;
  }
};

const deleteBookmark = async (articleId: number): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/api/bookmarks/${articleId}`, {
    method: "DELETE",
  });
  if (response.status === NOT_FOUND) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return true;
};

const fetchLikedArticles = (): Promise<LikedListResponse> => api("/api/liked", LikedListResponseSchema);

const createLikedArticle = async (articleId: number): Promise<LikedEntry | null> => {
  try {
    return await api("/api/liked", LikedEntrySchema, {
      body: JSON.stringify({ article_id: articleId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to like article:", error);
    return null;
  }
};

const deleteLikedArticle = async (articleId: number): Promise<boolean> => {
  const response = await fetch(`${API_BASE_URL}/api/liked/${articleId}`, {
    method: "DELETE",
  });
  if (response.status === NOT_FOUND) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return true;
};

const getAllHighlights = (): Promise<Highlight[]> =>
  api("/api/queue/highlights", z.array(HighlightSchema));

const deleteHighlight = async (highlightId: number): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/queue/highlights/${highlightId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
};

const getQueueOverview = (): Promise<QueueOverview> =>
  api("/api/queue/overview", QueueOverviewSchema);

const getDailyDigest = (): Promise<QueueDigest> => api("/api/queue/digest/daily", QueueDigestSchema);

const getReadingShelves = (): Promise<ReadingShelf[]> =>
  api("/api/queue/shelves", z.array(ReadingShelfSchema));

const createReadingShelf = (
  request: Readonly<{ name: string; description?: string | null }>,
): Promise<ReadingShelf> =>
  api("/api/queue/shelves", ReadingShelfSchema, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const addToReadingQueue = (
  article: Readonly<Pick<NewsArticle, "id" | "image" | "source" | "title" | "url">>,
  queueType: "daily" | "permanent" = "daily",
): Promise<ReadingQueueItem> =>
  api("/api/queue/add", ReadingQueueItemSchema, {
    body: JSON.stringify({
      article_id: article.id,
      article_image: article.image,
      article_source: article.source,
      article_title: article.title,
      article_url: article.url,
      queue_type: queueType,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const removeFromReadingQueueByUrl = async (articleUrl: string): Promise<void> => {
  const encodedUrl = encodeURIComponent(articleUrl);
  const response = await fetch(`${API_BASE_URL}/api/queue/url/${encodedUrl}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
};

// --- Trending / breaking / clusters ---

const fetchTrending = (window: "1d" | "1w" | "1m" = "1d", limit = 10): Promise<TrendingResponse> =>
  api(`/trending${query({ limit, window })}`, TrendingResponseSchema);

const fetchBreaking = (limit = 5): Promise<BreakingResponse> =>
  api(`/trending/breaking${query({ limit })}`, BreakingResponseSchema);

const fetchAllClusters = (
  window: "1d" | "1w" | "1m" = "1d",
  minArticles = 2,
  limit = 100,
): Promise<AllClustersResponse> =>
  api(
    `/trending/clusters${query({ limit, min_articles: minArticles, window })}`,
    AllClustersResponseSchema,
  );

const fetchClusterDetail = (clusterId: number): Promise<ClusterDetail> =>
  api(`/trending/clusters/${clusterId}`, ClusterDetailSchema);

const fetchClusterContradictions = (clusterId: number): Promise<ContradictionPanelResponse> =>
  api(`/trending/clusters/${clusterId}/contradictions`, ContradictionPanelResponseSchema);

const fetchClusterLineage = (clusterId: number): Promise<StoryLineageResponse> =>
  api(`/trending/clusters/${clusterId}/lineage`, StoryLineageResponseSchema);

const fetchClusterArticles = async (clusterId: number): Promise<NewsArticle[]> => {
  const detail = await fetchClusterDetail(clusterId);
  return (detail.articles ?? []).map((article) =>
    Object.assign(mapBackendArticle(article), {
      category: "trending" as const,
      tags: ["trending", article.source],
    }),
  );
};

// --- Search ---


export {
  fetchBookmarks,
  createBookmark,
  deleteBookmark,
  fetchLikedArticles,
  createLikedArticle,
  deleteLikedArticle,
  getAllHighlights,
  deleteHighlight,
  getQueueOverview,
  getDailyDigest,
  getReadingShelves,
  createReadingShelf,
  addToReadingQueue,
  removeFromReadingQueueByUrl,
  fetchTrending,
  fetchBreaking,
  fetchAllClusters,
  fetchClusterDetail,
  fetchClusterContradictions,
  fetchClusterLineage,
  fetchClusterArticles,
};
