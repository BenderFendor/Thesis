import type { ClusterArticle, TrendingCluster } from "@/lib/api";
import { isUsableImage } from "@/lib/article-image";

type ClusterImageArticle = Readonly<
  Pick<ClusterArticle, "id" | "image_url" | "source" | "title" | "url">
>;
type ClusterPreviewArticle = Readonly<Pick<ClusterArticle, "id" | "source">>;
interface ClusterPreviewStats {
  articleCount: number;
  sourceCount: number;
}
type ClusterIdRecord = Readonly<Pick<TrendingCluster, "cluster_id">>;

const pickClusterImageUrl = (
  cluster: Readonly<{
    representative_article?: ClusterImageArticle | null;
    articles?: readonly ClusterImageArticle[];
  }>,
): string | null => {
  const imageCandidates = [
    cluster.representative_article?.image_url,
    ...(cluster.articles ?? []).map((article) => article.image_url),
  ];

  return imageCandidates.find((src) => isUsableImage(src)) ?? null;
};

const filterTrendingClusters = <Cluster extends ClusterIdRecord>(
  trending: readonly Cluster[],
  breaking: readonly ClusterIdRecord[],
): Cluster[] => {
  const breakingIds = new Set(breaking.map((cluster) => cluster.cluster_id));
  return trending.filter((cluster) => !breakingIds.has(cluster.cluster_id));
};

const getClusterPreviewStats = (
  cluster: Readonly<{
    article_count: number;
    source_diversity: number;
    representative_article?: ClusterPreviewArticle | null;
    articles?: readonly ClusterPreviewArticle[];
  }>,
): ClusterPreviewStats => {
  const previewArticles =
    (() => {
  if (cluster.articles && cluster.articles.length > 0) {
    return cluster.articles;
  }
  return (() => {
    if (cluster.representative_article) {
      return [cluster.representative_article];
    }
    return [];
  })();
})();
  const previewSources = new Set(
    previewArticles
      .map((article) => article.source)
      .filter((source): source is string => Boolean(source)),
  );

  return {
    articleCount: getPreviewCount(previewArticles.length, cluster.article_count),
    sourceCount: getPreviewCount(previewSources.size, cluster.source_diversity),
  };
};

const getPreviewCount = (count: number, fallback: number): number => {
  if (count > 0) {
    return count;
  }
  return fallback;
};

export { filterTrendingClusters, getClusterPreviewStats, pickClusterImageUrl };
