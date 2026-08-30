import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const Skeleton = ({
  className,
  children,
}: Readonly<HTMLAttributes<HTMLDivElement>>) => {
  return (
    <div className={cn('animate-pulse rounded-md bg-muted', className)}>
      {children}
    </div>
  )
}

export { Skeleton }
