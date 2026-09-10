import { useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Newspaper } from "lucide-react";
import { ArticleCardDate } from "@/components/article-card-date";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SafeImage } from "@/components/safe-image";
import { isUsableImage } from "@/lib/article-image";
import type { NewsArticle } from "@/lib/api";
import { getCoverageLabel } from "./source-page-helpers";

interface SourceCoverageProps {
  readonly articles: readonly NewsArticle[];
  readonly articlesLoading: boolean;
  readonly onArticleClick: (article: NewsArticle) => void;
}

const SOURCE_LOADING_SKELETONS = [0, 1, 2, 3, 4, 5] as const;
const MOTION_VERTICAL_KEY = "y";
const SOURCE_ARTICLE_INITIAL = { opacity: 0, [MOTION_VERTICAL_KEY]: 20 } as const;
const SOURCE_ARTICLE_ANIMATE = { opacity: 1, [MOTION_VERTICAL_KEY]: 0 } as const;
const SOURCE_ARTICLE_EXIT = { opacity: 0, scale: 0.95 } as const;

const SourceCoverageHeader = ({
  articlesLoading,
  articleCount,
}: Readonly<Pick<SourceCoverageProps, "articlesLoading"> & { articleCount: number }>) => (
  <div className="flex items-center justify-between pb-4 border-b border-white/10">
    <h2 className="font-serif text-2xl font-medium tracking-tight">Latest Coverage</h2>
    <div className="flex items-center gap-3">
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        {getCoverageLabel(articlesLoading, articleCount)}
      </span>
    </div>
  </div>
);

interface SourceArticleMotionProps {
  readonly article: NewsArticle;
  readonly index: number;
  readonly onArticleClick: (article: NewsArticle) => void;
}

const SourceArticleMotion = ({
  article,
  index,
  onArticleClick,
}: Readonly<SourceArticleMotionProps>) => {
  const transition = useMemo(() => ({ delay: index * 0.03, duration: 0.3 }), [index]);
  return (
    <motion.div
      layout
      initial={SOURCE_ARTICLE_INITIAL}
      animate={SOURCE_ARTICLE_ANIMATE}
      exit={SOURCE_ARTICLE_EXIT}
      transition={transition}
    >
      <SourceArticleCard article={article} onArticleClick={onArticleClick} />
    </motion.div>
  );
};

const SourceAnimatedArticles = ({
  articles,
  onArticleClick,
}: Readonly<Pick<SourceCoverageProps, "articles" | "onArticleClick">>) => (
  <AnimatePresence mode="popLayout">
    {articles.map((article, index) => (
      <SourceArticleMotion
        key={article.url || article.id}
        article={article}
        index={index}
        onArticleClick={onArticleClick}
      />
    ))}
  </AnimatePresence>
);

const SourceArticleGrid = ({
  articles,
  onArticleClick,
}: Readonly<Pick<SourceCoverageProps, "articles" | "onArticleClick">>) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    <SourceAnimatedArticles articles={articles} onArticleClick={onArticleClick} />
  </div>
);

const SourceArticleLoading = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {SOURCE_LOADING_SKELETONS.map((skeletonId) => (
      <div
        key={`source-loading-${skeletonId}`}
        className="aspect-[4/3] bg-[var(--news-bg-secondary)] rounded-lg border border-white/10 animate-pulse"
      />
    ))}
  </div>
);

const SourceArticleEmpty = () => (
  <div className="py-24 text-center border border-dashed border-white/10 rounded-lg">
    <p className="text-muted-foreground font-serif italic">
      No recent coverage found from this source.
    </p>
  </div>
);

const SourceArticleResults = ({
  articles,
  articlesLoading,
  onArticleClick,
}: Readonly<SourceCoverageProps>) => {
  if (articlesLoading) {
    return <SourceArticleLoading />;
  }
  if (articles.length === 0) {
    return <SourceArticleEmpty />;
  }
  return <SourceArticleGrid articles={articles} onArticleClick={onArticleClick} />;
};

const SourceArticleImage = ({ article }: Readonly<{ article: Readonly<NewsArticle> }>) => {
  if (isUsableImage(article.image)) {
    return (
      <SafeImage
        src={article.image}
        alt={article.title}
        fill
        sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
        className="object-cover grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:scale-105 opacity-80 group-hover:opacity-100"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-white/5">
      <Newspaper className="w-8 h-8 text-white/10" />
    </div>
  );
};

const SourceArticleMedia = ({ article }: Readonly<{ article: Readonly<NewsArticle> }>) => (
  <div className="aspect-[16/9] w-full overflow-hidden bg-white/5 relative">
    <SourceArticleImage article={article} />
    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
    <div className="absolute top-3 left-3">
      <Badge
        variant="secondary"
        className="bg-black/50 backdrop-blur border-white/10 text-[9px] font-mono uppercase tracking-wider text-white hover:bg-black/70"
      >
        {article.category}
      </Badge>
    </div>
  </div>
);

const SourceArticleDateLine = ({ date }: Readonly<{ date: string }>) => (
  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
    <ArticleCardDate date={date} />
  </div>
);

const SourceArticleContent = ({ article }: Readonly<{ article: Readonly<NewsArticle> }>) => (
  <CardContent className="p-4 space-y-2">
    <SourceArticleDateLine date={article.publishedAt} />
    <h3 className="font-serif text-base font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
      {article.title}
    </h3>
    <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">
      {article.summary}
    </p>
  </CardContent>
);

const SourceArticleCard = ({
  article,
  onArticleClick,
}: Readonly<{
  article: Readonly<NewsArticle>;
  onArticleClick: (article: NewsArticle) => void;
}>) => {
  const handleClick = useCallback(() => {
    onArticleClick(article);
  }, [article, onArticleClick]);

  return (
    <Card
      className="group relative border border-white/10 bg-[var(--news-bg-secondary)] rounded-lg cursor-pointer overflow-hidden hover:border-white/20 hover:bg-[#1a1a1a] transition-all h-full"
      onClick={handleClick}
    >
      <SourceArticleMedia article={article} />
      <SourceArticleContent article={article} />
    </Card>
  );
};

const SourceCoverage = ({
  articles,
  articlesLoading,
  onArticleClick,
}: Readonly<SourceCoverageProps>) => (
  <div className="lg:col-span-9 space-y-6">
    <SourceCoverageHeader articlesLoading={articlesLoading} articleCount={articles.length} />
    <SourceArticleResults
      articles={articles}
      articlesLoading={articlesLoading}
      onArticleClick={onArticleClick}
    />
  </div>
);

export { SourceCoverage };
