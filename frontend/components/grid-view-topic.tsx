"use client";
import { hasText } from "@/lib/utils";

import type { AllCluster, NewsArticle } from "@/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Layers, List, Newspaper } from "lucide-react";
import { getClusterPreviewStats, pickClusterImageUrl } from "@/lib/cluster-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContradictionPanel } from "@/components/contradiction-panel";
import type { DeepReadonly } from "@/app/search/research/model/types";
import { SafeImage } from "@/components/safe-image";
import { SourceArticleCard } from "./grid-view-source";
import { StoryLineagePanel } from "@/components/story-lineage-panel";
import { useMemo } from "react";

type GridButtonEvent = Readonly<{ stopPropagation: () => void }>;
type ReadonlyGridCluster = DeepReadonly<AllCluster>;

const TOPIC_INITIAL = { opacity: 0, scale: 0.95 } as const;
const TOPIC_ANIMATE = { opacity: 1, scale: 1 } as const;

interface TopicClusterCardProps {
  readonly cluster: ReadonlyGridCluster;
  readonly getDisplayLabel: (cluster: ReadonlyGridCluster) => string;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly onCompare: (event: GridButtonEvent) => void;
  readonly onExpand: () => void;
}

interface TopicClusterMediaProps {
  readonly alt: string;
  readonly imageUrl: string | null;
  readonly isExpanded: boolean;
  readonly onCompare: (event: GridButtonEvent) => void;
}

const TopicClusterMedia = ({ alt, imageUrl, isExpanded, onCompare }: TopicClusterMediaProps) => (
  <div className="relative m-1 aspect-square overflow-hidden rounded bg-white/5 sm:m-2 sm:aspect-video sm:rounded-lg">
    {(() => {
  if (hasText(imageUrl)) {
    return <SafeImage src={imageUrl} alt={alt} fill sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="h-full w-full object-cover grayscale transition duration-700 group-hover:scale-105 group-hover:grayscale-0" />;
  }
  return <div className="editorial-fallback-surface h-full w-full opacity-50 transition duration-700 group-hover:scale-105" />;
})()}
    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
    <div className="absolute right-1 top-1 z-10 text-white drop-shadow-md sm:right-4 sm:top-4">
      {(() => {
  if (isExpanded) {
    return <ChevronDown className="h-3.5 w-3.5 sm:h-5 sm:w-5" />;
  }
  return <ChevronRight className="h-3.5 w-3.5 text-white/75 group-hover:text-white sm:h-5 sm:w-5" />;
})()}
    </div>
    <div className="absolute left-4 top-4 z-10 hidden sm:block">
      <Button
        variant="ghost"
        size="sm"
        onClick={onCompare}
        className="pointer-events-auto h-8 rounded-full bg-black/50 px-3 text-xs uppercase tracking-widest text-white backdrop-blur hover:bg-black/70"
      >
        Compare
      </Button>
    </div>
  </div>
);

interface TopicClusterSummaryProps {
  readonly cluster: ReadonlyGridCluster;
  readonly getDisplayLabel: (cluster: ReadonlyGridCluster) => string;
  readonly onCompare: (event: GridButtonEvent) => void;
}

const TopicClusterSummary = ({ cluster, getDisplayLabel, onCompare }: TopicClusterSummaryProps) => {
  const previewStats = getClusterPreviewStats(cluster);
  return (
    <div className="flex flex-1 flex-col gap-1.5 p-1.5 pt-1 text-xs text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:p-5 sm:pt-3 sm:uppercase sm:tracking-widest">
      <h3 className="line-clamp-3 font-serif text-sm leading-tight text-foreground/90 sm:hidden">
        {getDisplayLabel(cluster)}
      </h3>
      <span className="flex items-center gap-1 sm:gap-2">
        <Newspaper className="h-3 w-3 text-primary/70 sm:h-3.5 sm:w-3.5" />{" "}
        {previewStats.sourceCount} sources
      </span>
      <span className="flex items-center gap-1 sm:gap-2">
        <List className="h-3 w-3 text-primary/70 sm:h-3.5 sm:w-3.5" /> {previewStats.articleCount}{" "}
        stories
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCompare}
        className="mt-auto h-6 w-full rounded-full bg-white/5 px-2 text-xs font-medium text-foreground hover:bg-white/10 sm:hidden"
      >
        Compare
      </Button>
    </div>
  );
};

