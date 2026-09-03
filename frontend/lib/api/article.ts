// Article mapping: backend wire format -> frontend NewsArticle/NewsSource.
// The backend returns loose field aliases; these resolvers pick one canonical
// representation and keep nullability safe.

import { z } from "zod";

import type {
  ApiOpaqueObject,
  BackendArticleMapping,
  CountryNameMap,
  BackendSource,
  NewsArticle,
  NewsSource,
  ReadonlyBackendArticle,
} from "./types";

const COUNTRY_NAME_TO_CODE: CountryNameMap = {
  america: "US",
  argentina: "AR",
  australia: "AU",
  bangladesh: "BD",
  britain: "GB",
  canada: "CA",
  china: "CN",
  colombia: "CO",
  egypt: "EG",
  england: "GB",
  france: "FR",
  germany: "DE",
  greece: "GR",
  "hong kong": "HK",
  hongkong: "HK",
  india: "IN",
  indonesia: "ID",
  international: "International",
  israel: "IL",
  japan: "JP",
  kazakhstan: "KZ",
  kenya: "KE",
  mexico: "MX",
  myanmar: "MM",
  "new zealand": "NZ",
  newzealand: "NZ",
  nigeria: "NG",
  "north korea": "KP",
  pakistan: "PK",
  palestine: "PS",
  philippines: "PH",
  qatar: "QA",
  russia: "RU",
  singapore: "SG",
  "south africa": "ZA",
  "south korea": "KR",
  taiwan: "TW",
  thailand: "TH",
  turkey: "TR",
  ukraine: "UA",
  "united kingdom": "GB",
  "united states": "US",
  usa: "US",
  venezuela: "VE",
  vietnam: "VN",
}

const buildNewsArticle = (
  article: ReadonlyBackendArticle,
  mapping: Readonly<BackendArticleMapping>,
): NewsArticle => (
  {
    _parsedTimestamp: resolveParsedTimestamp(mapping.published),
    author: mapping.author,
    authors: mapping.authors,
    bias: mapping.bias,
    category: mapping.category,
    content: mapping.content,
    country: mapping.country,
    credibility: mapping.credibility,
    geo_signal: mapping.geoSignal,
    hasFullContent: hasArticleContent(article),
    id: mapping.resolvedId,
    image: mapping.image,
    isPersisted: mapping.isPersisted,
    mentioned_countries: mapping.mentionedCountries,
    originalLanguage: article.original_language ?? "en",
    publishedAt: mapping.published,
    source: mapping.sourceName,
    sourceId: mapping.normalizedSourceId,
    source_country: mapping.sourceCountry,
    summary: mapping.summary || "No description",
    tags: [mapping.category, mapping.sourceName],
    title: article.title ?? "No title",
    translated: article.translated ?? false,
    url: mapping.url,
  });

export const mapBackendArticle = (article: ReadonlyBackendArticle): NewsArticle =>
  buildNewsArticle(article, resolveBackendArticleMapping(article));

export const mapBackendArticles = (
  backendArticles: readonly ReadonlyBackendArticle[],
): NewsArticle[] => {
  console.debug(
    `[mapBackendArticles] Mapping ${backendArticles.length} articles from backend format to frontend format.`,
  );
  return backendArticles.map(mapBackendArticle);
}

export const mapBackendSource = (source: Readonly<BackendSource>): NewsSource => (
  {
    bias: mapBias(source.bias_rating),
    category: source.category ? [source.category] : ["general"],
    country: source.country,
    credibility: mapCredibilityScoreToLevel(
      source.credibility_score,
      source.factual_rating,
      source.bias_rating,
    ),
    credibilityScore: source.credibility_score ?? undefined,
    factualRating: source.factual_rating ?? undefined,
    funding: [source.funding_type || source.ownership_label || "Unknown"],
    id:
      source.id || source.slug || source.name.toLowerCase().replaceAll(/\s+/gu, "-"),
    isPaywalled: source.is_paywalled ?? false,
    language: "en",
    name: source.name,
    rssUrl: source.rssUrl || source.url,
    slug:
      source.slug ||
      source.id ||
      source.name.toLowerCase().replaceAll(/\s+/gu, "-"),
    sourceType: source.source_type,
    url: source.url,
  });

const mapBias = (biasRating?: string): "left" | "center" | "right" => {
  if (!biasRating) {return "center";}
  const rating = biasRating.toLowerCase();
  if (rating.includes("left")) {return "left";}
  if (rating.includes("right")) {return "right";}
  return "center";
}

