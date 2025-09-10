'use client';

import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Clock, Building, ChevronUp, ChevronDown, Share2, Heart, MessageCircle } from 'lucide-react';
import { NewsArticle } from '@/types';

interface TikTokViewProps {
  articles: NewsArticle[];
}

export default function TikTokView({ articles }: TikTokViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likes, setLikes] = useState<Record<number, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const currentArticle = articles[currentIndex];

  const nextArticle = () => {
    if (currentIndex < articles.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const prevArticle = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const toggleLike = () => {
    setLikes(prev => ({
      ...prev,
      [currentIndex]: !prev[currentIndex]
    }));
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Recently';
    }
  };

  const getSourceColor = (source: string) => {
    const colors: { [key: string]: string } = {
      'BBC': 'bg-red-500/20 text-red-300 border-red-500/30',
      'CNN': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      'Reuters': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      'NPR': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      'Fox News': 'bg-green-500/20 text-green-300 border-green-500/30',
      'Associated Press': 'bg-gray-500/20 text-gray-300 border-gray-500/30'
    };
    return colors[source] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        prevArticle();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nextArticle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex]);

  if (!currentArticle) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">No articles available</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-screen bg-black relative overflow-hidden">
      {/* Background Image */}
      {currentArticle.image && (
        <div className="absolute inset-0">
          <img
            src={currentArticle.image}
            alt={currentArticle.title}
            className="w-full h-full object-cover opacity-30 blur-sm"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/30" />
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Navigation Controls */}
        <div className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 flex flex-col space-y-4">
          <button
            onClick={prevArticle}
            disabled={currentIndex === 0}
            className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/20 transition-colors"
          >
            <ChevronUp className="w-6 h-6 text-white" />
          </button>
          <button
            onClick={nextArticle}
            disabled={currentIndex === articles.length - 1}
            className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/20 transition-colors"
          >
            <ChevronDown className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* Social Actions */}
        <div className="absolute right-4 bottom-32 z-20 flex flex-col space-y-6">
          <button
            onClick={toggleLike}
            className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-colors"
          >
            <Heart className={`w-6 h-6 ${likes[currentIndex] ? 'text-red-500 fill-red-500' : 'text-white'}`} />
          </button>
          <button className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-colors">
            <MessageCircle className="w-6 h-6 text-white" />
          </button>
          <button className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 transition-colors">
            <Share2 className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* Article Content */}
        <div className="flex-1 flex flex-col justify-end p-6 pb-8">
          {/* Source and Date */}
          <div className="flex items-center justify-between mb-4">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${getSourceColor(currentArticle.source)}`}>
              <Building className="w-4 h-4 mr-2" />
              {currentArticle.source}
            </span>
            <div className="flex items-center text-sm text-gray-300">
              <Clock className="w-4 h-4 mr-1" />
              {formatDate(currentArticle.published)}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-4 leading-tight">
            {currentArticle.title}
          </h1>

          {/* Description */}
          <p className="text-gray-200 text-base mb-6 leading-relaxed max-w-3xl">
            {currentArticle.description.replace(/<[^>]*>/g, '').substring(0, 300)}
            {currentArticle.description.length > 300 && '...'}
          </p>

          {/* Category and Read More */}
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {currentArticle.category}
            </span>
            
            <a
              href={currentArticle.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white font-medium hover:bg-white/20 transition-colors"
            >
              Read Full Article
              <ExternalLink className="w-4 h-4 ml-2" />
            </a>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
          <div 
            className="h-full bg-white transition-all duration-300 ease-out"
            style={{ width: `${((currentIndex + 1) / articles.length) * 100}%` }}
          />
        </div>

        {/* Article Counter */}
        <div className="absolute top-4 left-4 z-20">
          <div className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm">
            {currentIndex + 1} / {articles.length}
          </div>
        </div>
      </div>
    </div>
  );
}
