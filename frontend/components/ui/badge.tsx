import type { ReactElement } from 'react';
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'
import { cva } from 'class-variance-authority';

type BadgeChild = Readonly<ReactElement> | string | number | readonly BadgeChild[]

interface BadgeStyle {
  readonly backgroundColor?: string
  readonly color?: string
}

interface BadgeProps {
  readonly asChild?: boolean
  readonly children?: BadgeChild
  readonly className?: string
  readonly onClick?: () => void
  readonly style?: BadgeStyle
  readonly title?: string
  readonly variant?: 'default' | 'destructive' | 'outline' | 'secondary'
}

const Badge = (props: BadgeProps) => {
  const {
    asChild = false,
    children,
    className,
    onClick,
    style,
    title,
    variant,
  } = props,
   badgeClassName = cn(badgeVariants({ variant }), className)

  if (asChild) {
    return (
      <Slot
        className={badgeClassName}
        data-slot="badge"
        onClick={onClick}
        style={style}
        title={title}
      >
        {children}
      </Slot>
    )
  }

  if (onClick) {
    return (
      <button
        className={badgeClassName}
        data-slot="badge"
        onClick={onClick}
        style={style}
        title={title}
        type="button"
      >
        {children}
      </button>
    )
  }

  return (
    <span className={badgeClassName} data-slot="badge" style={style} title={title}>
      {children}
    </span>
  )
},
 badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
      },
    },
  },
)

export { Badge, badgeVariants }
