"use client";

import { useState, useEffect, useCallback } from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { type NewsArticle, fetchBookmarks, createBookmark, deleteBookmark } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Bookmark, ExternalLink, Eye, Star } from "lucide-react";
import { ArticleDetailModal } from "./article-detail-modal";
import { get_logger } from "@/lib/utils";
import { useFavorites } from "@/hooks/useFavorites";

const logger = get_logger("FeedView")

interface FeedViewProps {
  articles: NewsArticle[];
  loading: boolean;
}

export function FeedView({ articles, loading }: FeedViewProps) {
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set());
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<number>>(new Set());
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();

  // Load bookmarks on mount
  useEffect(() => {
    const loadBookmarks = async () => {
      try {
        const entries = await fetchBookmarks();
        setBookmarkedArticles(new Set(entries.map(entry => entry.articleId)));
      } catch (error) {
        logger.error('Failed to load bookmarks:', error);
      }
    };

    loadBookmarks();
  }, []);

  const handleLike = (articleId: number) => {
    setLikedArticles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(articleId)) {
        newSet.delete(articleId);
      } else {
        newSet.add(articleId);
      }
      return newSet;
    });
  };

  const handleBookmark = async (articleId: number) => {
    if (!articleId) return;

    const isBookmarked = bookmarkedArticles.has(articleId);
    const previousSet = new Set(bookmarkedArticles);
    const updatedSet = new Set(bookmarkedArticles);

    if (isBookmarked) {
      updatedSet.delete(articleId);
    } else {
      updatedSet.add(articleId);
    }

    setBookmarkedArticles(updatedSet);

    try {
      if (isBookmarked) {
        await deleteBookmark(articleId);
      } else {
        await createBookmark(articleId);
      }
    } catch (error) {
      logger.error('Failed to toggle bookmark:', error);
      setBookmarkedArticles(previousSet);
    }
  };

  const handleModalBookmarkChange = (articleId: number, isBookmarked: boolean) => {
    setBookmarkedArticles(prev => {
      const next = new Set(prev);
      if (isBookmarked) {
        next.add(articleId);
      } else {
        next.delete(articleId);
      }
      return next;
    });
  };

  const handleArticlePreview = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
    setIsArticleModalOpen(true);
  }, []);

  if (loading) {
    return <div className="h-screen w-full flex items-center justify-center bg-black text-white">Loading...</div>;
  }

  if (articles.length === 0) {
    return <div className="h-screen w-full flex items-center justify-center bg-black text-white">No articles found.</div>;
  }

  return (
    <>
      <div className="relative flex-1 h-full min-h-0 w-full overflow-y-auto snap-y snap-mandatory scroll-smooth bg-black text-white">
        <FixedSizeList
          height={window.innerHeight}
          width="100%"
          itemSize={600}
          itemCount={articles.length}
          overscanCount={3}
        >
          {({ index, style }: ListChildComponentProps) => {
            const article = articles[index];
            return (
              <section
                key={article.id}
                style={style}
                className="snap-start h-full min-h-full w-full relative"
              >
                <img src={article.image || '/placeholder.svg'} alt={article.title} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                <div className="relative z-10 h-full flex flex-col justify-end p-6">
                  <div className="absolute top-6 left-6 flex flex-wrap gap-2">
                    <Badge variant="secondary">{article.category}</Badge>
                    <Badge variant={article.credibility === 'high' ? 'default' : article.credibility === 'medium' ? 'secondary' : 'destructive'}>{article.credibility} credibility</Badge>
                  </div>
                  <div className="flex items-end gap-4">
                    <div className="flex-1 space-y-4">
                      <h1 className="text-3xl font-bold leading-tight text-balance drop-shadow-lg">{article.title}</h1>
                      <p className="text-base text-white/85 line-clamp-3 max-w-2xl drop-shadow">{article.summary}</p>
                      <div className="flex items-center gap-3">
                        <Button size="sm" variant="secondary" onClick={() => handleArticlePreview(article)}>
                          <Eye className="w-4 h-4 mr-2" />
                          Read More
                        </Button>
                        <a href={article.url} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="bg-transparent text-white border-white/50 hover:bg-white/10">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Source
                          </Button>
                        </a>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-4">
                      <Button variant="ghost" size="icon" className="h-12 w-12" onClick={() => handleLike(article.id)}>
                        <Heart className={`w-6 h-6 ${likedArticles.has(article.id) ? "fill-red-500 text-red-500" : ""}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-12 w-12" onClick={() => toggleFavorite(article.sourceId)} title={isFavorite(article.sourceId) ? "Remove from favorites" : "Add to favorites"}>
                        <Star className={`w-6 h-6 transition-colors ${isFavorite(article.sourceId) ? "fill-yellow-500 text-yellow-500" : ""}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-12 w-12" onClick={() => void handleBookmark(article.id)}>
                        <Bookmark className={`w-6 h-6 ${bookmarkedArticles.has(article.id) ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            );
          }}
        </FixedSizeList>
      </div>
      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => setIsArticleModalOpen(false)}
        initialIsBookmarked={selectedArticle ? bookmarkedArticles.has(selectedArticle.id) : false}
        onBookmarkChange={handleModalBookmarkChange}
      />
    </>
  );
}
