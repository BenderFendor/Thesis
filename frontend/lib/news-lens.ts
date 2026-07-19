import type { NewsArticle, NewsSource } from "@/lib/api";

export type NewsLensId =
  | "all"
  | "wire"
  | "primary"
  | "local"
  | "international"
  | "opinion-off"
  | "high-factual"
  | "low-paywall";

export interface NewsLensPreset {
  id: NewsLensId;
  label: string;
  description: string;
}

export const NEWS_LENSES: NewsLensPreset[] = [
  {
    id: "all",
    label: "All Sources",
    description: "No lens filter.",
  },
  {
    id: "wire",
    label: "Wire Only",
    description: "AP, Reuters, AFP, and source-type wire feeds.",
  },
  {
    id: "primary",
    label: "Primary Sources",
    description: "Government, academic, official, and direct evidence sources.",
  },
  {
    id: "local",
    label: "Local First",
    description: "Local and regional coverage before national commentary.",
  },
  {
    id: "international",
    label: "International",
    description: "Non-US sources and globally focused feeds.",
  },
  {
    id: "opinion-off",
    label: "Opinion Off",
    description: "Hide opinion/editorial categories where metadata says so.",
  },
  {
    id: "high-factual",
    label: "High Factual",
    description: "Sources marked high factual or high credibility.",
  },
  {
    id: "low-paywall",
    label: "Low Paywall",
    description: "Exclude sources flagged as paywalled.",
  },
];

const WIRE_SOURCE_NAMES = new Set(["reuters", "associated press", "ap", "afp"]);
const PRIMARY_TYPES = new Set(["government", "academic", "primary", "official"]);
const LOCAL_TYPES = new Set(["local", "regional"]);

function normalize(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function sourceMatchesLens(source: NewsSource, lensId: NewsLensId): boolean {
  if (lensId === "all") return true;

  const name = normalize(source.name);
  const sourceType = normalize(source.sourceType);
  const category = source.category.map(normalize);
  const country = normalize(source.country);
  const factual = normalize(source.factualRating);

  if (lensId === "wire") {
    return sourceType === "wire" || WIRE_SOURCE_NAMES.has(name);
  }
  if (lensId === "primary") {
    return PRIMARY_TYPES.has(sourceType) || category.some((item) => PRIMARY_TYPES.has(item));
  }
  if (lensId === "local") {
    return LOCAL_TYPES.has(sourceType) || category.some((item) => LOCAL_TYPES.has(item));
  }
  if (lensId === "international") {
    return country !== "" && country !== "us" && country !== "united states";
  }
  if (lensId === "opinion-off") {
    return sourceType !== "opinion" && !category.some((item) => item.includes("opinion"));
  }
  if (lensId === "high-factual") {
    return source.credibility === "high" || factual.includes("high");
  }
  if (lensId === "low-paywall") {
    return !source.isPaywalled;
  }

  return true;
}

export function getLensSourceIds(sources: NewsSource[], lensId: NewsLensId): Set<string> {
  return new Set(
    sources
      .filter((source) => sourceMatchesLens(source, lensId))
      .flatMap((source) => [source.id, source.slug]),
  );
}

export function getLensStats(sources: NewsSource[], lensId: NewsLensId) {
  const includedIds = getLensSourceIds(sources, lensId);
  const included = sources.filter(
    (source) => includedIds.has(source.id) || includedIds.has(source.slug),
  ).length;
  return {
    included,
    excluded: Math.max(0, sources.length - included),
  };
}

export function filterArticlesByLens(
  articles: NewsArticle[],
  sources: NewsSource[],
  lensId: NewsLensId,
): NewsArticle[] {
  if (lensId === "all") return articles;
  const includedIds = getLensSourceIds(sources, lensId);
  const sourcesByName = new Map(sources.map((source) => [normalize(source.name), source]));

  return articles.filter((article) => {
    const sourceId = article.sourceId || "";
    if (includedIds.has(sourceId)) return true;
    const source = sourcesByName.get(normalize(article.source));
    return source ? includedIds.has(source.id) || includedIds.has(source.slug) : false;
  });
}
