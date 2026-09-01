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
    description: "No lens filter.",
    id: "all",
    label: "All Sources",
  },
  {
    description: "AP, Reuters, AFP, and source-type wire feeds.",
    id: "wire",
    label: "Wire Only",
  },
  {
    description: "Government, academic, official, and direct evidence sources.",
    id: "primary",
    label: "Primary Sources",
  },
  {
    description: "Local and regional coverage before national commentary.",
    id: "local",
    label: "Local First",
  },
  {
    description: "Non-US sources and globally focused feeds.",
    id: "international",
    label: "International",
  },
  {
    description: "Hide opinion/editorial categories where metadata says so.",
    id: "opinion-off",
    label: "Opinion Off",
  },
  {
    description: "Sources marked high factual or high credibility.",
    id: "high-factual",
    label: "High Factual",
  },
  {
    description: "Exclude sources flagged as paywalled.",
    id: "low-paywall",
    label: "Low Paywall",
  },
];

const WIRE_SOURCE_NAMES = new Set(["reuters", "associated press", "ap", "afp"]),
 PRIMARY_TYPES = new Set(["government", "academic", "primary", "official"]),
 LOCAL_TYPES = new Set(["local", "regional"]);

function normalize(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

type FilterLensId = Exclude<NewsLensId, "all">;

const lensMatchers: Record<FilterLensId, (source: NewsSource) => boolean> = {
  "high-factual": (source) => {
    const factual = normalize(source.factualRating);
    return source.credibility === "high" || factual.includes("high");
  },
  international: (source) => {
    const country = normalize(source.country);
    return country !== "" && country !== "us" && country !== "united states";
  },
  local: (source) => {
    const sourceType = normalize(source.sourceType),
     category = source.category.map(normalize);
    return LOCAL_TYPES.has(sourceType) || category.some((item) => LOCAL_TYPES.has(item));
  },
  "low-paywall": (source) => !source.isPaywalled,
  "opinion-off": (source) => {
    const sourceType = normalize(source.sourceType),
     category = source.category.map(normalize);
    return sourceType !== "opinion" && !category.some((item) => item.includes("opinion"));
  },
  primary: (source) => {
    const sourceType = normalize(source.sourceType),
     category = source.category.map(normalize);
    return PRIMARY_TYPES.has(sourceType) || category.some((item) => PRIMARY_TYPES.has(item));
  },
  wire: (source) => {
    const name = normalize(source.name);
    return normalize(source.sourceType) === "wire" || WIRE_SOURCE_NAMES.has(name);
  },
};

function sourceMatchesLens(source: NewsSource, lensId: NewsLensId): boolean {
  if (lensId === "all") {
    return true;
  }
  return lensMatchers[lensId](source);
}

export function getLensSourceIds(sources:readonly  NewsSource[], lensId: NewsLensId): Set<string> {
  return new Set(
    sources
      .filter((source) => sourceMatchesLens(source, lensId))
      .flatMap((source) => [source.id, source.slug]),
  );
}

export function getLensStats(sources:readonly  NewsSource[], lensId: NewsLensId) {
  const includedIds = getLensSourceIds(sources, lensId),
   included = sources.filter(
    (source) => includedIds.has(source.id) || includedIds.has(source.slug),
  ).length;
  return {
    excluded: Math.max(0, sources.length - included),
    included,
  };
}

export function filterArticlesByLens(
  articles:readonly  NewsArticle[],
  sources:readonly  NewsSource[],
  lensId: NewsLensId,
): NewsArticle[] {
  if (lensId === "all") {return [...articles];}
  const includedIds = getLensSourceIds(sources, lensId),
   sourcesByName = new Map(sources.map((source) => [normalize(source.name), source]));

  return articles.filter((article) => {
    const sourceId = article.sourceId || "";
    if (includedIds.has(sourceId)) {return true;}
    const source = sourcesByName.get(normalize(article.source));
    return source ? includedIds.has(source.id) || includedIds.has(source.slug) : false;
  });
}
