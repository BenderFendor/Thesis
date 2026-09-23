"use client";

import { API_BASE_URL, analyzeArticle, fetchSourceDebugData, getSourceById } from "@/lib/api";
import type { ArticleAnalysis, NewsArticle, NewsSource, SourceDebugData } from "@/lib/api";
import { articleContentQueryKey, fetchArticleContentText } from "@/lib/article-content";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useArticleReaction } from "@/hooks/use-article-reaction";
import { useCallback } from "react";
import { useFavorites } from "@/hooks/use-favorites";
import { useReadingHistory } from "@/hooks/use-reading-history";
import { useReadingQueue } from "@/hooks/use-reading-queue";
import { z } from "zod";

const DIGEST_FENCE_PATTERN = /```json:articles\n[\s\S]*?\n```/gu;

const DigestResponseSchema = z.object({
  content: z.string().optional(),
  digest: z.string().optional(),
});

interface DigestArticleSummary {
  readonly category: string;
  readonly source: string;
  readonly summary: string;
  readonly title: string;
  readonly url: string;
}

interface QueueArticleData {
  readonly fullText?: string;
}

interface ReadingQueryArticle {
  readonly _queueData?: QueueArticleData;
  readonly source: NewsArticle["source"];
  readonly sourceId: NewsArticle["sourceId"];
  readonly url: NewsArticle["url"];
}

const getDigestCategory = (category: string): string => {
  if (category === "") {
    return "Uncategorized";
  }
  return category;
};

const parseDigestResponse = (text: string) => {
  try {
    return DigestResponseSchema.safeParse(JSON.parse(text));
  } catch {
    throw new Error("Queue digest returned an invalid response");
  }
};

const readDigestResponse = async (
  response: Readonly<Response>,
): Promise<z.infer<typeof DigestResponseSchema>> => {
  const result = parseDigestResponse(await response.text());
  if (!result.success || (result.data.digest === undefined && result.data.content === undefined)) {
    throw new Error("Queue digest returned an invalid response");
  }
  return result.data;
};

const getDigestArticleSummaries = (
  articles: readonly NewsArticle[],
): readonly DigestArticleSummary[] =>
  articles.map((article) => ({
    category: getDigestCategory(article.category),
    source: article.source,
    summary: article.summary,
    title: article.title,
    url: article.url,
  }));

const groupDigestArticles = (articles: readonly DigestArticleSummary[]) => {
  const grouped = new Map<string, DigestArticleSummary[]>();
  for (const article of articles) {
    const categoryArticles = grouped.get(article.category) ?? [];
    categoryArticles.push(article);
    grouped.set(article.category, categoryArticles);
  }
  return Object.fromEntries(grouped);
};

