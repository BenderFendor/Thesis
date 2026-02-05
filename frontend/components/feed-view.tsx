"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { type NewsArticle, fetchOGImage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Bookmark, ExternalLink, Star } from "lucide-react";
import { ArticleDetailModal } from "./article-detail-modal";
import { get_logger } from "@/lib/utils";
import { useFavorites } from "@/hooks/useFavorites";
import { useLikedArticles } from "@/hooks/useLikedArticles";
import { useBookmarks } from "@/hooks/useBookmarks";

const logger = get_logger("FeedView")

const hasRealImage = (image: string) => {
  if (!image) return false;
  const lower = image.toLowerCase();
  if (lower.includes("placeholder") || lower.endsWith(".svg")) return false;
  if (image.trim().length === 0) return false;
  return !lower.includes("logo") && !lower.includes("punch") && !lower.includes("header") && !lower.includes("icon");
};

interface FeedViewProps {
  articles: NewsArticle[];
  loading: boolean;
}

export function FeedView({ articles, loading }: FeedViewProps) {
  const { likedIds, toggleLike } = useLikedArticles();
  const { bookmarkIds, toggleBookmark } = useBookmarks();
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { isFavorite, toggleFavorite } = useFavorites();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const isAnimatingRef = useRef(false);
  const touchStartRef = useRef<number | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ogImages, setOgImages] = useState<Record<number, string>>({});

  const displaySource = useCallback((article: NewsArticle) => {
    if (!article.source) return ""
    return article.source.length > 24 ? `${article.source.slice(0, 24)}…` : article.source
  }, [])


  // Fetch OG images for articles missing images
  useEffect(() => {
    const fetchImages = async () => {
      const newImages: Record<number, string> = {};
      const promises = articles
        .filter(article => !hasRealImage(article.image) && article.url)
        .map(async article => {
          const imageUrl = await fetchOGImage(article.url);
          if (imageUrl) {
            newImages[article.id] = imageUrl;
          }
        });

      await Promise.all(promises);

      if (Object.keys(newImages).length > 0) {
        setOgImages(prev => ({ ...prev, ...newImages }));
      }
    };

    fetchImages();
  }, [articles]);

  const handleLike = (articleId: number) => {
    void toggleLike(articleId);
  };

  const handleBookmark = async (articleId: number) => {
    if (!articleId) return;
    await toggleBookmark(articleId);
  };

  const handleModalBookmarkChange = (articleId: number, isBookmarked: boolean) => {
    if (isBookmarked !== bookmarkIds.has(articleId)) {
      void toggleBookmark(articleId);
    }
  };

  const handleArticlePreview = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
    setIsArticleModalOpen(true);
  }, []);

  const scrollToIndex = useCallback(
    (index: number, smooth = true) => {
      if (!articles.length) {
        return;
      }

      const boundedIndex = Math.min(Math.max(index, 0), articles.length - 1);
      const target = slideRefs.current[boundedIndex];

      if (!target) {
        return;
      }

      setActiveIndex(boundedIndex);
      isAnimatingRef.current = true;
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        isAnimatingRef.current = false;
      }, smooth ? 500 : 0);
    },
    [articles.length]
  );

  useEffect(() => {
    slideRefs.current = slideRefs.current.slice(0, articles.length);
    if (activeIndex > articles.length - 1) {
      setActiveIndex(Math.max(articles.length - 1, 0));
    }
  }, [articles.length, activeIndex]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (articles.length === 0) {
        return;
      }

      if (Math.abs(event.deltaY) < 20 || isAnimatingRef.current) {
        return;
      }

      const direction = event.deltaY > 0 ? 1 : -1;
      const nextIndex = Math.min(
        Math.max(activeIndex + direction, 0),
        articles.length - 1
      );

      if (nextIndex === activeIndex) {
        return;
      }

      event.preventDefault();
      scrollToIndex(nextIndex);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [activeIndex, articles.length, scrollToIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchStartRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (touchStartRef.current === null || articles.length === 0) {
        return;
      }

      const deltaY = touchStartRef.current - (event.changedTouches[0]?.clientY ?? 0);
      touchStartRef.current = null;

      if (Math.abs(deltaY) < 40 || isAnimatingRef.current) {
        return;
      }

      const direction = deltaY > 0 ? 1 : -1;
      const nextIndex = Math.min(
        Math.max(activeIndex + direction, 0),
        articles.length - 1
      );

      if (nextIndex !== activeIndex) {
        scrollToIndex(nextIndex);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [activeIndex, articles.length, scrollToIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      if (isAnimatingRef.current || articles.length === 0) {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(
        Math.max(activeIndex + direction, 0),
        articles.length - 1
      );

      if (nextIndex !== activeIndex) {
        scrollToIndex(nextIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, articles.length, scrollToIndex]);

  if (loading) {
    return <div className="h-screen w-full flex items-center justify-center bg-[var(--news-bg-primary)] text-foreground">Loading...</div>;
  }

  if (articles.length === 0) {
    return <div className="h-screen w-full flex items-center justify-center bg-[var(--news-bg-primary)] text-foreground">No articles found.</div>;
  }

  return (
    <>
      <div
        ref={containerRef}
        className="relative flex-1 h-full min-h-0 w-full overflow-y-auto snap-y snap-mandatory scroll-smooth bg-[var(--news-bg-primary)] text-foreground"
      >
        {articles.map((article, index) => (
          <section
            key={article.id}
            ref={el => {
              slideRefs.current[index] = el;
            }}
            className="snap-start h-screen min-h-screen w-full relative cursor-pointer"
            onClick={() => handleArticlePreview(article)}
          >
            <img
              src={article.image || ogImages[article.id] || '/placeholder.svg'}
              alt={article.title}
              className="absolute inset-0 w-full h-full object-cover opacity-40"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (target.src !== ogImages[article.id] && ogImages[article.id]) {
                  target.src = ogImages[article.id];
                } else if (target.src !== '/placeholder.svg') {
                  target.src = '/placeholder.svg';
                }
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
            <div className="relative z-10 h-full flex flex-col justify-end p-6">
              <div className="absolute top-6 left-6 flex flex-wrap gap-2">
                <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-[0.3em] border-white/10 bg-[var(--news-bg-secondary)]/60">
                  {article.category}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-[0.3em] border-white/10 bg-[var(--news-bg-secondary)]/60 text-foreground/70">
                  {article.credibility} credibility
                </Badge>
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1 space-y-4">
                  <h1 className="text-3xl font-bold leading-tight text-balance drop-shadow-lg">{article.title}</h1>
                  <p className="text-base text-foreground/80 line-clamp-3 max-w-2xl drop-shadow">{article.summary}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono uppercase tracking-[0.3em]">{displaySource(article)}</span>
                    <span className="font-mono uppercase tracking-[0.3em]">{new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button size="sm" variant="outline" className="bg-transparent text-foreground border-white/20 hover:bg-white/5">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Source
                      </Button>
                    </a>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleLike(article.id);
                    }}
                  >
                    <Heart className={`w-6 h-6 ${likedIds.has(article.id) ? "fill-current text-foreground" : "text-muted-foreground"}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(article.sourceId);
                    }}
                    title={isFavorite(article.sourceId) ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star className={`w-6 h-6 transition-colors ${isFavorite(article.sourceId) ? "fill-current text-foreground" : "text-muted-foreground"}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-12 w-12"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleBookmark(article.id);
                    }}
                  >
                    <Bookmark className={`w-6 h-6 ${bookmarkIds.has(article.id) ? "fill-current text-foreground" : "text-muted-foreground"}`} />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => setIsArticleModalOpen(false)}
        onBookmarkChange={handleModalBookmarkChange}
      />
    </>
  );
}
