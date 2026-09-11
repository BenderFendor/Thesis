import { Badge } from "@/components/ui/badge";
import { Bookmark, MoreHorizontal } from "lucide-react";
import { useCallback } from "react";
import type { MouseEvent } from "react";
import type { NewsArticle } from "@/lib/api";
import { hasText, sourceLabel } from "@/lib/globe-workspace";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { isUsableImage } from "@/lib/article-image";
import { SafeImage } from "@/components/safe-image";
import { cn } from "@/lib/utils";

const ACTION_ICON_SIZE = 16;
const ARTICLE_IMAGE_HEIGHT = 120;
const ARTICLE_IMAGE_WIDTH = 200;

type ButtonClickEvent = Readonly<Pick<MouseEvent<HTMLButtonElement>, "stopPropagation">>;

interface ExpandedArticleRowProps {
  readonly article: NewsArticle;
  readonly isBookmarked: (articleId: number) => boolean;
  readonly onToggleBookmark: (articleId: number) => Promise<void>;
  readonly onSelect: (article: NewsArticle) => void;
}

const expandedArticleCountryLabel = (article: NewsArticle): string => {
  if (article.source_country === "United States") {
    return "US";
  }
  if (hasText(article.source_country)) {
    return article.source_country;
  }
  return "GLB";
};

const ExpandedArticleMeta = (props: Readonly<Pick<ExpandedArticleRowProps, "article">>) => (
  <div className="mb-2 flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
    <Badge
      variant="outline"
      className="rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-primary"
    >
      {sourceLabel(props.article)}
    </Badge>
    <span>{formatArticleDateTime(props.article.publishedAt)}</span>
  </div>
);

const ExpandedArticleBody = (props: Readonly<Pick<ExpandedArticleRowProps, "article">>) => (
  <div className="min-w-0 flex-1 py-1">
    <ExpandedArticleMeta article={props.article} />
    <h3 className="mb-2 font-serif text-lg text-foreground transition-colors group-hover:text-primary">
      {props.article.title}
    </h3>
    <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
      {props.article.summary}
    </p>
    <Badge
      variant="outline"
      className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground"
    >
      {expandedArticleCountryLabel(props.article)}
    </Badge>
  </div>
);

const bookmarkClassName = (bookmarked: boolean): string => {
  if (bookmarked) {
    return "text-primary";
  }
  return "hover:text-foreground";
};

const bookmarkLabel = (bookmarked: boolean): string => {
  if (bookmarked) {
    return "Remove bookmark";
  }
  return "Bookmark article";
};

const bookmarkIconClassName = (bookmarked: boolean): string | undefined => {
  if (bookmarked) {
    return "fill-current";
  }
  return void 0;
};

const ExpandedArticleActions = (props: Readonly<ExpandedArticleRowProps>) => {
  const { article, isBookmarked, onToggleBookmark } = props;
  const bookmarked = isBookmarked(article.id);
  const handleBookmark = useCallback(
    (event: ButtonClickEvent): void => {
      event.stopPropagation();
      void onToggleBookmark(article.id);
    },
    [article.id, onToggleBookmark],
  );
  const handleOpenOriginal = useCallback(
    (event: ButtonClickEvent): void => {
      event.stopPropagation();
      globalThis.open(article.url, "_blank", "noopener,noreferrer");
    },
    [article.url],
  );
  const label = bookmarkLabel(bookmarked);
  return (
    <div className="mb-2 flex gap-2 text-muted-foreground">
      <button
        type="button"
        onClick={handleBookmark}
        className={cn("transition-colors", bookmarkClassName(bookmarked))}
        title={label}
        aria-label={label}
      >
        <Bookmark size={ACTION_ICON_SIZE} className={bookmarkIconClassName(bookmarked)} />
      </button>
      <button
        type="button"
        onClick={handleOpenOriginal}
        className="hover:text-foreground"
        title="Open original article"
        aria-label="Open original article"
      >
        <MoreHorizontal size={ACTION_ICON_SIZE} />
      </button>
    </div>
  );
};

const ExpandedArticleImage = (props: Readonly<Pick<ExpandedArticleRowProps, "article">>) => {
  if (!isUsableImage(props.article.image)) {
    return null;
  }
  return (
    <div className="h-[120px] w-[200px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[var(--news-bg-primary)]/40 sepia transition-all group-hover:sepia-0">
      <SafeImage
        src={props.article.image}
        alt=""
        width={ARTICLE_IMAGE_WIDTH}
        height={ARTICLE_IMAGE_HEIGHT}
        className="h-full w-full object-cover"
      />
    </div>
  );
};

const ExpandedArticleImageButton = (
  props: Readonly<Pick<ExpandedArticleRowProps, "article" | "onSelect">>,
) => {
  const { article, onSelect: selectArticle } = props;
  const handleSelect = useCallback(() => {
    selectArticle(article);
  }, [article, selectArticle]);
  return (
    <button
      type="button"
      onClick={handleSelect}
      className="text-left"
      aria-label={`Open article: ${article.title}`}
    >
      <ExpandedArticleImage article={article} />
    </button>
  );
};

const ExpandedArticleAside = (props: Readonly<ExpandedArticleRowProps>) => (
  <div className="flex shrink-0 flex-col items-end justify-between">
    <ExpandedArticleActions
      article={props.article}
      isBookmarked={props.isBookmarked}
      onSelect={props.onSelect}
      onToggleBookmark={props.onToggleBookmark}
    />
    <ExpandedArticleImageButton article={props.article} onSelect={props.onSelect} />
  </div>
);

const ExpandedArticleRow = (props: Readonly<ExpandedArticleRowProps>) => {
  const { article, onSelect: selectArticle } = props;
  const handleSelect = useCallback(() => {
    selectArticle(article);
  }, [article, selectArticle]);
  return (
    <article className="group flex gap-6 border-b border-white/10 p-6 transition-all last:border-0 hover:bg-white/[0.03]">
      <button
        type="button"
        onClick={handleSelect}
        className="min-w-0 flex-1 cursor-pointer text-left"
        aria-label={`Open article: ${article.title}`}
      >
        <ExpandedArticleBody article={article} />
      </button>
      <ExpandedArticleAside
        article={article}
        isBookmarked={props.isBookmarked}
        onSelect={selectArticle}
        onToggleBookmark={props.onToggleBookmark}
      />
    </article>
  );
};

export { ExpandedArticleRow };
