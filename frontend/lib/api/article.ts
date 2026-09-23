// Article mapping: backend wire format -> frontend NewsArticle/NewsSource.
// Canonical news responses use snake_case fields; legacy cache and stream
// payloads still pass through the same null-safe boundary mapper.

import type {
  BackendArticleMapping,
  BackendSource,
  NewsArticle,
  NewsSource,
  ReadonlyBackendArticle,
} from "./types";
import {
  DEFAULT_ARTICLE_IMAGE,
  resolveArticleImage as resolveSharedArticleImage,
} from "../article-image";

import { z } from "zod";

const COUNTRY_NAME_TO_CODE = new Map<string, string>(
  Object.entries({
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
  }),
);
const COUNTRY_FROM_SOURCE = new Map<string, string>(
  Object.entries({
    "Associated Press": "US",
    BBC: "GB",
    CNN: "US",
    "Fox News": "US",
    NPR: "US",
    Reuters: "GB",
  }),
);
const BIAS_FROM_SOURCE = new Map<string, "left" | "center" | "right">(
  Object.entries({
    "Associated Press": "center",
    BBC: "center",
    CNN: "left",
    "Fox News": "right",
    NPR: "left",
    Reuters: "center",
  }),
);
const CREDIBILITY_FROM_SOURCE = new Map<string, "high" | "medium" | "low">(
  Object.entries({
    "Associated Press": "high",
    BBC: "high",
    CNN: "medium",
    "Fox News": "medium",
    NPR: "high",
    Reuters: "high",
  }),
);

const firstNonEmpty = (
  values: readonly (string | null | undefined)[],
  fallback: string,
): string => {
  for (const value of values) {
    if (value !== undefined && value !== null && value.length > 0) {
      return value;
    }
  }
  return fallback;
};

const buildNewsArticle = (
  article: ReadonlyBackendArticle,
  mapping: BackendArticleMapping,
): NewsArticle => ({
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
  summary: mapping.summary ?? "No description",
  tags: [mapping.category, mapping.sourceName],
  title: article.title ?? "No title",
  translated: article.translated ?? false,
  url: mapping.url,
});

const mapBackendArticle = (article: ReadonlyBackendArticle): NewsArticle =>
  buildNewsArticle(article, resolveBackendArticleMapping(article));

const mapBackendArticles = (backendArticles: readonly ReadonlyBackendArticle[]): NewsArticle[] =>
  backendArticles.map((article) => mapBackendArticle(article));

const sourceNameSlug = (name: string): string => name.toLowerCase().replaceAll(/\s+/gu, "-");

const resolveSourceId = (source: Readonly<BackendSource>): string =>
  firstNonEmpty([source.id, source.slug], sourceNameSlug(source.name));

const sourceSlug = (source: Readonly<BackendSource>): string =>
  firstNonEmpty([source.slug, source.id], sourceNameSlug(source.name));

const mapBackendSource = (source: Readonly<BackendSource>): NewsSource => ({
  bias: mapBias(source.bias_rating),
  category: [firstNonEmpty([source.category], "general")],
  country: source.country,
  credibility: mapCredibilityScoreToLevel(
    source.credibility_score,
    source.factual_rating,
    source.bias_rating,
  ),
  credibilityScore: source.credibility_score ?? undefined,
  factualRating: source.factual_rating ?? undefined,
  funding: [firstNonEmpty([source.funding_type, source.ownership_label], "Unknown")],
  id: resolveSourceId(source),
  isPaywalled: source.is_paywalled ?? false,
  language: "en",
  name: source.name,
  rssUrl: firstNonEmpty([source.rssUrl], source.url),
  slug: sourceSlug(source),
  sourceType: source.source_type,
  url: source.url,
});

const mapBias = (biasRating?: string): "left" | "center" | "right" => {
  if (biasRating === undefined || biasRating.length === 0) {
    return "center";
  }
  const rating = biasRating.toLowerCase();
  if (rating.includes("left")) {
    return "left";
  }
  if (rating.includes("right")) {
    return "right";
  }
  return "center";
};

const mapCredibility = (biasRating?: string): "high" | "medium" | "low" => {
  // Map bias ratings to credibility (this is a simplification)
  if (biasRating === undefined || biasRating.length === 0) {
    return "medium";
  }
  if (biasRating.toLowerCase().includes("high")) {
    return "high";
  }
  if (biasRating.toLowerCase().includes("low")) {
    return "low";
  }
  return "medium";
};

