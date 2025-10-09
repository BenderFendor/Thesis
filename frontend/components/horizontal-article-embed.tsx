import React, { useEffect, useState } from 'react';
import { fetchNews, NewsArticle } from '../lib/api';
import { Card } from './ui/card';
import { Badge } from './ui/badge';


interface HorizontalArticleEmbedProps {
  articles?: NewsArticle[];
  category?: string;
  limit?: number;
  onArticleClick?: (article: NewsArticle) => void;
}

const HorizontalArticleEmbed: React.FC<HorizontalArticleEmbedProps> = ({ 
  articles: providedArticles,
  category = 'technology', 
  limit = 5,
  onArticleClick
}) => {
  const [articles, setArticles] = useState<NewsArticle[]>(providedArticles || []);
  const [loading, setLoading] = useState(!providedArticles);

  useEffect(() => {
    console.log('HorizontalArticleEmbed received articles:', providedArticles);
    
    // If articles are provided as props, use them directly
    if (providedArticles) {
      setArticles(providedArticles);
      setLoading(false);
      return;
    }

    // Otherwise, fetch articles
    const getArticles = async () => {
      setLoading(true);
      try {
        const data = await fetchNews({ category, limit });
        setArticles(data || []);
      } catch (err) {
        setArticles([]);
      }
      setLoading(false);
    };
    getArticles();
  }, [category, limit, providedArticles]);

  console.log('HorizontalArticleEmbed rendering with articles:', articles, 'loading:', loading);
  
  if (loading) return <div className="py-4 text-center text-sm text-muted-foreground">Loading articles...</div>;
  if (!articles.length) return null;

  return (
    <div className="grid grid-cols-1 gap-3 my-3">
      {articles.map(article => (
        <button
          key={article.id}
          onClick={() => onArticleClick?.(article)}
          className="text-left w-full"
        >
          <Card className="overflow-hidden hover:border-primary hover:shadow-lg transition-all duration-200 group">
            <div className="flex gap-3 p-3">
              {article.image && (
                <div className="w-32 h-24 flex-shrink-0 overflow-hidden rounded-md bg-black/40 border" style={{ borderColor: 'var(--border)' }}>
                  <img
                    src={article.image}
                    alt={article.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-sm line-clamp-2 group-hover:text-primary transition-colors flex-1">
                    {article.title}
                  </h3>
                  <Badge variant="secondary" className="text-xs flex-shrink-0">{article.source}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{article.summary}</p>
                {article.country && (
                  <div className="flex items-center gap-1 mt-auto">
                    <span className="text-xs text-muted-foreground">📍 {article.country}</span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
};

export default HorizontalArticleEmbed;
