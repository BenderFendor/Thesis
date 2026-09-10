"use client";

import { hasText } from "@/lib/utils";
import type { ClusterArticle } from "@/lib/api";
import { articleContentQueryKey, fetchArticleContentText } from "@/lib/article-content";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ClusterDetailResponse } from "./cluster-detail-modal-types";

const useArticleContentState = () => {
  const queryClient = useQueryClient();
  const [articleContents, setArticleContents] = useState<Map<number, string | null>>(new Map());
  const [loadingArticle, setLoadingArticle] = useState<number | null>(null);
  const articleContentRef = useRef<HTMLDivElement>(null);
  const loadArticleContent = useCallback(
    async (article: Pick<ClusterArticle, "id" | "url">): Promise<string | null> => {
      setLoadingArticle(article.id);
      try {
        const text = await queryClient.fetchQuery<string | null>({
          queryFn: ({ signal }) => fetchArticleContentText(article.url, signal),
          queryKey: articleContentQueryKey(article.url),
          staleTime: 5 * 60 * 1000,
        });
        setArticleContents((previous) => new Map(previous).set(article.id, text));
        return text;
      } catch (error) {
        console.error("Failed to extract article:", error);
        setArticleContents((previous) => new Map(previous).set(article.id, null));
        return null;
      } finally {
        setLoadingArticle(null);
      }
    },
    [queryClient],
  );
  return {
    articleContentRef,
    articleContents,
    loadArticleContent,
    loadingArticle,
    setArticleContents,
  };
};

const getActiveArticleContent = (
  article: Readonly<{ id: number }> | undefined,
  articleContents: ReadonlyMap<number, string | null>,
): string | null | undefined => {
  if (article === undefined) {
    return null;
  }
  return articleContents.get(article.id);
};

const useClusterArticleController = (clusterDetail: ClusterDetailResponse | undefined) => {
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const {
    articleContentRef,
    articleContents,
    loadArticleContent,
    loadingArticle,
    setArticleContents,
  } = useArticleContentState();
  const resolvedActiveArticleId =
    activeArticleId ?? clusterDetail?.articles?.[0]?.id.toString() ?? null;
  useEffect(() => {
    if (!hasText(resolvedActiveArticleId) || !clusterDetail) {
      return;
    }
    const article = (clusterDetail.articles ?? []).find(
      (item) => item.id.toString() === resolvedActiveArticleId,
    );
    if (article && !articleContents.has(article.id)) {
      globalThis.queueMicrotask(() => void loadArticleContent(article));
    }
  }, [articleContents, clusterDetail, loadArticleContent, resolvedActiveArticleId]);
  const activeArticle = (clusterDetail?.articles ?? []).find(
    (item) => item.id.toString() === resolvedActiveArticleId,
  );
  return {
    activeArticle,
    activeContent: getActiveArticleContent(activeArticle, articleContents),
    articleContentRef,
    articleContents,
    loadArticleContent,
    loadingArticle,
    resolvedActiveArticleId,
    setActiveArticleId,
    setArticleContents,
  };
};

export { useClusterArticleController };
