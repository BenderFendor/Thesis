"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { get_logger } from "@/lib/utils";
import { useFavorites } from "@/hooks/useFavorites";
import { useLikedArticles } from "@/hooks/useLikedArticles";
import { useBookmarks } from "@/hooks/useBookmarks";
import { cn } from "@/lib/utils";

const logger = get_logger("FeedView");
const OG_FETCH_CONCURRENCY = 4;
const OG_LOOKAHEAD = 6;

const hasRealImage = (image: string) => {
  if (!image) return false;
  const trimmed = image.trim();
  if (!trimmed) return false;
  if (trimmed === "none") return false;
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

export function FeedView({ articles: propArticles, loading }: FeedViewProps) {
  const { likedIds, toggleLike } = useLikedArticles();
  const { bookmarkIds, toggleBookmark } = useBookmarks();
  const { isFavorite, toggleFavorite } = useFavorites();

  const articles = useMemo(() => {
    return [...propArticles].sort((a, b) => {
      // 1. Prioritize favorited sources
      const aFav = isFavorite(a.sourceId);
      const bFav = isFavorite(b.sourceId);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;

      // 2. Prioritize articles with real images
      const aHasImage = hasRealImage(a.image);
      const bHasImage = hasRealImage(b.image);
      if (aHasImage && !bHasImage) return -1;
      if (!aHasImage && bHasImage) return 1;

      return 0; // Keep original relative order otherwise
    });
  }, [propArticles, isFavorite]);

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(
    null,
  );
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ogImages, setOgImages] = useState<Record<number, string>>({});

  const displaySource = useCallback((article: NewsArticle) => {
    if (!article.source) return "";
    return article.source.length > 24
      ? `${article.source.slice(0, 24)}…`
      : article.source;
  }, []);

  // Fetch OG images for articles missing images
  useEffect(() => {
    let cancelled = false;

    const fetchImages = async () => {
      const start = Math.max(0, activeIndex - OG_LOOKAHEAD);
      const end = Math.min(articles.length, activeIndex + OG_LOOKAHEAD + 1);
      const candidates = articles
        .slice(start, end)
        .filter(
          (article) =>
            !hasRealImage(article.image) &&
            article.url &&
            !ogImages[article.id],
        );

      if (candidates.length === 0) {
        return;
      }

      const pending = [...candidates];
      const newImages: Record<number, string> = {};

      const worker = async () => {
        while (pending.length > 0 && !cancelled) {
          const article = pending.shift();
          if (!article) {
            return;
          }

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

  const handleLike = (articleId: number) => {
    void toggleLike(articleId);
  };

  const handleBookmark = async (articleId: number) => {
    if (!articleId) return;
    await toggleBookmark(articleId);
  };

  const handleModalBookmarkChange = (
    articleId: number,
    isBookmarked: boolean,
  ) => {
    if (isBookmarked !== bookmarkIds.has(articleId)) {
      void toggleBookmark(articleId);
    }
  };

  const handleArticlePreview = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
    setIsArticleModalOpen(true);
  }, []);

  // Use Intersection Observer to track active index
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observerOptions = {
      root: container,
      threshold: 0.6, // Trigger when 60% of the article is visible
    };

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = Number(entry.target.getAttribute("data-index"));
          setActiveIndex(index);
        }
      });
    };

    const observer = new IntersectionObserver(
      observerCallback,
      observerOptions,
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

  if (loading) {
    return (
      <div className="flex-1 h-full w-full flex items-center justify-center bg-[var(--news-bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Indexing articles...
          </span>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex-1 h-full w-full flex items-center justify-center bg-[var(--news-bg-primary)]">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          No coverage found for this category.
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 h-full min-h-0 w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-auto snap-y snap-mandatory no-scrollbar"
      >
        {articles.map((article, index) => (
          <section
            key={`${article.id}-${index}`}
            data-index={index}
            className="snap-start h-[calc(100vh-64px)] w-full relative cursor-pointer group"
            onClick={() => handleArticlePreview(article)}
          >
            <div className="absolute inset-0 w-full h-full overflow-hidden">
              <img
                src={
                  article.image || ogImages[article.id] || "/placeholder.svg"
                }
                alt={article.title}
                className="w-full h-full object-cover opacity-40 transition-transform duration-700 group-hover:scale-105"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
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
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

            <div className="relative z-10 h-full flex flex-col justify-end p-6 md:p-10 lg:p-12">
              <div className="absolute top-6 left-6 md:top-8 md:left-8 flex flex-wrap items-center gap-3">
                <Badge className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em]">
                  {article.category}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono uppercase tracking-[0.2em] border-white/10 bg-black/40 backdrop-blur-sm text-white/70 px-3 py-1"
                >
                  {article.credibility} credibility
                </Badge>
              </div>

              <div className="absolute top-6 right-6 md:top-8 md:right-8 font-mono text-[10px] uppercase tracking-[0.3em] text-white/50 bg-black/20 backdrop-blur-md px-3 py-1 border border-white/5">
                {index + 1} / {articles.length}
              </div>

              <div className="flex flex-col md:flex-row md:items-end gap-6 md:gap-10">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.4em] text-primary font-bold">
                    <span className="w-8 h-px bg-primary" />
                    {displaySource(article)}
                  </div>

                  <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold leading-tight text-balance text-white drop-shadow-lg tracking-tight">
                    {article.title}
                  </h1>

                  <p className="text-base md:text-xl text-white/80 line-clamp-3 max-w-3xl drop-shadow font-serif italic">
                    {article.summary}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <span className="font-mono text-[10px] text-white/80 tracking-widest uppercase">
                      {new Date(article.publishedAt).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric", year: "numeric" },
                      )}
                    </span>

                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/5 text-white border-white/20 hover:bg-white/10 font-mono text-[10px] uppercase tracking-[0.3em]"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-2" />
                        Source
                      </Button>
                    </a>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col items-center gap-2 md:gap-4 md:bg-black/20 md:backdrop-blur-xl md:p-3 md:border md:border-white/10 md:rounded-full">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 rounded-full hover:bg-white/10 transition-all active:scale-90"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleLike(article.id);
                    }}
                  >
                    <Heart
                      className={cn(
                        "w-6 h-6 transition-all",
                        likedIds.has(article.id)
                          ? "fill-primary text-primary scale-110"
                          : "text-white/60",
                      )}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 rounded-full hover:bg-white/10 transition-all active:scale-90"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(article.sourceId);
                    }}
                  >
                    <Star
                      className={cn(
                        "w-6 h-6 transition-all",
                        isFavorite(article.sourceId)
                          ? "fill-amber-400 text-amber-400 scale-110"
                          : "text-white/60",
                      )}
                    />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12 rounded-full hover:bg-white/10 transition-all active:scale-90"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleBookmark(article.id);
                    }}
                  >
                    <Bookmark
                      className={cn(
                        "w-6 h-6 transition-all",
                        bookmarkIds.has(article.id)
                          ? "fill-white text-white scale-110"
                          : "text-white/60",
                      )}
                    />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Navigation Controls */}
      <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-20 hidden md:flex">
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToPrev}
          disabled={activeIndex === 0}
          className="rounded-full border-white/10 bg-black/40 backdrop-blur-md hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all"
        >
          <ChevronUp className="w-5 h-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={scrollToNext}
          disabled={activeIndex === articles.length - 1}
          className="rounded-full border-white/10 bg-black/40 backdrop-blur-md hover:bg-primary hover:border-primary text-white disabled:opacity-20 transition-all"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      </div>

      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => setIsArticleModalOpen(false)}
        onBookmarkChange={handleModalBookmarkChange}
      />

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
