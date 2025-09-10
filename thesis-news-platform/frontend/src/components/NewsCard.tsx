'use client';

import { ExternalLink, Clock, Building } from 'lucide-react';
import { NewsArticle } from '@/types';

interface NewsCardProps {
  article: NewsArticle;
}

export default function NewsCard({ article }: NewsCardProps) {
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
      'BBC': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      'CNN': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      'Reuters': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      'NPR': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      'Fox News': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      'Associated Press': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    };
    return colors[source] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <div className="p-6">
        {/* Source and Date */}
        <div className="flex items-center justify-between mb-3">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSourceColor(article.source)}`}>
            <Building className="w-3 h-3 mr-1" />
            {article.source}
          </span>
          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
            <Clock className="w-4 h-4 mr-1" />
            {formatDate(article.published)}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 line-clamp-2">
          {article.title}
        </h3>

        {/* Description */}
        <p className="text-gray-600 dark:text-gray-300 text-sm mb-4 line-clamp-3">
          {article.description.replace(/<[^>]*>/g, '')} {/* Strip HTML tags */}
        </p>

        {/* Category */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
            {article.category}
          </span>
          
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium"
          >
            Read more
            <ExternalLink className="w-4 h-4 ml-1" />
          </a>
        </div>
      </div>
    </div>
  );
}
