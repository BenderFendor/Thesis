"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { type NewsArticle, fetchOGImage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Bookmark,
  ExternalLink,
  Star,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ArticleDetailModal } from "./article-detail-modal";
import { useFavorites } from "@/hooks/useFavorites";
import { useLikedArticles } from "@/hooks/useLikedArticles";
import { useBookmarks } from "@/hooks/useBookmarks";
import { cn } from "@/lib/utils";

const OG_FETCH_CONCURRENCY = 4;
const OG_LOOKAHEAD = 6;

const hasRealImage = (image: string) => {
  if (!image) return false;
  const trimmed = image.trim();
  if (!trimmed || trimmed === "none") return false;

  const lower = image.toLowerCase();
  if (lower.includes("placeholder") || lower.endsWith(".svg")) return false;

  return (
    !lower.includes("logo") &&
    !lower.includes("punch") &&
    !lower.includes("header") &&
    !lower.includes("icon")
  );
};

interface FeedViewProps {
  articles: NewsArticle[];
  loading: boolean;
}

const cardReveal = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

export function FeedView({ articles: propArticles, loading }: FeedViewProps) {
  const { likedIds, toggleLike } = useLikedArticles();
  const { bookmarkIds, toggleBookmark } = useBookmarks();
  const { isFavorite, toggleFavorite } = useFavorites();

  const articles = useMemo(() => {
    return [...propArticles].sort((a, b) => {
      const aFav = isFavorite(a.sourceId);
      const bFav = isFavorite(b.sourceId);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;

      const aHasImage = hasRealImage(a.image);
      const bHasImage = hasRealImage(b.image);
      if (aHasImage && !bHasImage) return -1;
      if (!aHasImage && bHasImage) return 1;

      return 0;
    });
  }, [propArticles, isFavorite]);

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(
    null,
  );
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ogImages, setOgImages] = useState<Record<number, string>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);

  const displaySource = useCallback((article: NewsArticle) => {
    if (!article.source) return "";
    return article.source.length > 28
      ? `${article.source.slice(0, 28)}...`
      : article.source;
  }, []);

  const formatDate = useCallback((publishedAt: string) => {
    return new Date(publishedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchImages = async () => {
      const start = Math.max(0, activeIndex - OG_LOOKAHEAD);
      const end = Math.min(articles.length, activeIndex + OG_LOOKAHEAD + 1);
      const candidates = articles.slice(start, end).filter(
        (article) =>
          !hasRealImage(article.image) && article.url && !ogImages[article.id],
      );

      if (candidates.length === 0) return;

      const pending = [...candidates];
      const newImages: Record<number, string> = {};

      const worker = async () => {
        while (pending.length > 0 && !cancelled) {
          const article = pending.shift();
          if (!article) return;

          const imageUrl = await fetchOGImage(article.url);
          if (imageUrl) {
            newImages[article.id] = imageUrl;
          }
        }
      };

      const workers = Array.from(
        { length: Math.min(OG_FETCH_CONCURRENCY, pending.length) },
        () => worker(),
      );
      await Promise.all(workers);

      if (!cancelled && Object.keys(newImages).length > 0) {
        setOgImages((prev) => ({ ...prev, ...newImages }));
      }
    };

    void fetchImages();

    return () => {
      cancelled = true;
    };
  }, [articles, activeIndex, ogImages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"));
            setActiveIndex(index);
          }
        });
      },
      {
        root: container,
        threshold: 0.6,
      },
    );

    const children = container.querySelectorAll("[data-index]");
    children.forEach((child) => observer.observe(child));

    return () => {
      children.forEach((child) => observer.unobserve(child));
      observer.disconnect();
    };
  }, [articles.length]);

  const scrollToNext = useCallback(() => {
    const container = containerRef.current;
    if (!container || activeIndex >= articles.length - 1) return;

    const nextElement = container.querySelector(
      `[data-index="${activeIndex + 1}"]`,
    );
    nextElement?.scrollIntoView({ behavior: "smooth" });
  }, [activeIndex, articles.length]);

  const scrollToPrev = useCallback(() => {
    const container = containerRef.current;
    if (!container || activeIndex <= 0) return;

    const prevElement = container.querySelector(
      `[data-index="${activeIndex - 1}"]`,
    );
    prevElement?.scrollIntoView({ behavior: "smooth" });
  }, [activeIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        scrollToNext();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        scrollToPrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scrollToNext, scrollToPrev]);

  const handleModalBookmarkChange = (
    articleId: number,
    isBookmarked: boolean,
  ) => {
    if (isBookmarked !== bookmarkIds.has(articleId)) {
      void toggleBookmark(articleId);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-border/40 bg-card/50 px-8 py-10 text-center backdrop-blur-xl">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Indexing articles
          </span>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center bg-background">
        <div className="rounded-3xl border border-border/40 bg-card/40 px-8 py-10 text-center backdrop-blur-xl">
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            No coverage found for this category
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 overflow-hidden bg-background">
      <div
        ref={containerRef}
        className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-auto"
      >
        {articles.map((article, index) => {
          const imageSrc = article.image || ogImages[article.id] || "/placeholder.svg";
          const showImage = hasRealImage(imageSrc);

          return (
            <motion.section
              key={`${article.id}-${index}`}
              data-index={index}
              variants={cardReveal}
              initial="hidden"
              whileInView="visible"
              viewport={{ amount: 0.45, once: true }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="group relative flex min-h-full w-full cursor-pointer snap-start items-end overflow-hidden"
              onClick={() => {
                setSelectedArticle(article);
                setIsArticleModalOpen(true);
              }}
            >
              <div className="absolute inset-0 overflow-hidden">
                {showImage ? (
                  <motion.img
                    layoutId={`feed-image-${article.id}`}
                    src={imageSrc}
                    alt={article.title}
                    className="h-full w-full object-cover opacity-70 transition-transform duration-700 ease-out group-hover:scale-105"
                    onError={(event) => {
                      const target = event.target as HTMLImageElement;
                      if (
                        target.src !== ogImages[article.id] &&
                        ogImages[article.id]
                      ) {
                        target.src = ogImages[article.id];
                      } else if (target.src !== "/placeholder.svg") {
                        target.src = "/placeholder.svg";
                      }
                    }}
                  />
                ) : (
                  <div className="editorial-fallback-surface h-full w-full" />
                )}
              </div>

              <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/30 to-background" />

              <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2 md:left-8 md:top-8">
                <Badge className="border border-primary/40 bg-primary/15 px-3 py-1 text-xs uppercase tracking-wider text-primary">
                  {article.category}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-border/40 bg-background/50 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground backdrop-blur-xl"
                >
                  {article.credibility} credibility
                </Badge>
              </div>

              <div className="absolute right-4 top-4 rounded-md border border-border/50 bg-background/60 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground backdrop-blur-xl md:right-8 md:top-8">
                {index + 1} / {articles.length}
              </div>

              <div className="relative z-10 mx-4 mb-4 flex w-full flex-col gap-6 rounded-2xl border border-border/50 bg-background/70 p-6 shadow-2xl backdrop-blur-xl md:mx-8 md:mb-8 md:p-8 lg:mx-12 lg:mb-12 lg:flex-row lg:items-end lg:gap-10 lg:p-10">
                <div className="flex-1 space-y-5">
                  <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-primary">
                    <span className="h-px w-8 bg-primary" />
                    <span>{displaySource(article)}</span>
                  </div>

                  <motion.h1
                    layoutId={`feed-title-${article.id}`}
                    className="max-w-5xl font-serif text-3xl leading-tight text-foreground md:text-5xl lg:text-6xl"
                  >
                    {article.title}
                  </motion.h1>

                  <p className="max-w-3xl text-base leading-relaxed text-foreground/80 md:text-xl">
                    {article.summary}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-wider text-muted-foreground">
                    <span>{formatDate(article.publishedAt)}</span>
                    <span className="hidden h-1 w-1 rounded-full bg-border md:inline-flex" />
                    <span className="hidden md:inline-flex">{article.country}</span>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 rounded-full border-border/40 bg-card/40 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out active:scale-95"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Source
                      </Button>
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card/70 p-2 backdrop-blur-xl lg:flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 rounded-xl text-muted-foreground transition-all duration-300 ease-out hover:bg-background/80 hover:text-primary active:scale-95"
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleLike(article.id);
                    }}
                  >
                    <Heart
                      className={cn(
                        "h-5 w-5 transition-all duration-300 ease-out",
                        likedIds.has(article.id)
                          ? "fill-primary text-primary"
                          : "text-muted-foreground",
                      )}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 rounded-xl text-muted-foreground transition-all duration-300 ease-out hover:bg-background/80 hover:text-primary active:scale-95"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(article.sourceId);
                    }}
                  >
                    <Star
                      className={cn(
                        "h-5 w-5 transition-all duration-300 ease-out",
                        isFavorite(article.sourceId)
                          ? "fill-primary text-primary"
                          : "text-muted-foreground",
                      )}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 rounded-xl text-muted-foreground transition-all duration-300 ease-out hover:bg-background/80 hover:text-primary active:scale-95"
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleBookmark(article.id);
                    }}
                  >
                    <Bookmark
                      className={cn(
                        "h-5 w-5 transition-all duration-300 ease-out",
                        bookmarkIds.has(article.id)
                          ? "fill-primary text-primary"
                          : "text-muted-foreground",
                      )}
                    />
                  </Button>
                </div>
              </div>
            </motion.section>
          );
        })}
      </div>

      <div className="absolute right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 md:flex lg:right-8">
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToPrev}
          disabled={activeIndex === 0}
          className="h-12 w-12 rounded-xl border-border/50 bg-background/70 text-foreground backdrop-blur-xl transition-all duration-300 ease-out hover:bg-card active:scale-95 disabled:opacity-30"
        >
          <ChevronUp className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToNext}
          disabled={activeIndex === articles.length - 1}
          className="h-12 w-12 rounded-xl border-border/50 bg-background/70 text-foreground backdrop-blur-xl transition-all duration-300 ease-out hover:bg-card active:scale-95 disabled:opacity-30"
        >
          <ChevronDown className="h-5 w-5" />
        </Button>
      </div>

      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => setIsArticleModalOpen(false)}
        onBookmarkChange={handleModalBookmarkChange}
        layoutIdPrefix="feed"
      />
    </div>
  );
}
