import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface SharedProps {
  active?: boolean
  badge?: number
  description: string
  expanded: boolean
  icon: LucideIcon
  label: string
}

type LinkProps = SharedProps & {
  href: string
  onClick?: never
  onFocus?: never
  onPointerEnter?: never
}

type ButtonProps = SharedProps & {
  href?: never
  onClick: () => void
  onFocus?: () => void
  onPointerEnter?: () => void
}

type SidebarNavigationItemProps = LinkProps | ButtonProps

const itemClassName =
  "group/item relative flex min-h-11 w-full items-center overflow-hidden rounded-lg border border-transparent text-left text-xs font-mono uppercase tracking-[0.16em] transition-[background-color,border-color,color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--news-bg-secondary)]"

export function SidebarNavigationItem({
  active = false,
  badge = 0,
  description,
  expanded,
  icon: Icon,
  label,
  ...actionProps
}: SidebarNavigationItemProps) {
  const content = (
    <>
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
        {badge > 0 && (
          <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 whitespace-nowrap transition-[width,opacity,transform] duration-200",
          expanded
            ? "flex-1 translate-x-0 opacity-100"
            : "pointer-events-none w-0 flex-none -translate-x-1 opacity-0",
        )}
      >
        <span className="block truncate">{label}</span>
        <span className="mt-0.5 block truncate font-sans text-[11px] normal-case tracking-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </>
  )

  const className = cn(
    itemClassName,
    expanded ? "justify-start gap-3 px-3" : "justify-center gap-0 px-0",
    active
      ? "border-primary/35 bg-primary/[0.12] text-primary"
      : "text-muted-foreground hover:border-white/10 hover:bg-white/[0.05] hover:text-foreground",
  )

  if ("href" in actionProps && actionProps.href) {
    return (
      <Link
        href={actionProps.href}
        className={className}
        aria-current={active ? "page" : undefined}
        aria-label={expanded ? undefined : label}
        title={expanded ? undefined : label}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={className}
      onClick={actionProps.onClick}
      onFocus={actionProps.onFocus}
      onPointerEnter={actionProps.onPointerEnter}
      aria-current={active ? "page" : undefined}
      aria-label={expanded ? undefined : label}
      title={expanded ? undefined : label}
    >
      {content}
    </button>
  )
}
