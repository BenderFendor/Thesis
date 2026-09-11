import type { NewsArticle } from "@/lib/api";
import { isUsableImage as isUsableArticleImage } from "@/lib/article-image";


const PREVIEW_WORD_LIMIT = 150;
const READ_SPEED_WPM = 230;
const isUsableImage = isUsableArticleImage;

type ArticleSummaryVisibility = Readonly<{
  showNoContent: boolean;
  showSummary: boolean;
  showText: boolean;
}>;
type ArticleContentFields = Readonly<Pick<NewsArticle, "content" | "summary">>;

const getPreviewWithLimit = (text: string): string => {
  const words = text.split(/\s+/u);
  if (words.length <= PREVIEW_WORD_LIMIT) {
    return text;
  }
  return `${words.slice(0, PREVIEW_WORD_LIMIT).join(" ")} ...`;
};

const getArticlePreview = (article: ArticleContentFields): string => {
  if (article.summary !== "") {
    return getPreviewWithLimit(article.summary);
  }
  if (article.content !== undefined && article.content !== "") {
    return getPreviewWithLimit(article.content);
  }
  return "No description available";
};

const getArticleSummaryVisibility = (
  article: ArticleContentFields,
  articleLoading: boolean,
  fullArticleText: string | undefined,
): ArticleSummaryVisibility => {
  const hasContent = Boolean(article.content);
  const hasFullArticle = Boolean(fullArticleText);
  const hasSummary = Boolean(article.summary);
  const presentFieldCount = [hasContent, hasFullArticle, hasSummary].filter(Boolean).length;
  return {
    showNoContent: presentFieldCount === 0,
    showSummary: hasSummary && article.summary !== article.content,
    showText: hasContent && !hasFullArticle && !articleLoading,
  };
};

const calculateReadTime = (text: string): number => {
  if (text === "") {
    return 0;
  }
  return Math.ceil(text.trim().split(/\s+/u).length / READ_SPEED_WPM);
};

export { calculateReadTime, getArticlePreview, getArticleSummaryVisibility, isUsableImage };
