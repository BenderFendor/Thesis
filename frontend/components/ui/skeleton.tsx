import type { FunctionComponent } from 'react'

import { cn } from '@/lib/utils'

interface SkeletonProps {
  readonly className?: string
}

const Skeleton: FunctionComponent<Readonly<SkeletonProps>> = (props) => {
  const { className } = props;

  return (
    <div className={cn('animate-pulse rounded-md bg-muted', className)} />
  );
};


export { Skeleton }
