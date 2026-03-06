import type {
  AllCluster,
  BreakingCluster,
  NewsArticle,
  TrendingArticle,
  TrendingCluster,
} from "@/lib/api";

export function hasRealClusterImage(src?: string | null): boolean {
  if (!src) return false;
  const trimmed = src.trim();
  if (!trimmed || trimmed === "none") return false;
  const lower = trimmed.toLowerCase();
  return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg");
}

export function pickClusterImageUrl(cluster: {
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
}): string | null {
  const imageCandidates = [
    cluster.representative_article?.image_url,
    ...(cluster.articles ?? []).map((article) => article.image_url),
  ];

  return imageCandidates.find((src) => hasRealClusterImage(src)) ?? null;
}

export function filterTrendingClusters(
  trending: TrendingCluster[],
  breaking: BreakingCluster[],
): TrendingCluster[] {
  const breakingIds = new Set(breaking.map((cluster) => cluster.cluster_id));
  return trending.filter((cluster) => !breakingIds.has(cluster.cluster_id));
}

export function clusterArticlesToNewsArticles(
  articles?: TrendingArticle[],
): NewsArticle[] {
  if (!articles) return [];

  return articles.map((article) => ({
    id: article.id,
    title: article.title,
    source: article.source,
    sourceId: article.source.toLowerCase().replace(/\s+/g, "-"),
    country: "US",
    credibility: "medium",
    bias: "center",
    summary: article.summary || "",
    image: article.image_url || "",
    publishedAt: article.published_at || new Date().toISOString(),
    category: "news",
    url: article.url,
    tags: [],
    originalLanguage: "en",
    translated: false,
  }));
}

export function getClusterPreviewStats(cluster: {
  article_count: number;
  source_diversity: number;
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
}): { articleCount: number; sourceCount: number } {
  const previewArticles =
    cluster.articles && cluster.articles.length > 0
      ? cluster.articles
      : cluster.representative_article
        ? [cluster.representative_article]
        : [];

  const previewSources = new Set(
    previewArticles
      .map((article) => article.source)
      .filter((source): source is string => Boolean(source)),
  );

  return {
    articleCount: previewArticles.length || cluster.article_count,
    sourceCount: previewSources.size || cluster.source_diversity,
  };
}

export type TopicLikeCluster = AllCluster | TrendingCluster | BreakingCluster;
