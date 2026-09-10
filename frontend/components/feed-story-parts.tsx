"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NewsArticle } from "@/lib/api";
import { SafeImage } from "@/components/safe-image";
import { formatArticleDate } from "@/lib/date-formatters";
import { hasText } from "@/lib/utils";
import { isUsableImage } from "@/lib/article-image";
import { motion } from "framer-motion";

const getFeedFallbackImage = (ogImage: string | undefined): string | undefined => {
  if (isUsableImage(ogImage)) {
    return ogImage;
  }
  return undefined;
};

const FeedStoryImage = ({
  article,
  fallbackSrc,
}: Readonly<{
  readonly article: NewsArticle;
  readonly fallbackSrc: string | undefined;
}>) => (
  <motion.div layoutId={`feed-image-${article.id}`} className="relative h-full w-full">
    <SafeImage
      src={article.image}
      fallbackSrc={fallbackSrc}
      alt={article.title}
      fill
      sizes="100vw"
      className="object-cover opacity-60 transition-transform duration-700 group-hover:scale-105"
    />
  </motion.div>
);

const FeedStoryImageLayer = ({
  article,
  fallbackSrc,
}: Readonly<{
  readonly article: NewsArticle;
  readonly fallbackSrc: string | undefined;
}>) => (
  <div className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden">
    <FeedStoryImage article={article} fallbackSrc={fallbackSrc} />
  </div>
);

const displayFeedSource = (source: string | null | undefined): string => {
  if (!hasText(source)) {
    return "";
  }
  if (source.length > 24) {
    return `${source.slice(0, 24)}...`;
  }
  return source;
};

const FeedStorySource = ({ source }: Readonly<{ source: string | null | undefined }>) => (
  <div className="flex items-center gap-3 font-sans text-xs uppercase tracking-widest text-primary font-bold">
    <span className="w-8 h-px bg-primary" />
    {displayFeedSource(source)}
  </div>
);

const FeedStorySourceButton = () => (
  <Button
    size="sm"
    variant="outline"
    className="bg-white/10 text-white border-white/20 hover:bg-white/20 font-sans text-xs uppercase tracking-wider rounded-lg active:scale-95 transition-all"
  >
    <ExternalLink className="w-3.5 h-3.5 mr-2" />
    Source
  </Button>
);

const FeedStorySourceLink = ({ articleUrl }: Readonly<{ articleUrl: string }>) => (
  <a href={articleUrl} className="pointer-events-auto" target="_blank" rel="noopener noreferrer">
    <FeedStorySourceButton />
  </a>
);

const FeedStoryMeta = ({ article }: Readonly<{ article: NewsArticle }>) => (
  <div className="flex flex-wrap items-center gap-4 pt-2">
    <span className="font-sans text-xs text-white/70 tracking-widest uppercase">
      {formatArticleDate(article.publishedAt)}
    </span>
    <FeedStorySourceLink articleUrl={article.url} />
  </div>
);

const FeedStoryText = ({ article }: Readonly<{ article: NewsArticle }>) => (
  <div className="flex-1 space-y-4">
    <FeedStorySource source={article.source} />
    <motion.h1
      layoutId={`feed-title-${article.id}`}
      className="text-3xl md:text-5xl lg:text-6xl font-serif leading-tight text-balance text-white drop-shadow-lg tracking-tight"
    >
      {article.title}
    </motion.h1>
    <p className="text-base md:text-xl text-white/80 line-clamp-3 max-w-3xl drop-shadow font-sans leading-relaxed">
      {article.summary}
    </p>
    <FeedStoryMeta article={article} />
  </div>
);

export { FeedStoryImageLayer, FeedStoryText, getFeedFallbackImage };
