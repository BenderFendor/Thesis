"use client";

import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/safe-image";
import { isUsableImage } from "@/lib/article-image";
import type { ClusterArticle } from "@/lib/api";
import { formatSignedNumber, getCameoSummary } from "./cluster-detail-modal-helpers";
import type { GdeltContextLike } from "./cluster-detail-modal-types";
import { ArticleDate, ArticleMatchBadge } from "./cluster-detail-modal-article-primitives";
import Link from "next/link";
import { useCallback } from "react";
import type { MouseEventHandler } from "react";

interface ArticleHeaderProps {
  readonly article: ClusterArticle;
  readonly onClose: () => void;
}

const ArticleHeaderSourceBadge = ({ source }: Readonly<{ source: string }>) => (
  <div className="absolute top-3 left-3">
    <Badge
      variant="outline"
      className="text-[10px] font-semibold px-2 py-0.5 bg-black/70 text-white border-white/30 uppercase tracking-wider"
    >
      {source}
    </Badge>
  </div>
);

const ArticleHeaderImage = ({ article }: Readonly<{ article: ClusterArticle }>) => {
  if (!isUsableImage(article.image_url)) {
    return null;
  }
  return (
    <div className="relative aspect-video max-h-[300px] overflow-hidden rounded-lg mb-6">
      <SafeImage
        src={article.image_url}
        alt={article.title}
        fill
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <ArticleHeaderSourceBadge source={article.source} />
    </div>
  );
};

const ArticleHeaderMetadata = ({ article, onClose }: Readonly<ArticleHeaderProps>) => {
  const handleSourceClick: MouseEventHandler<HTMLAnchorElement> = useCallback(
    (event) => {
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Link
        href={`/source/${encodeURIComponent(
          article.source.toLowerCase().replaceAll(/\s+/gu, "-"),
        )}`}
        className="font-medium hover:text-primary transition-colors"
        onClick={handleSourceClick}
      >
        {article.source}
      </Link>
      <span>|</span>
      <ArticleDate publishedAt={article.published_at} />
      <ArticleMatchBadge similarity={article.similarity} />
    </div>
  );
};

const ArticleTabHeader = ({ article, onClose }: Readonly<ArticleHeaderProps>) => (
  <div>
    <ArticleHeaderImage article={article} />
    <h3 className="font-serif text-2xl font-bold mb-3">{article.title}</h3>
    <ArticleHeaderMetadata article={article} onClose={onClose} />
    {article.gdelt_context && <ArticleGdeltBadges context={article.gdelt_context} />}
  </div>
);

const ArticleGdeltBadges = ({ context }: Readonly<{ context: GdeltContextLike }>) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.18em]">
      {getCameoSummary(context) ?? "GDELT"}
    </Badge>
    {context.tone_delta_vs_cluster !== undefined && context.tone_delta_vs_cluster !== null && (
      <Badge
        className={`text-[10px] uppercase tracking-[0.18em] ${(() => {
          if (context.tone_delta_vs_cluster >= 0) {
            return "bg-emerald-500/15 text-emerald-300";
          }
          return "bg-red-500/15 text-red-300";
        })()}`}
      >
        Tone {formatSignedNumber(context.tone_delta_vs_cluster, 2)}
      </Badge>
    )}
  </div>
);

export { ArticleTabHeader };
