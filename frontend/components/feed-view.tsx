"use client"

import { useState, useEffect, useCallback, useMemo } from "react";
import { type NewsArticle, fetchBookmarks, createBookmark, deleteBookmark } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Bookmark, ExternalLink, Eye } from "lucide-react";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { ArticleDetailModal } from "./article-detail-modal";
import { get_logger } from "@/lib/utils";

const logger = get_logger("FeedView")

interface FeedViewProps {
  articles: NewsArticle[];
  loading: boolean;
}

const ROW_HEIGHT = typeof window !== 'undefined' ? window.innerHeight : 900;

export function FeedView({ articles, loading }: FeedViewProps) {
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set());
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<number>>(new Set());
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);

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

  // Virtual row renderer for feed
  const FeedRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const article = articles[index];
      if (!article) return null;

      return (
        <div key={article.id} style={style} className="h-full w-full relative bg-black">
          <img src={article.image || '/placeholder.svg'} alt={article.title} className="absolute inset-0 w-full h-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <div className="relative z-10 h-full flex flex-col justify-end p-6 text-white">
            <div className="absolute top-6 left-6 flex gap-2">
              <Badge variant="secondary">{article.category}</Badge>
              <Badge variant={article.credibility === 'high' ? 'default' : article.credibility === 'medium' ? 'secondary' : 'destructive'}>{article.credibility} credibility</Badge>
            </div>
            <div className="flex items-end">
              <div className="flex-1 space-y-3">
                <h1 className="text-2xl font-bold leading-tight text-balance">{article.title}</h1>
                <p className="text-sm text-white/80 line-clamp-2">{article.summary}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setSelectedArticle(article); setIsArticleModalOpen(true); }}>
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
              <div className="flex flex-col items-center gap-3 ml-6">
                <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => handleLike(article.id)}>
                  <Heart className={`w-5 h-5 ${likedArticles.has(article.id) ? "fill-red-500 text-red-500" : ""}`} />
                </Button>
                <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => void handleBookmark(article.id)}>
                  <Bookmark className={`w-5 h-5 ${bookmarkedArticles.has(article.id) ? "fill-yellow-400 text-yellow-400" : ""}`} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    },
    [likedArticles, bookmarkedArticles],
  )

  if (loading) {
    return <div className="h-screen w-full flex items-center justify-center bg-black text-white">Loading...</div>;
  }

  if (articles.length === 0) {
    return <div className="h-screen w-full flex items-center justify-center bg-black text-white">No articles found.</div>;
  }

  return (
    <>
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <List
            itemCount={articles.length}
            itemSize={height}
            width={width}
            height={height}
            overscanCount={2}
          >
            {FeedRow}
          </List>
        )}
      </AutoSizer>
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
