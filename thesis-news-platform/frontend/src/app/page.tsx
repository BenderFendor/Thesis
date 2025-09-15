'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Globe, Search, Loader2, RefreshCw } from 'lucide-react';
import NewsCard from '@/components/NewsCard';
import CategoryTabs from '@/components/CategoryTabs';
import TikTokView from '@/components/TikTokView';
import ViewToggle from '@/components/ViewToggle';
import SkeletonCard from '@/components/SkeletonCard';
import BackendStatus from '@/components/BackendStatus';
import { NewsArticle, NewsResponse } from '@/types';
import { API_ENDPOINTS, apiCall } from '@/config/api';

export default function Home() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [initialLoad, setInitialLoad] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState<'grid' | 'tiktok'>('grid');
  const [hasMoreArticles, setHasMoreArticles] = useState(true);
  const [currentLimit, setCurrentLimit] = useState(12);
  const observerRef = useRef<HTMLDivElement>(null);

  const fetchNews = useCallback(async (reset = false, limit = 12) => {
    if (!backendReady) return;
    
    try {
      if (reset) {
        setLoading(true);
        setArticles([]);
      } else {
        setLoadingMore(true);
      }

      const data: NewsResponse = await apiCall(
        `${API_ENDPOINTS.news}?limit=${limit}&category=${selectedCategory}`
      );
      
      if (reset) {
        setArticles(data.articles);
        setInitialLoad(true);
      } else {
        const newArticles = data.articles.slice(articles.length, articles.length + 6);
        setArticles(prev => [...prev, ...newArticles]);
        setHasMoreArticles(data.articles.length > articles.length + newArticles.length);
      }
    } catch (error) {
      console.error('Error fetching news:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedCategory, backendReady, articles.length]);

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setCurrentLimit(12);
    setHasMoreArticles(true);
  };

  const loadMoreArticles = useCallback(() => {
    if (!loadingMore && hasMoreArticles && articles.length > 0) {
      const newLimit = currentLimit + 6;
      setCurrentLimit(newLimit);
      fetchNews(false, newLimit);
    }
  }, [fetchNews, loadingMore, hasMoreArticles, articles.length, currentLimit]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!observerRef.current || view === 'tiktok') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreArticles();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(observerRef.current);

    return () => observer.disconnect();
  }, [loadMoreArticles, view, backendReady]);

  // Fetch news when category changes or backend becomes ready
  useEffect(() => {
    if (backendReady) {
      setCurrentLimit(12);
      setHasMoreArticles(true);
      fetchNews(true);
    }
  }, [selectedCategory, backendReady]);

  // Filter articles based on search
  const filteredArticles = articles.filter(article =>
    article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    article.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Show backend status if not ready
  if (!backendReady) {
    return (
      <div className="min-h-screen" style={{ background: 'rgb(12, 12, 12)' }}>
        <header className="glass border-b border-gray-800/50 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-green-500 to-blue-500">
                  <Globe className="h-6 w-6 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-gradient">Global News</h1>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackendStatus 
            onBackendReady={() => setBackendReady(true)} 
            onRetry={() => window.location.reload()} 
          />
        </main>
      </div>
    );
  }

  if (view === 'tiktok') {
    return <TikTokView articles={filteredArticles} />;
  }

  return (
    <div className="min-h-screen" style={{ background: 'rgb(12, 12, 12)' }}>
      {/* Header */}
      <header className="glass border-b border-gray-800/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-green-500 to-blue-500">
                <Globe className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gradient">Global News</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <ViewToggle view={view} onViewChange={setView} />
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search news..."
                  className="pl-10 pr-4 py-2 bg-gray-900/80 border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <button
                onClick={() => fetchNews(true)}
                disabled={loading}
                className="btn-secondary p-2 rounded-lg disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Category Navigation */}
      <div className="sticky top-16 z-40 glass border-b border-gray-800/30 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <CategoryTabs
            selectedCategory={selectedCategory}
            onCategoryChange={handleCategoryChange}
          />
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Loading State */}
        {loading && !initialLoad && (
          <div className="snap-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="snap-item">
                <SkeletonCard />
              </div>
            ))}
          </div>
        )}

        {/* News Grid with Snap Scrolling */}
        {!loading && initialLoad && filteredArticles.length > 0 && (
          <div className="snap-container">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {filteredArticles.map((article, index) => (
                <div
                  key={`${article.link}-${index}`}
                  className="snap-item"
                  style={{ animationDelay: `${(index % 6) * 100}ms` }}
                >
                  <NewsCard article={article} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && initialLoad && filteredArticles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="text-6xl opacity-50">📰</div>
            <h3 className="text-xl font-semibold text-gray-300">No articles found</h3>
            <p className="text-gray-500">Try adjusting your search or category filters</p>
          </div>
        )}

        {/* Load More Section */}
        {hasMoreArticles && filteredArticles.length > 0 && (
          <div ref={observerRef} className="flex justify-center mt-12">
            {loadingMore ? (
              <div className="flex items-center space-x-2 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin text-green-500" />
                <span>Loading more articles...</span>
              </div>
            ) : (
              <button
                onClick={() => fetchNews(false, currentLimit + 6)}
                className="btn-primary px-6 py-3 rounded-lg font-medium"
              >
                Load More Articles
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
