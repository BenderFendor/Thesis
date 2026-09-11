import { Skeleton } from "@/components/ui/skeleton";

const TrendingSkeletonHeader = () => (
  <div className="flex items-center gap-4">
    <Skeleton className="w-6 h-6" />
    <Skeleton className="h-8 w-44 sm:h-10 sm:w-64" />
  </div>
);

const TrendingSkeletonMedia = () => (
  <div className="m-1.5 sm:m-2">
    <Skeleton className="aspect-[4/3] w-full rounded-md sm:aspect-video sm:rounded-lg" />
  </div>
);

const TrendingSkeletonText = () => (
  <div className="space-y-2 p-2 sm:space-y-3 sm:p-4">
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-3 w-2/3" />
  </div>
);

const TrendingSkeletonCard = ({ index }: Readonly<{ index: number }>) => (
  <div
    className="overflow-hidden rounded-lg border border-white/5 bg-black/20 sm:rounded-lg"
    key={index}
  >
    <TrendingSkeletonMedia />
    <TrendingSkeletonText />
  </div>
);

const TrendingSkeletonGrid = () => (
  <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
    {[1, 2, 3, 4, 5].map((index) => (
      <TrendingSkeletonCard key={index} index={index} />
    ))}
  </div>
);

const TrendingSkeleton = () => (
  <div className="flex flex-col space-y-3 sm:space-y-6">
    <div className="flex items-center justify-between border-b border-white/5 pb-3 sm:pb-6">
      <TrendingSkeletonHeader />
    </div>
    <TrendingSkeletonGrid />
  </div>
);

export { TrendingSkeleton };
