"use client";

import { hasText } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/safe-image";
import { isUsableImage } from "@/lib/article-image";
import {
  ArticleDate,
  ArticleMatchBadge,
  ArticleOriginalAnchor,
} from "./cluster-detail-modal-article-primitives";
import type { ComparisonArticle, ComparisonData } from "./cluster-detail-modal-types";

interface ComparisonArticleColumnProps {
  readonly article: ComparisonArticle;
  readonly isFirst: boolean;
  readonly content: string | null | undefined;
  readonly loading: boolean;
  readonly comparisonData: ComparisonData;
}

const ComparisonArticleImage = ({ article }: Readonly<{ article: ComparisonArticle }>) => {
  if (!isUsableImage(article.image_url)) {
    return null;
  }
  return (
    <div className="relative aspect-video max-h-[150px] overflow-hidden rounded-lg mb-3">
      <SafeImage
        src={article.image_url || undefined}
        alt={article.title}
        fill
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
    </div>
  );
};

const ComparisonArticleMetadata = ({ article }: Readonly<{ article: ComparisonArticle }>) => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <ArticleDate publishedAt={article.published_at} />
    <ArticleMatchBadge similarity={article.similarity} />
  </div>
);

const ComparisonArticleHeader = ({ article }: Readonly<{ article: ComparisonArticle }>) => (
  <div className="bg-[var(--news-bg-secondary)] p-4 rounded-lg border border-border/60">
    <ComparisonArticleImage article={article} />
    <h4 className="font-serif text-lg font-bold">{article.source}</h4>
    <ComparisonArticleMetadata article={article} />
  </div>
);

const ComparisonSimilarItem = ({
  item,
  isFirst,
}: Readonly<{
  readonly item: ComparisonData["diff"]["similar"][number];
  readonly isFirst: boolean;
}>) => {
  let className = "border-l-orange-500 bg-orange-500/5";
  let text = item.source_2_text;
  if (isFirst) {
    className = "border-l-green-500 bg-green-500/5";
    text = item.source_1_text;
  }
  return (
    <div
      className={`p-2 rounded border-l-2 ${className}`}
      key={`${item.source_1_index}-${item.source_2_index}`}
    >
      <div className="text-[10px] text-muted-foreground mb-1">
        Similarity: {Math.round(item.similarity * 100)}%
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
};

const ComparisonUniqueItem = ({
  item,
}: Readonly<{ item: ComparisonData["diff"]["added"][number] }>) => (
  <div
    key={`unique-${item.index}-${item.text}`}
    className="p-2 rounded border-l-2 border-l-gray-500 bg-gray-500/5 opacity-70"
  >
    <div className="text-[10px] text-muted-foreground mb-1">Unique content</div>
    <p className="text-sm">{item.text}</p>
  </div>
);

const ComparisonDiffEntries = ({
  comparisonData,
  isFirst,
}: Readonly<{ comparisonData: ComparisonData; isFirst: boolean }>) => {
  let uniqueItems = comparisonData.diff.added;
  if (isFirst) {
    uniqueItems = comparisonData.diff.removed;
  }
  return (
    <div className="space-y-2 text-sm">
      {comparisonData.diff.similar.slice(0, 5).map((item) => (
        <ComparisonSimilarItem
          key={`${item.source_1_index}-${item.source_2_index}`}
          item={item}
          isFirst={isFirst}
        />
      ))}
      {uniqueItems.slice(0, 3).map((item) => (
        <ComparisonUniqueItem key={`unique-${item.index}-${item.text}`} item={item} />
      ))}
    </div>
  );
};

const ComparisonLoadingState = () => (
  <div className="flex items-center gap-2 p-4">
    <Loader2 className="w-5 h-5 animate-spin text-primary" />
    <span className="text-muted-foreground text-sm">Loading...</span>
  </div>
);

const ComparisonArticleContent = ({
  isFirst,
  content,
  loading,
  comparisonData,
}: Pick<ComparisonArticleColumnProps, "isFirst" | "content" | "loading" | "comparisonData">) => {
  if (loading) {
    return <ComparisonLoadingState />;
  }
  if (!hasText(content)) {
    return <div className="text-sm text-muted-foreground">No content available</div>;
  }
  return <ComparisonDiffEntries comparisonData={comparisonData} isFirst={isFirst} />;
};

const ComparisonArticleOriginalButton = ({ url }: Readonly<{ url: string }>) => (
  <Button variant="outline" size="sm" asChild className="text-xs">
    <ArticleOriginalAnchor url={url} />
  </Button>
);

const ComparisonArticleActions = ({ url }: Readonly<{ url: string }>) => (
  <div className="flex items-center gap-2">
    <ComparisonArticleOriginalButton url={url} />
  </div>
);

const ComparisonArticleColumn = ({
  article,
  isFirst,
  content,
  loading,
  comparisonData,
}: ComparisonArticleColumnProps) => (
  <div className="space-y-4">
    <ComparisonArticleHeader article={article} />
    <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
      <h5 className="font-bold mb-3 text-sm">{article.title}</h5>
      <ComparisonArticleContent
        isFirst={isFirst}
        content={content}
        loading={loading}
        comparisonData={comparisonData}
      />
    </div>
    <ComparisonArticleActions url={article.url} />
  </div>
);

export { ComparisonArticleColumn };
