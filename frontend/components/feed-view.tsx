"use client"

import { useState, useEffect, useRef, useCallback } from "react";
import { type NewsArticle } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, MessageCircle, Share2, Bookmark, ExternalLink, ChevronUp, ChevronDown, Eye, Info } from "lucide-react";
import { ArticleDetailModal } from "./article-detail-modal";

interface FeedViewProps {
  articles: NewsArticle[];
  loading: boolean;
}

export function FeedView({ articles, loading }: FeedViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedArticles, setLikedArticles] = useState<Set<number>>(new Set());
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<number>>(new Set());
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((direction: "up" | "down") => {
    if (direction === "up") {
      setCurrentIndex((prev) => Math.max(0, prev - 1));
    } else {
      setCurrentIndex((prev) => Math.min(articles.length - 1, prev + 1));
    }
  }, [articles.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({
        top: currentIndex * container.clientHeight,
        behavior: 'smooth',
      });
    }
  }, [currentIndex]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY < 0) {
        handleScroll("up");
      } else {
        handleScroll("down");
      }
    };

    const container = containerRef.current;
    container?.addEventListener('wheel', handleWheel, { passive: false });
    return () => container?.removeEventListener('wheel', handleWheel);
  }, [handleScroll]);

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

  const handleBookmark = (articleId: number) => {
    setBookmarkedArticles(prev => {
        const newSet = new Set(prev);
        if (newSet.has(articleId)) {
            newSet.delete(articleId);
        } else {
            newSet.add(articleId);
        }
        return newSet;
    });
  };

  if (loading) {
    return <div className="h-screen w-full flex items-center justify-center bg-black text-white">Loading...</div>;
  }

  if (articles.length === 0) {
    return <div className="h-screen w-full flex items-center justify-center bg-black text-white">No articles found.</div>;
  }

  return (
    <>
      <div ref={containerRef} className="h-screen w-full overflow-y-scroll snap-y snap-mandatory scroll-smooth">
        {articles.map((article, index) => (
          <div key={article.id} className="h-full w-full snap-start flex-shrink-0 relative bg-black">
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
                  <Button variant="ghost" size="icon" className="h-10 w-10 flex-col gap-1" onClick={() => handleLike(article.id)}>
                    <Heart className={`w-5 h-5 ${likedArticles.has(article.id) ? "fill-red-500 text-red-500" : ""}`} />
                    <span className="text-xs">{article.likes + (likedArticles.has(article.id) ? 1 : 0)}</span>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10 flex-col gap-1">
                    <MessageCircle className="w-5 h-5" />
                    <span className="text-xs">{article.comments}</span>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10 flex-col gap-1">
                    <Share2 className="w-5 h-5" />
                    <span className="text-xs">{article.shares}</span>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => handleBookmark(article.id)}>
                    <Bookmark className={`w-5 h-5 ${bookmarkedArticles.has(article.id) ? "fill-yellow-400 text-yellow-400" : ""}`} />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <ArticleDetailModal article={selectedArticle} isOpen={isArticleModalOpen} onClose={() => setIsArticleModalOpen(false)} />
    </>
  );
}