const mapCredibilityScore = (score: number): "high" | "medium" | "low" => {
  if (score >= 0.75) {
    return "high";
  }
  if (score <= 0.4) {
    return "low";
  }
  return "medium";
};

const mapCredibilityScoreToLevel = (
  score?: number | null,
  factualRating?: string | null,
  biasRating?: string,
): "high" | "medium" | "low" => {
  if (score !== undefined && score !== null) {
    return mapCredibilityScore(score);
  }

  return mapFactualRating(factualRating) ?? mapCredibility(biasRating);
};

const mapFactualRating = (rating?: string | null): "high" | "low" | undefined => {
  const normalized = rating?.toLowerCase();
  if (normalized === undefined) {
    return void 0;
  }
  if (normalized.includes("high")) {
    return "high";
  }
  if (normalized.includes("low") || normalized.includes("mixed")) {
    return "low";
  }
  return void 0;
};

const normalizeCountryName = (value: string): string =>
  value.toLowerCase().replaceAll(/[.]/gu, "").replaceAll(/\s+/gu, " ").trim();

const lookupCountryCode = (value: string): string | undefined => {
  const normalizedName = normalizeCountryName(value);
  const noSpace = normalizedName.replaceAll(/\s+/gu, "");
  return COUNTRY_NAME_TO_CODE.get(normalizedName) ?? COUNTRY_NAME_TO_CODE.get(noSpace);
};

const resolveCountryCode = (trimmed: string): string => {
  const compactUpper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/u.test(compactUpper)) {
    return compactUpper;
  }
  const countryCode = lookupCountryCode(trimmed);
  // SAFETY: unknown country names fall back to the compact uppercase code.
  return countryCode ?? compactUpper;
};

const normalizeCountryCode = (value?: string | null): string => {
  if (value === undefined || value === null) {
    return "International";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "International";
  }
  if (trimmed === "International") {
    return trimmed;
  }

  return resolveCountryCode(trimmed);
};

const hashStringToInt = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    hash = Math.trunc(Math.imul(hash, 31) + codePoint);
  }
  return Math.abs(hash);
};

const hasArticleContent = (article: ReadonlyBackendArticle): boolean =>
  article.content !== undefined && article.content !== null && article.content.trim().length > 0;

const resolveArticleAuthor = (article: ReadonlyBackendArticle): string | undefined => {
  const author = article.author ?? "";
  if (author.length > 0) {
    return author;
  }
  return article.authors?.[0];
};

const resolveArticleAuthors = (article: ReadonlyBackendArticle, author?: string): string[] => {
  if (Array.isArray(article.authors)) {
    return article.authors.filter(
      (value): value is string => String(value ?? "").trim().length > 0,
    );
  }
  if (author !== undefined && author.length > 0) {
    return [author];
  }
  return [];
};

const isBiasValue = (value: string): value is "left" | "center" | "right" =>
  ["left", "center", "right"].includes(value);

const resolveArticleBias = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): "left" | "center" | "right" => {
  const biasValue = article.bias?.toLowerCase();
  if (biasValue !== undefined && isBiasValue(biasValue)) {
    return biasValue;
  }
  return getBiasFromSource(sourceName);
};

const resolveArticleCategory = (article: ReadonlyBackendArticle): string => {
  const category = article.category ?? "";
  if (category.length > 0) {
    return category;
  }
  return "general";
};

const resolveMentionedCountries = (countries: readonly string[] | null | undefined): string[] => {
  if (countries === undefined || countries === null) {
    return [];
  }
  return countries.map((value) => normalizeCountryCode(value));
};

const resolveArticleCountries = (article: ReadonlyBackendArticle, sourceName: string) => {
  const fallbackCountry = firstNonEmpty([article.country], getCountryFromSource(sourceName));
  const country = normalizeCountryCode(fallbackCountry);
  const sourceCountry = normalizeCountryCode(article.source_country ?? fallbackCountry);
  const mentionedCountries = resolveMentionedCountries(article.mentioned_countries);
  return { country, mentionedCountries, sourceCountry };
};

const isCredibilityValue = (value: string): value is "high" | "medium" | "low" =>
  ["high", "medium", "low"].includes(value);

