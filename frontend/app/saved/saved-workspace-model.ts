import { z } from "zod";

import { API_BASE_URL } from "@/lib/api";
import type { NewsArticle } from "@/lib/api";

const STRUCTURED_ARTICLE_BLOCK = /```json:articles\n[\s\S]*?\n```/gu,
 UNCATEGORIZED_LABEL = "Uncategorized",

 QueueDigestResponseSchema = z
  .object({
    content: z.string().optional(),
    digest: z.string().optional(),
  })
  .passthrough();

export type SavedArticleKind = "bookmark" | "liked" | "both";

export interface SavedArticle extends NewsArticle {
  readonly type: SavedArticleKind;
}

interface QueueArticleSummary {
  readonly category: string;
  readonly source: string;
  readonly summary: string;
  readonly title: string;
  readonly url: string;
}

function normalizedCategory(category: string): string {
  const trimmedCategory = category.trim();
  if (trimmedCategory.length === 0) {
    return UNCATEGORIZED_LABEL;
  }
  return trimmedCategory;
}

function toQueueArticleSummary(article: Readonly<NewsArticle>): QueueArticleSummary {
  return {
    category: normalizedCategory(article.category),
    source: article.source,
    summary: article.summary,
    title: article.title,
    url: article.url,
  };
}

function groupArticleSummaries(
  summaries: readonly QueueArticleSummary[],
): Record<string, QueueArticleSummary[]> {
  const grouped: Record<string, QueueArticleSummary[]> = {};
  for (const summary of summaries) {
    const existing = grouped[summary.category];
    if (existing === undefined) {
      grouped[summary.category] = [summary];
      continue;
    }
    existing.push(summary);
  }
  return grouped;
}

export function hasRealImage(source?: string | null): boolean {
  if (source === undefined || source === null) {
    return false;
  }
  const normalized = source.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "none") {
    return false;
  }
  return (
    !normalized.includes("/placeholder.svg") &&
    !normalized.includes("/placeholder.jpg")
  );
}

export function mergeSavedArticles(
  bookmarks: readonly NewsArticle[],
  likedArticles: readonly NewsArticle[],
): readonly SavedArticle[] {
  const articlesByUrl = new Map<string, SavedArticle>();
  for (const article of bookmarks) {
    articlesByUrl.set(article.url, { ...article, type: "bookmark" });
  }
  for (const article of likedArticles) {
    const existing = articlesByUrl.get(article.url);
    if (existing === undefined) {
      articlesByUrl.set(article.url, { ...article, type: "liked" });
      continue;
    }
    articlesByUrl.set(article.url, { ...existing, type: "both" });
  }
  return [...articlesByUrl.values()];
}

export function stripStructuredArticleBlock(digest: string): string {
  return digest.replace(STRUCTURED_ARTICLE_BLOCK, "").trim();
}

export async function requestQueueDigest(
  articles: readonly NewsArticle[],
): Promise<string> {
  const summaries = articles.map(toQueueArticleSummary),
   response = await fetch(`${API_BASE_URL}/api/queue/digest`, {
    body: JSON.stringify({
      articles: summaries,
      grouped: groupArticleSummaries(summaries),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Queue digest failed with status ${response.status}`);
  }

  const payload: unknown = await response.json(),
   parsed = QueueDigestResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Queue digest returned an invalid payload");
  }
  const digest = parsed.data.digest ?? parsed.data.content ?? "";
  return stripStructuredArticleBlock(digest);
}
