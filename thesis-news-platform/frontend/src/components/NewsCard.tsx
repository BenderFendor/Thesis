import Image from 'next/image';
import { ExternalLink, Clock, Tag } from 'lucide-react';
import { NewsArticle } from '@/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { AspectRatio } from '@/components/ui/aspect-ratio';

interface NewsCardProps {
  article: NewsArticle;
}

export default function NewsCard({ article }: NewsCardProps) {
  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Recently';
    }
  };

  const getCategoryColor = (category: string) => {
    const colors = {
      tech: 'from-blue-500 to-cyan-500',
      politics: 'from-red-500 to-pink-500',
      business: 'from-green-500 to-emerald-500',
      sports: 'from-orange-500 to-yellow-500',
      entertainment: 'from-purple-500 to-indigo-500',
      health: 'from-teal-500 to-green-500',
      science: 'from-indigo-500 to-blue-500',
      general: 'from-gray-500 to-slate-500',
    };
    return colors[category as keyof typeof colors] || colors.general;
  };

  return (
    <Card className="relative group bg-neutral-950 border-neutral-800 shadow-lg hover:shadow-xl transition-shadow duration-300">
      <CardHeader className="p-0 relative overflow-hidden rounded-t-xl">
        <AspectRatio ratio={16 / 9} className="w-full">
          {article.image ? (
            <Image
              src={article.image}
              alt={article.title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105 rounded-t-xl"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center rounded-t-xl">
              <div className="text-4xl opacity-30">📰</div>
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80 group-hover:opacity-100 transition-opacity duration-300 rounded-t-xl" />
          {/* Category badge */}
          <div className="absolute top-3 left-3 z-10">
            <span className={`category-pill bg-gradient-to-r ${getCategoryColor(article.category)}`}>
              <Tag className="w-3 h-3" />
              {article.category}
            </span>
          </div>
        </AspectRatio>
      </CardHeader>
      <CardContent className="flex flex-col justify-between flex-1 px-6 py-4">
        <div className="space-y-3">
          <CardTitle className="text-lg font-semibold text-white leading-tight group-hover:text-green-400 transition-colors duration-200 line-clamp-2">
            {article.title}
          </CardTitle>
          <p className="text-gray-400 text-sm leading-relaxed line-clamp-3">
            {article.description}
          </p>
        </div>
      </CardContent>
      <CardFooter className="mt-4 pt-4 border-t border-neutral-800 flex items-center justify-between px-6 pb-4">
        <div className="flex items-center space-x-2 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          <span>{formatDate(article.published)}</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500">{article.source}</span>
          <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-green-400 transition-colors duration-200" />
        </div>
      </CardFooter>
      {/* Click overlay */}
      <a
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute inset-0 z-10"
        aria-label={`Read more: ${article.title}`}
      />
    </Card>
  );
}
