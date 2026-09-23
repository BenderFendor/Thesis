import type {
  Message,
  ReadonlyNewsArticle,
  ReferencedArticlePayload,
  StructuredArticleSummary,
} from "./types";
import { mapBackendArticle } from "@/lib/api";

const ARTICLE_DESCRIPTION_FALLBACK = "No description";
const ARTICLE_SOURCE_FALLBACK = "Unknown";
const ARTICLE_TITLE_FALLBACK = "No title";
const FIRST_INDEX = 0;

const getArticleText = (value: string | undefined, fallback: string): string => {
  if (value === undefined || value.length === FIRST_INDEX) {
    return fallback;
  }
  return value;
};

const mapReferencedArticleToNewsArticle = (
  article: Readonly<ReferencedArticlePayload>,
): ReadonlyNewsArticle => {
  const category = getArticleText(article.category, "general");
  const description = getArticleText(article.description, ARTICLE_DESCRIPTION_FALLBACK);
  const published = getArticleText(article.published, new Date().toISOString());
  const source = getArticleText(article.source, ARTICLE_SOURCE_FALLBACK);
  const title = getArticleText(article.title, ARTICLE_TITLE_FALLBACK);
  return mapBackendArticle({
    category,
    country: "International",
    description,
    image: article.image,
    link: article.link,
    published,
    source,
    title,
  });
};

const getEmbeddedArticleDescription = (
  article: Readonly<Pick<StructuredArticleSummary, "summary" | "description">>,
): string =>
  getArticleText(
    article.summary,
    getArticleText(article.description, ARTICLE_DESCRIPTION_FALLBACK),
  );

const getEmbeddedArticleLink = (
  article: Readonly<Pick<StructuredArticleSummary, "link" | "url">>,
): string => {
  if (article.link !== undefined && article.link.length > FIRST_INDEX) {
    return article.link;
  }
  return article.url ?? "";
};

const mapStructuredArticle = (article: Readonly<StructuredArticleSummary>): ReadonlyNewsArticle => {
  const description = getEmbeddedArticleDescription(article);
  const link = getEmbeddedArticleLink(article);
  const source = getArticleText(article.source, ARTICLE_SOURCE_FALLBACK);
  const category = getArticleText(article.category, "general");
  const published = getArticleText(article.published, new Date().toISOString());
  const title = getArticleText(article.title, ARTICLE_TITLE_FALLBACK);
  return mapBackendArticle({
    category,
    country: "United States",
    description,
    image: article.image,
    link,
    published,
    source,
    summary: description,
    title,
  });
};

const sampleQueries = [
  "What are the different perspectives on climate change?",
  "Compare how different sources cover technology news",
  "Summarize the latest political developments",
  "Which sources have covered AI recently?",
  "Analyze bias in coverage of international conflicts",
];

const buildArticleEmbeds = (message?: Readonly<Message>): ReadonlyNewsArticle[] => {
  if (message === undefined) {
    return [];
  }
  if (
    message.referenced_articles !== undefined &&
    message.referenced_articles.length > FIRST_INDEX
  ) {
    return [...message.referenced_articles];
  }
  const structuredArticles = message.structured_articles_json?.articles ?? [];
  return structuredArticles.map((article) => mapStructuredArticle(article));
};

const cleanEmbeddedContent = (content: string): string =>
  content.replaceAll(/(?<!\])\(https?:\/\/[^)]+\)/giu, (match) => match.slice(1, -1));

const buildArticleUrlMap = (
  articles: readonly ReadonlyNewsArticle[],
): ReadonlyMap<string, ReadonlyNewsArticle> => {
  const articleMap = new Map<string, ReadonlyNewsArticle>();
  articles.forEach((article) => {
    if (article.url.length > FIRST_INDEX) {
      articleMap.set(article.url, article);
      articleMap.set(article.url.replace(/\/$/u, ""), article);
    }
  });
  return articleMap;
};
export {
  getArticleText,
  mapReferencedArticleToNewsArticle,
  sampleQueries,
  buildArticleEmbeds,
  cleanEmbeddedContent,
  buildArticleUrlMap,
};