const requestQueueDigest = async (
  articles: readonly NewsArticle[],
): Promise<string | undefined> => {
  const summaries = getDigestArticleSummaries(articles);
  const response = await fetch(`${API_BASE_URL}/api/queue/digest`, {
    body: JSON.stringify({ articles: summaries, grouped: groupDigestArticles(summaries) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Queue digest failed (${response.status})`);
  }
  const data = await readDigestResponse(response);
  const digest = (data.digest ?? data.content ?? "").replace(DIGEST_FENCE_PATTERN, "").trim();
  if (digest.length === 0) {
    throw new Error("Queue digest returned an empty response");
  }
  return digest;
};

interface ReadingQueueQueries {
  readonly articleLoading: boolean;
  readonly fullArticleText?: string;
  readonly aiAnalysis?: Readonly<ArticleAnalysis>;
  readonly aiAnalysisLoading: boolean;
  readonly source?: Readonly<NewsSource>;
  readonly sourceLoading: boolean;
  readonly debugData?: Readonly<SourceDebugData>;
  readonly debugLoading: boolean;
  readonly digestLoading: boolean;
  readonly queueDigest?: string;
  readonly digestError?: string;
  readonly generateDigest: () => void;
}

const useReadingQueueContext = () => {
  const { isLoaded, queuedArticles, removeArticleFromQueue } = useReadingQueue();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { getRecentIds } = useReadingHistory();
  const { isSelected: isLiked, toggle: toggleLike } = useArticleReaction("like");
  const { isSelected: isBookmarked, toggle: toggleBookmark } = useArticleReaction("bookmark");
  return {
    getRecentIds,
    isBookmarked,
    isFavorite,
    isLiked,
    isLoaded,
    queuedArticles,
    removeArticleFromQueue,
    toggleBookmark,
    toggleFavorite,
    toggleLike,
  };
};

const getPreloadedText = (
  article: Readonly<Pick<ReadingQueryArticle, "_queueData">> | undefined,
): string | undefined => {
  if (article === undefined) {
    return void 0;
  }
  const { _queueData: queueData } = article;
  return queueData?.fullText;
};

const getArticleContentQueryFn = (
  article: Readonly<ReadingQueryArticle> | undefined,
  preloadedText: string | undefined,
) => {
  if (article === undefined || preloadedText !== undefined) {
    return skipToken;
  }
  return async ({ signal }: Readonly<{ readonly signal: AbortSignal }>) =>
    (await fetchArticleContentText(article.url, signal)) ?? "";
};

const getAnalysisQueryFn = (article: Readonly<ReadingQueryArticle> | undefined) => {
  if (article === undefined) {
    return skipToken;
  }
  return () => analyzeArticle(article.url, article.source);
};

const getSourceQueryFn = (article: Readonly<ReadingQueryArticle> | undefined) => {
  if (article === undefined) {
    return skipToken;
  }
  return async () => (await getSourceById(article.sourceId)) ?? null;
};

const getDebugQueryFn = (
  article: Readonly<ReadingQueryArticle> | undefined,
  debugOpen: boolean,
) => {
  if (!debugOpen || article === undefined) {
    return skipToken;
  }
  return () => fetchSourceDebugData(article.source);
};

const useReadingQueueData = (
  article: Readonly<ReadingQueryArticle> | undefined,
  articleUrl: string | undefined,
  preloadedText: string | undefined,
  debugOpen: boolean,
) => {
  const articleQuery = useQuery({
    queryFn: getArticleContentQueryFn(article, preloadedText),
    queryKey: articleContentQueryKey(articleUrl ?? ""),
    retry: false,
  });
  const analysisQuery = useQuery({
    queryFn: getAnalysisQueryFn(article),
    queryKey: ["reading-queue", "analysis", articleUrl, article?.source],
    retry: false,
  });
  const sourceQuery = useQuery({
    queryFn: getSourceQueryFn(article),
    queryKey: ["reading-queue", "source", article?.sourceId],
    retry: false,
  });
  const debugQuery = useQuery({
    queryFn: getDebugQueryFn(article, debugOpen),
    queryKey: ["reading-queue", "debug", article?.source],
    retry: false,
  });
  return { analysisQuery, articleQuery, debugQuery, sourceQuery };
};

const getArticleLoading = (
  article: Readonly<ReadingQueryArticle> | undefined,
  preloadedText: string | undefined,
  isLoading: boolean,
): boolean => article !== undefined && preloadedText === undefined && isLoading;

const useQueueDigestMutation = (queuedArticles: readonly NewsArticle[]) => {
  const {
    data: queueDigest,
    error: digestError,
    isPending: digestLoading,
    mutate,
  } = useMutation({ mutationFn: requestQueueDigest });
  const generateDigest = useCallback(() => {
    mutate(queuedArticles);
  }, [mutate, queuedArticles]);
  return { digestError: digestError?.message, digestLoading, generateDigest, queueDigest };
};

const useReadingQueueQueries = (
  article: Readonly<ReadingQueryArticle> | undefined,
  debugOpen: boolean,
  queuedArticles: readonly NewsArticle[],
): ReadingQueueQueries => {
  const articleUrl = article?.url;
  const preloadedText = getPreloadedText(article);
  const { analysisQuery, articleQuery, debugQuery, sourceQuery } = useReadingQueueData(
    article,
    articleUrl,
    preloadedText,
    debugOpen,
  );
  const { digestError, digestLoading, generateDigest, queueDigest } =
    useQueueDigestMutation(queuedArticles);
  let aiAnalysis = analysisQuery.data;
  if (aiAnalysis === undefined && analysisQuery.isError) {
    aiAnalysis = {
      article_url: articleUrl ?? "",
      error: analysisQuery.error?.message ?? "Failed to analyze article",
      success: false,
    };
  }
  return {
    aiAnalysis,
    aiAnalysisLoading: analysisQuery.isLoading,
    articleLoading: getArticleLoading(article, preloadedText, articleQuery.isLoading),
    debugData: debugQuery.data,
    debugLoading: debugQuery.isLoading,
    digestError,
    digestLoading,
    fullArticleText: preloadedText ?? articleQuery.data,
    generateDigest,
    queueDigest,
    source: sourceQuery.data ?? undefined,
    sourceLoading: sourceQuery.isLoading,
  };
};

export { useReadingQueueContext, useReadingQueueQueries };
