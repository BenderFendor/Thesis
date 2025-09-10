'use client';

interface SkeletonCardProps {
  className?: string;
}

export default function SkeletonCard({ className = "" }: SkeletonCardProps) {
  return (
    <div className={`bg-gray-900/90 backdrop-blur-sm rounded-xl overflow-hidden border border-gray-700/50 ${className}`}>
      {/* Image skeleton */}
      <div className="h-48 bg-gradient-to-br from-gray-800 to-gray-700 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
      </div>
      
      <div className="p-6">
        {/* Source and date skeleton */}
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 bg-gray-700 rounded-full w-20 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
          <div className="h-4 bg-gray-700 rounded w-16 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
        </div>

        {/* Title skeleton */}
        <div className="space-y-2 mb-3">
          <div className="h-5 bg-gray-700 rounded w-full relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
          <div className="h-5 bg-gray-700 rounded w-3/4 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
        </div>

        {/* Description skeleton */}
        <div className="space-y-2 mb-4">
          <div className="h-3 bg-gray-700 rounded w-full relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
          <div className="h-3 bg-gray-700 rounded w-full relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
          <div className="h-3 bg-gray-700 rounded w-2/3 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
        </div>

        {/* Category and link skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-6 bg-gray-700 rounded-full w-16 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
          <div className="h-4 bg-gray-700 rounded w-20 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