const resolveArticleCredibility = (
  article: ReadonlyBackendArticle,
  sourceName: string,
): "high" | "medium" | "low" => {
  const credibilityValue = article.credibility?.toLowerCase();
  if (credibilityValue !== undefined && isCredibilityValue(credibilityValue)) {
    return credibilityValue;
  }
  return getCredibilityFromSource(sourceName);
};

const resolveArticleId = (article: ReadonlyBackendArticle, stableKey: string): number => {
  if (article.id !== undefined && article.id !== null) {
    return article.id;
  }
  if (article.article_id !== undefined && article.article_id !== null) {
    return article.article_id;
  }
  return hashStringToInt(stableKey);
};

const resolveArticleImage = (article: ReadonlyBackendArticle): string =>
  resolveSharedArticleImage(article, DEFAULT_ARTICLE_IMAGE);

const resolveArticlePersistence = (article: ReadonlyBackendArticle): boolean => {
  const hasBackendId =
    (article.id !== undefined && article.id !== null) ||
    (article.article_id !== undefined && article.article_id !== null);
  return hasBackendId && article.is_persisted !== false;
};

const resolveArticlePublished = (article: ReadonlyBackendArticle): string =>
  firstNonEmpty(
    [article.published_at, article.publishedAt, article.published],
    new Date().toISOString(),
  );

const resolveArticleSourceId = (article: ReadonlyBackendArticle, sourceName: string): string => {
  const sourceId = article.source_id?.trim().toLowerCase() ?? "";
  if (sourceId.length > 0) {
    return sourceId;
  }
  return sourceNameSlug(sourceName);
};

const resolveArticleSourceName = (article: ReadonlyBackendArticle): string => {
  const source = article.source ?? "";
  if (source.length > 0) {
    return source;
  }
  const sourceName = article.source_name ?? "";
  if (sourceName.length > 0) {
    return sourceName;
  }
  return "Unknown";
};

const resolveArticleSummary = (article: ReadonlyBackendArticle): string => {
  const summary = article.summary ?? "";
  if (summary.length > 0) {
    return summary;
  }
  return article.description ?? "";
};

const resolveArticleUrlKey = (
  article: ReadonlyBackendArticle,
  sourceName: string,
  published: string,
) => {
  const url = firstNonEmpty(
    [article.url, article.link, article.article_url, article.original_url],
    "",
  );
  let stableKey = url;
  if (stableKey.length === 0) {
    stableKey = `${sourceName}|${article.title ?? ""}|${published}`;
  }
  return { stableKey, url };
};

const resolveBackendArticleMapping = (article: ReadonlyBackendArticle): BackendArticleMapping => {
  const sourceName = resolveArticleSourceName(article);
  const published = resolveArticlePublished(article);
  const { url, stableKey } = resolveArticleUrlKey(article, sourceName, published);
  const author = resolveArticleAuthor(article);
  const countries = resolveArticleCountries(article, sourceName);
  return {
    author,
    authors: resolveArticleAuthors(article, author),
    bias: resolveArticleBias(article, sourceName),
    category: resolveArticleCategory(article),
    content: article.content ?? undefined,
    ...countries,
    credibility: resolveArticleCredibility(article, sourceName),
    geoSignal: resolveGeoSignal(article),
    image: resolveArticleImage(article),
    isPersisted: resolveArticlePersistence(article),
    normalizedSourceId: resolveArticleSourceId(article, sourceName),
    published,
    resolvedId: resolveArticleId(article, stableKey),
    sourceName,
    stableKey,
    summary: resolveArticleSummary(article),
    url,
  };
};

const resolveGeoSignal = (
  article: ReadonlyBackendArticle,
): { id: string; label: string } | undefined => {
  const parsed = z
    .object({
      id: z.string(),
      label: z.string(),
    })
    .safeParse(article.geo_signal);
  if (parsed.success) {
    return parsed.data;
  }
  return void 0;
};

const resolveParsedTimestamp = (published: string): number => {
  const timestamp = new Date(published).getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
};

const getCountryFromSource = (source: string): string => COUNTRY_FROM_SOURCE.get(source) ?? "US";

const getBiasFromSource = (source: string): "left" | "center" | "right" =>
  BIAS_FROM_SOURCE.get(source) ?? "center";

const getCredibilityFromSource = (source: string): "high" | "medium" | "low" =>
  CREDIBILITY_FROM_SOURCE.get(source) ?? "medium";

export { mapBackendArticle, mapBackendArticles, mapBackendSource };
