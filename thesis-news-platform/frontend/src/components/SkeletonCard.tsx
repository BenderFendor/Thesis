export default function SkeletonCard() {
  return (
    <article className="news-card animate-pulse h-full">
      {/* Image skeleton */}
      <div className="relative overflow-hidden rounded-t-xl h-48 bg-gray-800">
        <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-700 shimmer" />
        
        {/* Category badge skeleton */}
        <div className="absolute top-3 left-3">
          <div className="w-16 h-6 bg-gray-700 rounded-full shimmer" />
        </div>
      </div>

      <div className="p-6 flex flex-col justify-between flex-1 space-y-3">
        <div className="space-y-3">
          {/* Title skeleton */}
          <div className="space-y-2">
            <div className="h-4 bg-gray-700 rounded shimmer" />
            <div className="h-4 bg-gray-700 rounded w-3/4 shimmer" />
          </div>
          
          {/* Description skeleton */}
          <div className="space-y-2">
            <div className="h-3 bg-gray-800 rounded shimmer" />
            <div className="h-3 bg-gray-800 rounded shimmer" />
            <div className="h-3 bg-gray-800 rounded w-1/2 shimmer" />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
          {/* Date skeleton */}
          <div className="w-20 h-3 bg-gray-800 rounded shimmer" />
          
          {/* Source skeleton */}
          <div className="w-16 h-3 bg-gray-800 rounded shimmer" />
        </div>
      </div>
    </article>
  );
}
