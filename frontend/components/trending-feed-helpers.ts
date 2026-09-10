import { hasText } from "@/lib/utils";
import { mapBackendArticle } from "@/lib/api";
import type { BreakingCluster, ClusterArticle, NewsArticle, TrendingCluster } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";

type ReadonlyBreakingCluster = DeepReadonly<BreakingCluster>;
type ReadonlyClusterArticle = DeepReadonly<ClusterArticle>;
type ReadonlyTrendingCluster = DeepReadonly<TrendingCluster>;
type MousePropagationEvent = Readonly<{ stopPropagation: () => void }>;
type TrendingWindow = "1d" | "1w" | "1m";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "way",
  "who",
  "did",
  "get",
  "let",
  "put",
  "say",
  "she",
  "too",
  "use",
  "says",
  "said",
  "over",
  "after",
  "into",
  "with",
  "from",
  "that",
  "this",
  "been",
  "have",
  "were",
  "what",
  "when",
  "will",
  "more",
  "some",
  "than",
  "them",
  "then",
  "they",
  "would",
  "about",
  "could",
  "first",
  "other",
  "their",
  "there",
  "these",
  "which",
  "being",
  "member",
  "founding",
  "guitarist",
  "dies",
  "aged",
  "dead",
  "death",
  "years",
  "year",
  "cofounder",
  "founder",
]);

const formatTimeAgo = (dateString?: string | null): string => {
  if (!hasText(dateString)) {
    return "";
  }
  const date = new Date(dateString);
  const now = new Date();
  const differenceHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (differenceHours < 1) {
    return "Now";
  }
  if (differenceHours < 24) {
    return `${differenceHours}H`;
  }
  return `${Math.floor(differenceHours / 24)}d`;
};

const extractKeyTerms = (title?: string): Set<string> => {
  if (!hasText(title)) {
    return new Set();
  }
  const words = title
    .toLowerCase()
    .replaceAll(/[^\w\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  return new Set(words);
};

const countSetOverlap = (firstTerms: Set<string>, secondTerms: Set<string>): number => {
  let overlap = 0;
  for (const word of firstTerms) {
    if (secondTerms.has(word)) {
      overlap++;
    }
  }
  return overlap;
};

interface DeduplicableCluster {
  readonly representative_article?: { readonly title?: string } | null;
  readonly label?: string | null;
  readonly keywords?: readonly string[];
}

const getClusterTerms = (cluster: DeduplicableCluster): Set<string> => {
  const title = cluster.representative_article?.title ?? "";
  const label = cluster.label ?? "";
  const keywords = (cluster.keywords ?? []).join(" ");
  return extractKeyTerms(`${title} ${label} ${keywords}`);
};

const hasSimilarTerms = (terms: Set<string>, seenTerms: readonly Set<string>[]): boolean => {
  for (const existingTerms of seenTerms) {
    const overlap = countSetOverlap(terms, existingTerms);
    const overlapRatio = overlap / Math.min(terms.size, existingTerms.size);
    if (overlap >= 2 && overlapRatio >= 0.4) {
      return true;
    }
  }
  return false;
};

const deduplicateClusters = function deduplicateClusters<Cluster extends DeduplicableCluster>(
  clusters: readonly Cluster[],
): Cluster[] {
  const seenTerms: Set<string>[] = [];
  return clusters.filter((cluster) => {
    const terms = getClusterTerms(cluster);
    if (terms.size === 0) {
      return true;
    }
    if (hasSimilarTerms(terms, seenTerms)) {
      return false;
    }
    seenTerms.push(terms);
    return true;
  });
};

const trendingArticleToNewsArticle = (
  article: ReadonlyClusterArticle,
  clusterLabel?: string,
): NewsArticle =>
  mapBackendArticle({
    category: "trending",
    country: "US",
    credibility: "medium",
    id: article.id,
    image_url: article.image_url,
    published_at: article.published_at,
    source: article.source,
    summary: article.summary ?? clusterLabel ?? "",
    title: article.title,
    url: article.url,
  });

export type {
  MousePropagationEvent,
  ReadonlyBreakingCluster,
  ReadonlyClusterArticle,
  ReadonlyTrendingCluster,
  TrendingWindow,
};
export { deduplicateClusters, formatTimeAgo, trendingArticleToNewsArticle };