const mapCredibility = (biasRating?: string): "high" | "medium" | "low" => {
  // Map bias ratings to credibility (this is a simplification)
  if (!biasRating) {return "medium";}
  if (biasRating.toLowerCase().includes("high")) {return "high";}
  if (biasRating.toLowerCase().includes("low")) {return "low";}
  return "medium";
}

const mapCredibilityScore = (score: number): "high" | "medium" | "low" => {
  if (score >= 0.75) {return "high";}
  if (score <= 0.4) {return "low";}
  return "medium";
}

const mapCredibilityScoreToLevel = (
  score?: number | null,
  factualRating?: string | null,
  biasRating?: string,
): "high" | "medium" | "low" => {
  if (typeof score === "number") {
    return mapCredibilityScore(score);
  }

  return mapFactualRating(factualRating) ?? mapCredibility(biasRating);
}

const mapFactualRating = (rating?: string | null): "high" | "low" | undefined => {
  const normalized = rating?.toLowerCase();
  if (normalized?.includes("high")) {return "high";}
  if (normalized?.includes("low") || normalized?.includes("mixed")) {
    return "low";
  }
  return undefined;
}

const normalizeCountryCode = (value?: string | null): string => {
  if (typeof value !== "string") {return "International";}
  const trimmed = value.trim();
  if (!trimmed) {return "International";}
  if (trimmed === "International") {return trimmed;}

  {
    const compactUpper = trimmed.toUpperCase(),
     normalizedName = trimmed
      .toLowerCase()
      .replaceAll(/[.]/gu, "")
      .replaceAll(/\s+/gu, " ")
      .trim(),
     noSpace = normalizedName.replaceAll(/\s+/gu, "");
    if (/^[A-Z]{2}$/u.test(compactUpper)) {
      return compactUpper;
    }
    return COUNTRY_NAME_TO_CODE[normalizedName] || COUNTRY_NAME_TO_CODE[noSpace] || compactUpper;
  }
}

const hashStringToInt = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const hasArticleContent = (article: ReadonlyBackendArticle): boolean =>
  article.content != null && article.content.trim().length > 0;

const resolveArticleAuthor = (article: ReadonlyBackendArticle): string | undefined => {
  if (typeof article.author === "string" && article.author.length > 0) {
    return article.author;
  }
  return article.authors?.[0];
}

const resolveArticleAuthors = (
  article: ReadonlyBackendArticle,
  author?: string,
): string[] => {
  if (Array.isArray(article.authors)) {
    return article.authors.filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  }
  return author ? [author] : [];
}

const resolveArticleBias = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): "left" | "center" | "right" => {
  const biasValue =
    typeof article.bias === "string" ? article.bias.toLowerCase() : undefined;
  if (biasValue && ["left", "center", "right"].includes(biasValue)) {
    return biasValue as "left" | "center" | "right";
  }
  return getBiasFromSource(sourceName);
}

const resolveArticleCategory = (article: ReadonlyBackendArticle): string => {
  if (typeof article.category === "string" && article.category.length > 0) {
    return article.category;
  }
  return "general";
}

const resolveArticleCountries = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): { country: string; sourceCountry: string; mentionedCountries: string[] } => {
  const rawCountry =
    typeof article.country === "string" ? article.country : undefined,
   fallbackCountry = rawCountry || getCountryFromSource(sourceName),
   country = normalizeCountryCode(fallbackCountry),
   sourceCountry = normalizeCountryCode(
    typeof article.source_country === "string"
      ? article.source_country
      : fallbackCountry,
  ),
   mentionedCountries = Array.isArray(article.mentioned_countries)
    ? article.mentioned_countries
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeCountryCode(value))
    : [];
  return { country, mentionedCountries, sourceCountry };
}

const resolveArticleCredibility = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): "high" | "medium" | "low" => {
  const credibilityValue =
    typeof article.credibility === "string"
      ? article.credibility.toLowerCase()
      : undefined;
  if (
    credibilityValue &&
    ["high", "medium", "low"].includes(credibilityValue)
  ) {
    return credibilityValue as "high" | "medium" | "low";
  }
  return getCredibilityFromSource(sourceName);
}

const resolveArticleId = (article: ReadonlyBackendArticle, stableKey: string): number => {
  if (typeof article.id === "number") {return article.id;}
  if (typeof article.article_id === "number") {return article.article_id;}
  return hashStringToInt(stableKey);
}

