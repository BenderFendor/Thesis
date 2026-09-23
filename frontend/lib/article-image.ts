const DEFAULT_ARTICLE_IMAGE = "/placeholder.svg";

type ArticleImageFields = Readonly<{
  image?: string | null;
  image_url?: string | null;
}>;

const isUsableImage = (src?: string | null): src is string => {
  if (typeof src !== "string") {
    return false;
  }

  const normalized = src.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    normalized !== "none" &&
    !normalized.includes("/placeholder.svg") &&
    !normalized.includes("/placeholder.jpg")
  );
};

const resolveArticleImage = (
  article: ArticleImageFields,
  fallback = DEFAULT_ARTICLE_IMAGE,
): string => {
  if (isUsableImage(article.image)) {
    return article.image;
  }
  if (isUsableImage(article.image_url)) {
    return article.image_url;
  }
  return fallback;
};

export { DEFAULT_ARTICLE_IMAGE, isUsableImage, resolveArticleImage };
