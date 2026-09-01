import type {
  AllCluster,
  BreakingCluster,
  NewsArticle,
  TrendingArticle,
  TrendingCluster,
} from "@/lib/api";

export function hasRealClusterImage(src?: string | null): boolean {
  if (!src) {return false;}
  const trimmed = src.trim();
  if (!trimmed || trimmed === "none") {return false;}
  const lower = trimmed.toLowerCase();
  return !lower.includes("/placeholder.svg") && !lower.includes("/placeholder.jpg");
}

export function pickClusterImageUrl(cluster:Readonly< {
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
}>): string | null {
  const imageCandidates = [
    cluster.representative_article?.image_url,
    ...(cluster.articles ?? []).map((article) => article.image_url),
  ];

  return imageCandidates.find((src) => hasRealClusterImage(src)) ?? null;
}

export function filterTrendingClusters(
  trending:readonly  TrendingCluster[],
  breaking:readonly  BreakingCluster[],
): TrendingCluster[] {
  const breakingIds = new Set(breaking.map((cluster) => cluster.cluster_id));
  return trending.filter((cluster) => !breakingIds.has(cluster.cluster_id));
}

export function clusterArticlesToNewsArticles(
  articles?:readonly  TrendingArticle[],
): NewsArticle[] {
  if (!articles) {return [];}

  return articles.map((article) => ({
    bias: "center",
    category: "news",
    country: "US",
    credibility: "medium",
    id: article.id,
    image: article.image_url || "",
    originalLanguage: "en",
    publishedAt: article.published_at || new Date().toISOString(),
    source: article.source,
    sourceId: article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
    summary: article.summary || "",
    tags: [],
    title: article.title,
    translated: false,
    url: article.url,
  }));
}

export function getClusterPreviewStats(cluster:Readonly< {
  article_count: number;
  source_diversity: number;
  representative_article?: TrendingArticle | null;
  articles?: TrendingArticle[];
}>): { articleCount: number; sourceCount: number } {
  const previewArticles =
    cluster.articles && cluster.articles.length > 0
      ? cluster.articles
      : (cluster.representative_article
        ? [cluster.representative_article]
        : []),

   previewSources = new Set(
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
