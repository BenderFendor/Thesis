"use client";

import {
  createBookmark,
  createLikedArticle,
  deleteBookmark,
  deleteLikedArticle,
  fetchBookmarks,
  fetchLikedArticles,
} from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

type ArticleReactionKind = "bookmark" | "like";

type ReactionVariables = Readonly<{
  articleId: number;
  nextSelected: boolean;
}>;

type ReactionSet = Set<number>;
const EMPTY_REACTION_SET: ReactionSet = new Set();

const reactionQueryKey = (kind: ArticleReactionKind) => ["article-reactions", kind] as const;

const fetchReactionIds = async (kind: ArticleReactionKind): Promise<Set<number>> => {
  if (kind === "bookmark") {
    const response = await fetchBookmarks();
    return new Set(response.bookmarks.map((entry) => entry.article_id));
  }
  const response = await fetchLikedArticles();
  return new Set(response.liked.map((entry) => entry.article_id));
};

const persistBookmarkReaction = async ({
  articleId,
  nextSelected,
}: ReactionVariables): Promise<void> => {
  if (nextSelected) {
    if ((await createBookmark(articleId)) === null) {
      throw new Error("Failed to create bookmark");
    }
    return;
  }
  await deleteBookmark(articleId);
};

const persistLikeReaction = async ({
  articleId,
  nextSelected,
}: ReactionVariables): Promise<void> => {
  if (nextSelected) {
    if ((await createLikedArticle(articleId)) === null) {
      throw new Error("Failed to like article");
    }
    return;
  }
  await deleteLikedArticle(articleId);
};

const persistReaction = async (
  kind: ArticleReactionKind,
  variables: ReactionVariables,
): Promise<void> => {
  if (kind === "bookmark") {
    await persistBookmarkReaction(variables);
    return;
  }
  await persistLikeReaction(variables);
};

type ReactionMutation = (variables: ReactionVariables) => Promise<void>;

interface ReactionQuerySnapshot {
  readonly data: ReactionSet | undefined;
}

type ReactionRefetch = () => Promise<ReactionQuerySnapshot>;

const useReactionActions = (
  ids: ReadonlySet<number>,
  mutateAsync: ReactionMutation,
  refetch: ReactionRefetch,
) => {
  const isSelected = useCallback((articleId: number) => ids.has(articleId), [ids]);
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const toggle = useCallback(
    async (articleId: number): Promise<void> => {
      if (!articleId) {
        return;
      }
      await mutateAsync({
        articleId,
        nextSelected: !ids.has(articleId),
      });
    },
    [ids, mutateAsync],
  );

  return { isSelected, refresh, toggle };
};

export function useArticleReaction(kind: ArticleReactionKind) {
  const queryClient = useQueryClient();
  const queryKey = reactionQueryKey(kind);
  const { data, error, isFetched, isLoading, refetch } = useQuery<ReactionSet>({
    queryFn: () => fetchReactionIds(kind),
    queryKey,
    staleTime: 30 * 1000,
  });
  const { isPending, mutateAsync } = useMutation({
    mutationFn: (variables: ReactionVariables) => persistReaction(kind, variables),
    onError: (_error, _variables, previous) => {
      if (previous === undefined) {
        queryClient.removeQueries({ exact: true, queryKey });
      } else {
        queryClient.setQueryData(queryKey, previous);
      }
    },
    onMutate: async ({ articleId, nextSelected }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ReactionSet>(queryKey);
      const next = new Set(previous);
      if (nextSelected) {
        next.add(articleId);
      } else {
        next.delete(articleId);
      }
      queryClient.setQueryData(queryKey, next);
      return previous;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const ids = data ?? EMPTY_REACTION_SET;
  const { isSelected, refresh, toggle } = useReactionActions(ids, mutateAsync, refetch);

  return {
    error,
    ids,
    isLoaded: isFetched,
    isLoading: isLoading || isPending,
    isSelected,
    refresh,
    toggle,
  };
}

export type { ArticleReactionKind };
