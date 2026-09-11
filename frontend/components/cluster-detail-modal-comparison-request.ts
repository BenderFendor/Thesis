import { API_BASE_URL } from "@/lib/api";
import type {
  ArticleContentLoader,
  ComparisonArticle,
  ComparisonData,
} from "./cluster-detail-modal-types";
import { z } from "zod";

interface ComparisonRequestResult {
  readonly contentEntries: readonly (readonly [number, string | null])[];
  readonly data: ComparisonData;
}

const getComparisonPair = (
  articles: readonly ComparisonArticle[],
): readonly [ComparisonArticle, ComparisonArticle] | null => {
  const [sourceOne, sourceTwo] = articles;
  if (sourceOne === undefined || sourceTwo === undefined) {
    return null;
  }
  return [sourceOne, sourceTwo];
};

const loadComparisonContent = async (
  article: { readonly id: number; readonly url: string },
  articleContents: ReadonlyMap<number, string | null>,
  loadArticleContent: ArticleContentLoader,
): Promise<readonly [number, string | null]> => {
  const cachedContent = articleContents.get(article.id);
  if (cachedContent !== undefined) {
    return [article.id, cachedContent];
  }

  try {
    return [article.id, await loadArticleContent(article)];
  } catch (error: unknown) {
    console.error("Failed to extract comparison article:", error);
    return [article.id, null];
  }
};

const getComparisonContent = (
  comparisonPair: readonly [ComparisonArticle, ComparisonArticle],
  contentById: ReadonlyMap<number, string | null>,
): readonly [string, string] => {
  const [sourceOne, sourceTwo] = comparisonPair;
  const contentOne = contentById.get(sourceOne.id) ?? "";
  const contentTwo = contentById.get(sourceTwo.id) ?? "";
  if (contentOne === "" || contentTwo === "") {
    throw new Error("Compare Sources needs full text from two articles.");
  }
  return [contentOne, contentTwo];
};

const loadComparisonEntries = async (
  comparisonArticles: readonly ComparisonArticle[],
  articleContents: ReadonlyMap<number, string | null>,
  loadArticleContent: ArticleContentLoader,
): Promise<readonly (readonly [number, string | null])[]> =>
  Promise.all(
    comparisonArticles.map((article) =>
      loadComparisonContent(article, articleContents, loadArticleContent),
    ),
  );

const comparisonEntityFieldsSchema = z.object({
  dates: z.array(z.string()),
  locations: z.array(z.string()),
  organizations: z.array(z.string()),
  persons: z.array(z.string()),
});

const comparisonEntityGroupsSchema = z.object({
  common_entities: comparisonEntityFieldsSchema,
  unique_to_source_1: comparisonEntityFieldsSchema,
  unique_to_source_2: comparisonEntityFieldsSchema,
});

const comparisonEntitiesSchema = z.object({
  comparison: comparisonEntityGroupsSchema,
  source_1: comparisonEntityFieldsSchema,
  source_2: comparisonEntityFieldsSchema,
});

const comparisonSimilaritySchema = z.object({
  content_similarity: z.number(),
  overall_match_percent: z.number(),
  title_similarity: z.number(),
});

const comparisonTopKeywordSchema = z.object({
  count: z.number(),
  word: z.string(),
});

const comparisonCommonKeywordSchema = z.object({
  difference: z.number(),
  emphasis: z.string(),
  keyword: z.string(),
  source_1_freq: z.number(),
  source_2_freq: z.number(),
});

const comparisonUniqueKeywordSchema = z.object({
  frequency: z.number(),
  keyword: z.string(),
});

const comparisonKeywordGroupsSchema = z.object({
  common_keywords: z.array(comparisonCommonKeywordSchema),
  unique_to_source_1: z.array(comparisonUniqueKeywordSchema),
  unique_to_source_2: z.array(comparisonUniqueKeywordSchema),
});

const comparisonKeywordsSchema = z.object({
  comparison: comparisonKeywordGroupsSchema,
  source_1_top: z.array(comparisonTopKeywordSchema),
  source_2_top: z.array(comparisonTopKeywordSchema),
});

const comparisonDiffEntrySchema = z.object({
  index: z.number(),
  text: z.string(),
  type: z.string(),
});

const comparisonSimilarDiffSchema = z.object({
  similarity: z.number(),
  source_1_index: z.number(),
  source_1_text: z.string(),
  source_2_index: z.number(),
  source_2_text: z.string(),
});

const comparisonDiffSchema = z.object({
  added: z.array(comparisonDiffEntrySchema),
  removed: z.array(comparisonDiffEntrySchema),
  similar: z.array(comparisonSimilarDiffSchema),
});

const comparisonSummarySchema = z.object({
  common_entities_count: z.number(),
  common_keywords_count: z.number(),
  unique_entities_source_1: z.number(),
  unique_entities_source_2: z.number(),
  unique_keywords_source_1: z.number(),
  unique_keywords_source_2: z.number(),
});

const comparisonDataSchema = z.object({
  diff: comparisonDiffSchema,
  entities: comparisonEntitiesSchema,
  keywords: comparisonKeywordsSchema,
  similarity: comparisonSimilaritySchema,
  summary: comparisonSummarySchema,
});

const requestComparisonResponse = async (
  comparisonPair: readonly [ComparisonArticle, ComparisonArticle],
  contentOne: string,
  contentTwo: string,
): Promise<ComparisonData> => {
  const [sourceOne, sourceTwo] = comparisonPair;
  const response = await fetch(`${API_BASE_URL}/compare/articles`, {
    body: JSON.stringify({
      content_1: contentOne,
      content_2: contentTwo,
      title_1: sourceOne.title,
      title_2: sourceTwo.title,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Comparison failed (${response.status})`);
  }
  const payload: unknown = await response.json();
  return comparisonDataSchema.parse(payload);
};

const requestComparison = async (
  comparisonArticles: readonly ComparisonArticle[],
  articleContents: ReadonlyMap<number, string | null>,
  loadArticleContent: ArticleContentLoader,
): Promise<ComparisonRequestResult> => {
  const comparisonPair = getComparisonPair(comparisonArticles);
  if (comparisonPair === null) {
    throw new Error("Compare Sources needs full text from two articles.");
  }
  const contentEntries = await loadComparisonEntries(
    comparisonArticles,
    articleContents,
    loadArticleContent,
  );
  const content = getComparisonContent(comparisonPair, new Map(contentEntries));
  const data = await requestComparisonResponse(comparisonPair, content[0], content[1]);
  return { contentEntries, data };
};

export { getComparisonPair, requestComparison };
