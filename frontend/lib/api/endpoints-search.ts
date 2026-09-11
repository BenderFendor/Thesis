import { api, query, API_BASE_URL } from "./client";
import { fetchWithUnavailableMessage, UNAVAILABLE } from "./endpoints-core";
import { mapBackendArticle } from "./article";
import type {
  ArticleTopic,
  BlindspotCard,
  BlindspotLane,
  BlindspotLens,
  BlindspotSummary,
  CountryGeoData,
  NoveltyScoreResponse,
  ReadonlyBackendArticle,
  RelatedArticlesResponse,
  SearchSuggestionsResponse,
  SemanticSearchResponse,
  SourceCoverageResponse,
} from "./types";
import {
  ArticleTopicsResponseSchema,
  BlindspotViewerResponseSchema,
  BulkArticleTopicsResponseSchema,
  CountryGeoDataSchema,
  NoveltyScoreResponseSchema,
  RelatedArticlesResponseSchema,
  SearchSuggestionsResponseSchema,
  SourceCoverageResponseSchema,
} from "./response-schemas";
import { SemanticSearchResponseSchema } from "./schemas";

interface ParsedSemanticSearchResult {
  readonly article: ReadonlyBackendArticle;
  readonly distance?: number | null;
  readonly similarity_score?: number | null;
}

const mapSemanticSearchResults = (
  results: readonly Readonly<ParsedSemanticSearchResult>[],
): SemanticSearchResponse["results"] =>
  results.map(({ article, distance, similarity_score }) => ({
    article: mapBackendArticle(article),
    distance,
    similarityScore: similarity_score,
  }));

const assertSemanticSearchResponse = (response: Response): void => {
  if (response.ok) {
    return;
  }
  if (response.status === UNAVAILABLE) {
    throw new Error("Semantic search is currently unavailable.");
  }
  throw new Error(`Semantic search failed (${response.status})`);
};

const semanticSearch = async (
  queryText: string,
  options: Readonly<{ limit?: number; category?: string }> = {},
): Promise<SemanticSearchResponse> => {
  const url = `/api/search/semantic${query({
    category: options.category,
    limit: options.limit,
    query: queryText,
  })}`;
  const response = await fetch(`${API_BASE_URL}${url}`);
  assertSemanticSearchResponse(response);
  const payload: unknown = await response.json();
  const parsed = SemanticSearchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Semantic search response is invalid.");
  }
  return {
    query: parsed.data.query,
    results: mapSemanticSearchResults(parsed.data.results),
    total: parsed.data.total,
  };
};

const fetchSearchSuggestions = (queryText: string, limit = 5): Promise<SearchSuggestionsResponse> =>
  fetchWithUnavailableMessage(
    `/api/similarity/search-suggestions${query({ limit, query: queryText })}`,
    SearchSuggestionsResponseSchema,
    "Search suggestions unavailable",
  );

// --- Similarity / topics ---

const fetchRelatedArticles = (
  articleId: number,
  limit = 5,
  excludeSameSource = true,
): Promise<RelatedArticlesResponse> =>
  api(
    `/api/similarity/related${query({
      article_id: articleId,
      exclude_same_source: excludeSameSource,
      limit,
    })}`,
    RelatedArticlesResponseSchema,
  );

const fetchSourceCoverage = (
  sourceIds: readonly string[],
  sampleSize = 100,
): Promise<SourceCoverageResponse> =>
  fetchWithUnavailableMessage(
    `/api/similarity/source-coverage${query({
      sample_size: sampleSize,
      source_ids: sourceIds.join(","),
    })}`,
    SourceCoverageResponseSchema,
    "Source coverage unavailable",
  );

const fetchNoveltyScore = (
  articleId: number,
  readingHistory: readonly number[],
): Promise<NoveltyScoreResponse> =>
  api("/api/similarity/novelty-score", NoveltyScoreResponseSchema, {
    body: JSON.stringify({ article_id: articleId, reading_history: readingHistory }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const fetchArticleTopics = (
  articleId: number,
): Promise<{ article_id: number; topics: ArticleTopic[] }> =>
  fetchWithUnavailableMessage(
    `/api/similarity/article-topics/${articleId}`,
    ArticleTopicsResponseSchema,
    "Topic lookup unavailable",
  );

const fetchBulkArticleTopics = async (
  articleIds: readonly number[],
): Promise<{ articles: Record<number, ArticleTopic[]> }> =>
  api("/api/similarity/bulk-article-topics", BulkArticleTopicsResponseSchema, {
    body: JSON.stringify(articleIds),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

// --- Geography ---

const fetchCountryGeoData = (): Promise<CountryGeoData> =>
  api("/news/countries/geo", CountryGeoDataSchema);

// --- Blindspot ---

const fetchBlindspotViewer = (
  params: Readonly<{
    lens?: BlindspotLens["id"];
    window?: "1d" | "1w" | "1m";
    category?: string;
    sources?: string | null;
    perLane?: number;
  }> = {},
): Promise<{
  available_lenses: BlindspotLens[];
  selected_lens: BlindspotLens;
  summary: BlindspotSummary;
  lanes: BlindspotLane[];
  cards: BlindspotCard[];
  status: string;
}> =>
  api(
    `/blindspots/viewer${query({
      category: params.category,
      lens: params.lens,
      per_lane: params.perLane,
      sources: params.sources,
      window: params.window,
    })}`,
    BlindspotViewerResponseSchema,
  );

// --- Analysis / research ---

export {
  semanticSearch,
  fetchSearchSuggestions,
  fetchRelatedArticles,
  fetchSourceCoverage,
  fetchNoveltyScore,
  fetchArticleTopics,
  fetchBulkArticleTopics,
  fetchCountryGeoData,
  fetchBlindspotViewer,
};