const resolveArticleImage = (article: ReadonlyBackendArticle): string => {
  const rawImage = article.image || article.image_url;
  return rawImage && rawImage !== "none" ? rawImage : "/placeholder.svg";
}

const resolveArticlePersistence = (article: ReadonlyBackendArticle): boolean => {
  const hasBackendId =
    typeof article.id === "number" || typeof article.article_id === "number";
  return hasBackendId && article.is_persisted !== false;
}

const resolveArticlePublished = (article: ReadonlyBackendArticle): string =>
  (
    article.published_at ||
    article.publishedAt ||
    article.published ||
    new Date().toISOString()
  );

const resolveArticleSourceId = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): string =>
  typeof article.source_id === "string" &&
    article.source_id.trim().length > 0
    ? article.source_id.trim().toLowerCase()
    : sourceName.toLowerCase().replaceAll(/\s+/gu, "-");

const resolveArticleSourceName = (article: ReadonlyBackendArticle): string => {
  if (typeof article.source === "string" && article.source.length > 0) {
    return article.source;
  }
  if (typeof article.source_name === "string" && article.source_name.length > 0) {
    return article.source_name;
  }
  return "Unknown";
}

const resolveArticleSummary = (article: ReadonlyBackendArticle): string => {
  if (typeof article.summary === "string" && article.summary.length > 0) {
    return article.summary;
  }
  return article.description ?? "";
}

const resolveArticleUrlKey = (
  article: ReadonlyBackendArticle,
  sourceName: string,
  published: string,
): { url: string; stableKey: string } => {
  const url =
    article.url ||
    article.link ||
    article.article_url ||
    article.original_url ||
    "",
   stableKey = url || `${sourceName}|${article.title || ""}|${published}`;
  return { stableKey, url };
}

const resolveBackendArticleMapping = (article: ReadonlyBackendArticle): BackendArticleMapping => {
  const sourceName = resolveArticleSourceName(article),
   published = resolveArticlePublished(article),
   { url, stableKey } = resolveArticleUrlKey(article, sourceName, published),
   author = resolveArticleAuthor(article),
   { country, sourceCountry, mentionedCountries } =
    resolveArticleCountries(article, sourceName);
  return {
    author,
    authors: resolveArticleAuthors(article, author),
    bias: resolveArticleBias(article, sourceName),
    category: resolveArticleCategory(article),
    content: article.content ?? undefined,
    country,
    credibility: resolveArticleCredibility(article, sourceName),
    geoSignal: resolveGeoSignal(article),
    image: resolveArticleImage(article),
    isPersisted: resolveArticlePersistence(article),
    mentionedCountries,
    normalizedSourceId: resolveArticleSourceId(article, sourceName),
    published,
    resolvedId: resolveArticleId(article, stableKey),
    sourceCountry,
    sourceName,
    stableKey,
    summary: resolveArticleSummary(article),
    url,
  };
}

const resolveGeoSignal = (
  article: ReadonlyBackendArticle,
): { id: string; label: string } | undefined => {
  const parsed = z.object({
    id: z.string(),
    label: z.string(),
  }).safeParse(article.geo_signal);
  return parsed.success ? parsed.data : undefined;
}

const resolveParsedTimestamp = (published: string): number => {
  const timestamp = new Date(published).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

const getCountryFromSource = (source: string): string => {
  const countryMap: Record<string, string> = {
    "Associated Press": "US",
    BBC: "GB",
    CNN: "US",
    "Fox News": "US",
    NPR: "US",
    Reuters: "GB",
  };
  return countryMap[source] || "US";
}

const getBiasFromSource = (source: string): "left" | "center" | "right" => {
  const biasMap: Record<string, "left" | "center" | "right"> = {
    "Associated Press": "center",
    BBC: "center",
    CNN: "left",
    "Fox News": "right",
    NPR: "left",
    Reuters: "center",
  };
  return biasMap[source] || "center";
}

const getCredibilityFromSource = (source: string): "high" | "medium" | "low" => {
  const credibilityMap: Record<string, "high" | "medium" | "low"> = {
    "Associated Press": "high",
    BBC: "high",
    CNN: "medium",
    "Fox News": "medium",
    NPR: "high",
    Reuters: "high",
  };
  return credibilityMap[source] || "medium";
}
