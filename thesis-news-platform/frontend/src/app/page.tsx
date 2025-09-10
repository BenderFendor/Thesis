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
        // For loading more, append new articles (simulated pagination)
        const newArticles = data.articles.slice(articles.length, articles.length + 6);
        setArticles(prev => [...prev, ...newArticles]);
        setHasMoreArticles(data.articles.length > articles.length + newArticles.length);
      }
    } catch (error) {
      console.error('Error fetching news:', error);
      if (reset) setArticles([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedCategory, articles.length, backendReady]);

  // Handle backend ready
  const handleBackendReady = () => {
    setBackendReady(true);
  };

  // Handle retry
  const handleRetry = () => {
    setBackendReady(false);
    setInitialLoad(false);
    setArticles([]);
  };

  // Load articles when backend is ready
  useEffect(() => {
    if (backendReady && !initialLoad) {
      fetchNews(true);
    }
  }, [backendReady, fetchNews, initialLoad]);

  // Load more articles when reaching the bottom
  const loadMoreArticles = useCallback(() => {
    if (!loadingMore && hasMoreArticles && backendReady) {
      setCurrentLimit(prev => prev + 6);
      fetchNews(false, currentLimit + 6);
    }
  }, [loadingMore, hasMoreArticles, fetchNews, currentLimit, backendReady]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && view === 'grid' && backendReady) {
          loadMoreArticles();
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [loadMoreArticles, view, backendReady]);

  // Fetch news when category changes
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

  // Add new articles dynamically with animation
  const [animatingArticles, setAnimatingArticles] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (articles.length > 0 && initialLoad) {
      const newIndices = new Set(Array.from({ length: 6 }, (_, i) => articles.length - 6 + i).filter(i => i >= 0));
      setAnimatingArticles(newIndices);
      
      setTimeout(() => {
        setAnimatingArticles(new Set());
      }, 600);
    }
  }, [articles.length, initialLoad]);

  // Show backend status if not ready
  if (!backendReady) {
    return (
      <div className="min-h-screen bg-black">
        {/* Header */}
        <header className="bg-gray-900/90 backdrop-blur-sm border-b border-gray-800/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <Globe className="h-8 w-8 text-blue-500" />
                <h1 className="text-2xl font-bold text-white">
                  Global News
                </h1>
              </div>
            </div>
          </div>
        </header>

        {/* Backend Status */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackendStatus onBackendReady={handleBackendReady} onRetry={handleRetry} />
        </main>
      </div>
    );
  }

  if (view === 'tiktok') {
    return <TikTokView articles={filteredArticles} />;
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="bg-gray-900/90 backdrop-blur-sm border-b border-gray-800/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Globe className="h-8 w-8 text-blue-500" />
              <h1 className="text-2xl font-bold text-white">
                Global News
              </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* View Toggle */}
              <ViewToggle view={view} onViewChange={setView} />
              
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search news..."
                  className="pl-10 pr-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-400 backdrop-blur-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Refresh Button */}
              <button
                onClick={() => fetchNews(true)}
                disabled={loading}
                className="p-2 bg-gray-800/50 border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Category Tabs */}
        <div className="mb-8">
          <CategoryTabs 
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
          />
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* News Grid */}
        {!loading && initialLoad && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredArticles.map((article, index) => (
              <div
                key={`${article.link}-${index}`}
                className={`transition-all duration-600 ${
                  animatingArticles.has(index) 
                    ? 'opacity-0 translate-y-4 scale-95' 
                    : 'opacity-100 translate-y-0 scale-100'
                }`}
                style={{
                  animationDelay: `${(index % 6) * 100}ms`,
                }}
              >
                <NewsCard article={article} />
              </div>
            ))}
          </div>
        )}

        {/* Loading More Indicator */}
        {loadingMore && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonCard key={`loading-${i}`} />
            ))}
          </div>
        )}

        {/* No Articles Found */}
        {!loading && initialLoad && filteredArticles.length === 0 && (
          <div className="text-center py-12">
            <Globe className="mx-auto h-16 w-16 text-gray-600 mb-4" />
            <h3 className="text-xl font-medium text-white mb-2">
              No articles found
            </h3>
            <p className="text-gray-400">
              Try adjusting your search or category filter.
            </p>
          </div>
        )}

        {/* Infinite Scroll Trigger */}
        <div ref={observerRef} className="h-10 mt-8" />

        {/* Load More Button (fallback) */}
        {!loadingMore && hasMoreArticles && filteredArticles.length > 0 && initialLoad && (
          <div className="text-center mt-8">
            <button
              onClick={loadMoreArticles}
              className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <Loader2 className="w-4 h-4 mr-2" />
              Load More Articles
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
