import type { CSSProperties } from "react";
import type { NewsArticle } from "@/lib/api";
import type { SavedArticle } from "@/app/saved/saved-workspace-model";
import { isUsableImage } from "@/lib/article-image";

const CARD_OFFSET_LIMIT_PX = 16;
const CARD_OFFSET_STEP_PX = 4;
const CARD_OVERLAP_PX = -8;
const QUEUE_PREVIEW_LIMIT = 5;
const ARTICLE_THUMBNAIL_SIZE = 64;
const QUEUE_THUMBNAIL_SIZE = 80;
const LIST_POSITION_OFFSET = 1;

const getCardFrameStyle = (isExpanded: boolean): CSSProperties => {
  if (isExpanded) {
    return {
      backgroundColor: "var(--news-bg-secondary)",
      borderColor: "var(--primary)",
      outlineColor: "var(--primary)",
      outlineOffset: "0px",
      outlineWidth: "2px",
    };
  }
  return {
    backgroundColor: "var(--card)",
    borderColor: "var(--border)",
    outlineOffset: "0px",
    outlineWidth: "0px",
  };
};

const getArticleStackStyle = (index?: number): CSSProperties => {
  if (index === undefined) {
    return {};
  }
  let marginTop = "0px";
  if (index > 0) {
    marginTop = `${CARD_OVERLAP_PX}px`;
  }
  return {
    marginLeft: `${Math.min(index * CARD_OFFSET_STEP_PX, CARD_OFFSET_LIMIT_PX)}px`,
    marginTop,
  };
};

const articleKey = (article: NewsArticle): string => `${article.id}:${article.url}`;

const tagSavedArticles = (
  articles: readonly NewsArticle[],
  kind: SavedArticle["type"],
): readonly SavedArticle[] => articles.map((article) => ({ ...article, type: kind }));

const hasUsableArticleImage = (article: Readonly<{ image?: string | null }>): boolean =>
  isUsableImage(article.image);

export {
  ARTICLE_THUMBNAIL_SIZE,
  CARD_OFFSET_LIMIT_PX,
  CARD_OFFSET_STEP_PX,
  CARD_OVERLAP_PX,
  LIST_POSITION_OFFSET,
  QUEUE_PREVIEW_LIMIT,
  QUEUE_THUMBNAIL_SIZE,
  articleKey,
  getArticleStackStyle,
  getCardFrameStyle,
  hasUsableArticleImage,
  tagSavedArticles,
};