const TopicClusterCard = ({
  cluster,
  index,
  isExpanded,
  getDisplayLabel,
  onExpand,
  onCompare,
}: TopicClusterCardProps) => {
  const representative = cluster.representative_article;
  const imageUrl = pickClusterImageUrl(cluster);
  const transition = useMemo(() => ({ delay: index * 0.05 }), [index]);
  if (!representative) {
    return null;
  }

  return (
    <motion.div
      initial={TOPIC_INITIAL}
      animate={TOPIC_ANIMATE}
      transition={transition}
      data-cluster-id={cluster.cluster_id}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-md border bg-black/25 transition-all duration-500 hover:bg-white/[0.03] scroll-mt-6 sm:rounded-lg sm:bg-black/20 ${(() => {
  if (isExpanded) {
    return "border-primary/50 ring-1 ring-primary/40";
  }
  return "border-white/10 sm:border-white/5";
})()}`}
    >
      <button
        type="button"
        aria-label={`Open topic: ${getDisplayLabel(cluster)}`}
        onClick={onExpand}
        className="absolute inset-0 z-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:rounded-lg"
      />
      <div className="pointer-events-none relative z-10">
        <TopicClusterMedia
          alt={representative.title}
          imageUrl={imageUrl}
          isExpanded={isExpanded}
          onCompare={onCompare}
        />
      </div>
      <div className="pointer-events-none relative z-10">
        <div className="absolute bottom-4 left-4 right-4 hidden sm:block">
          <h3 className="font-serif text-xl font-medium leading-snug text-white drop-shadow-md">
            {getDisplayLabel(cluster)}
          </h3>
        </div>
        <TopicClusterSummary
          cluster={cluster}
          getDisplayLabel={getDisplayLabel}
          onCompare={onCompare}
        />
      </div>
    </motion.div>
  );
};

interface ExpandedTopicPanelProps {
  readonly articles: readonly NewsArticle[];
  readonly cluster: ReadonlyGridCluster;
  readonly getDisplayLabel: (cluster: ReadonlyGridCluster) => string;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onArticleClick: (article: NewsArticle) => void;
  readonly onClose: () => void;
  readonly onLike: (articleId: number, event?: GridButtonEvent) => void;
  readonly onQueueToggle: (article: NewsArticle, event?: GridButtonEvent) => void;
}

const ExpandedTopicHeader = ({
  cluster,
  getDisplayLabel,
  onClose,
}: Readonly<Pick<ExpandedTopicPanelProps, "cluster" | "getDisplayLabel" | "onClose">>) => {
  const previewStats = getClusterPreviewStats(cluster);
  return (
    <div className="flex flex-col gap-4 border-b border-white/10 bg-black/30 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Layers className="h-5 w-5 text-primary" />
        <h3 className="font-serif text-2xl text-foreground">{getDisplayLabel(cluster)}</h3>
        <Badge
          variant="outline"
          className="border-white/10 bg-white/5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          {previewStats.sourceCount} sources
        </Badge>
        <Badge
          variant="outline"
          className="border-white/10 bg-white/5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          {previewStats.articleCount} stories
        </Badge>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="w-fit rounded-full border border-white/10 bg-transparent px-4 text-xs uppercase tracking-widest text-muted-foreground hover:bg-white/5 hover:text-white"
      >
        Close topic
      </Button>
    </div>
  );
};

const ExpandedTopicArticles = ({
  articles,
  isArticleInQueue,
  likedIds,
  onArticleClick,
  onLike,
  onQueueToggle,
}: Readonly<
  Pick<
    ExpandedTopicPanelProps,
    "articles" | "isArticleInQueue" | "likedIds" | "onArticleClick" | "onLike" | "onQueueToggle"
  >
>) => {
  if (articles.length === 0) {
    return (
      <div className="py-12 text-center text-xs uppercase tracking-widest text-muted-foreground">
        No articles found for this topic
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
      <AnimatePresence>
        {articles.map((article, index) => (
          <SourceArticleCard
            key={(() => {
  if (article.url) {
    return `cluster-url:${article.url}`;
  }
  return `cluster-id:${article.id}`;
})()}
            article={article}
            index={index}
            likedIds={likedIds}
            isArticleInQueue={isArticleInQueue}
            onArticleClick={onArticleClick}
            onLike={onLike}
            onQueueToggle={onQueueToggle}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

const ExpandedTopicKeywords = ({ keywords }: Readonly<{ keywords: readonly string[] }>) => {
  if (keywords.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">Keywords</span>
      {keywords.slice(0, 8).map((keyword) => (
        <Badge
          key={keyword}
          variant="outline"
          className="border-white/10 bg-white/5 text-xs uppercase tracking-widest text-muted-foreground"
        >
          {keyword}
        </Badge>
      ))}
    </div>
  );
};

const ExpandedTopicPanel = ({
  cluster,
  articles,
  likedIds,
  isArticleInQueue,
  getDisplayLabel,
  onArticleClick,
  onLike,
  onQueueToggle,
  onClose,
}: ExpandedTopicPanelProps) => (
  <div
    data-cluster-expanded-for={cluster.cluster_id}
    className="col-span-full overflow-hidden rounded-lg border border-primary/30 bg-black/20"
  >
    <ExpandedTopicHeader cluster={cluster} getDisplayLabel={getDisplayLabel} onClose={onClose} />
    <div className="space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6">
      <ContradictionPanel clusterId={cluster.cluster_id} />
      <StoryLineagePanel clusterId={cluster.cluster_id} />
      <ExpandedTopicArticles
        articles={articles}
        isArticleInQueue={isArticleInQueue}
        likedIds={likedIds}
        onArticleClick={onArticleClick}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
      />
      <ExpandedTopicKeywords keywords={cluster.keywords} />
    </div>
  </div>
);

export { ExpandedTopicPanel, TopicClusterCard };
