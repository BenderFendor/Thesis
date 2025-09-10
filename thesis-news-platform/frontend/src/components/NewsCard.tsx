'use client';

import { ExternalLink, Clock, Building, Image as ImageIcon } from 'lucide-react';
import { NewsArticle } from '@/types';
import { useState } from 'react';

interface NewsCardProps {
  article: NewsArticle;
}

export default function NewsCard({ article }: NewsCardProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

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

  return (
    <div className="bg-gray-900/95 backdrop-blur-sm rounded-xl shadow-2xl hover:shadow-3xl transition-all duration-300 overflow-hidden border border-gray-700/30 hover:border-gray-600/50 group hover:transform hover:scale-[1.02]">
      {/* Article Image */}
      {article.image && !imageError && (
        <div className="relative h-48 bg-gray-800 overflow-hidden">
          {imageLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          )}
          <img
            src={article.image}
            alt={article.title}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-110 ${
              imageLoading ? 'opacity-0' : 'opacity-100'
            }`}
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageError(true);
              setImageLoading(false);
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900/60 via-transparent to-transparent" />
        </div>
      )}
      
      {/* Fallback placeholder when no image or error */}
      {(!article.image || imageError) && (
        <div className="h-48 bg-gradient-to-br from-gray-800 via-gray-850 to-gray-900 flex items-center justify-center">
          <ImageIcon className="h-16 w-16 text-gray-600 group-hover:text-gray-500 transition-colors" />
        </div>
      )}

      <div className="p-6 space-y-4">
        {/* Source and Date */}
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getSourceColor(article.source)}`}>
            <Building className="w-3 h-3 mr-1.5" />
            {article.source}
          </span>
          <div className="flex items-center text-xs text-gray-400">
            <Clock className="w-3 h-3 mr-1" />
            {formatDate(article.published)}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold text-white line-clamp-2 group-hover:text-blue-400 transition-colors leading-tight">
          {article.title}
        </h3>

        {/* Description */}
        <p className="text-gray-300 text-sm line-clamp-3 leading-relaxed">
          {article.description.replace(/<[^>]*>/g, '')} {/* Strip HTML tags */}
        </p>

        {/* Category and Read More */}
        <div className="flex items-center justify-between pt-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
            {article.category}
          </span>
          
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-blue-400 hover:text-blue-300 text-sm font-medium transition-all group-hover:translate-x-1"
          >
            Read more
            <ExternalLink className="w-4 h-4 ml-1" />
          </a>
        </div>
      </div>
    </div>
  );
}
