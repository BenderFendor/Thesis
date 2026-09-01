import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface SidebarIconProps {
  readonly className?: string
  readonly strokeWidth?: number
}

type SidebarIcon = (props: SidebarIconProps) => ReactNode

interface SharedProps {
  readonly active?: boolean
  readonly badge?: number
  readonly description: string
  readonly expanded: boolean
  readonly icon: SidebarIcon
  readonly label: string
}

interface SidebarNavigationContentProps {
  readonly badge?: number
  readonly description: string
  readonly expanded: boolean
  readonly icon: SidebarIcon
  readonly label: string
}

interface SidebarNavigationLinkProps extends SidebarNavigationContentProps {
  readonly active?: boolean
  readonly href: string
}

interface SidebarNavigationButtonProps extends SidebarNavigationContentProps {
  readonly active?: boolean
  readonly handleClick?: () => void
  readonly handleFocus?: () => void
  readonly handlePointerEnter?: () => void
}

type LinkProps = SharedProps & {
  readonly href: string
  readonly onClick?: never
  readonly onFocus?: never
  readonly onPointerEnter?: never
}

type ButtonProps = SharedProps & {
  readonly href?: never
  readonly onClick: () => void
  readonly onFocus?: () => void
  readonly onPointerEnter?: () => void
}

type SidebarNavigationItemProps = LinkProps | ButtonProps

const DEFAULT_BADGE_COUNT = 0,
  MAX_BADGE_COUNT = 99,
  SidebarNavigationButton = ({
    active = false,
    badge = DEFAULT_BADGE_COUNT,
    description,
    expanded,
    icon: Icon,
    label,
    handleClick,
    handleFocus,
    handlePointerEnter,
  }: SidebarNavigationButtonProps) => (
    <button
      type="button"
      className={sidebarItemClassName(active, expanded)}
      onClick={handleClick}
      onFocus={handleFocus}
      onPointerEnter={handlePointerEnter}
      aria-current={getCurrentPageValue(active)}
      aria-label={getCollapsedLabelValue(expanded, label)}
      title={getCollapsedLabelValue(expanded, label)}
    >
      <SidebarNavigationContent
        badge={badge}
        description={description}
        expanded={expanded}
        icon={Icon}
        label={label}
      />
    </button>
  ),
  SidebarNavigationContent = ({
    badge = DEFAULT_BADGE_COUNT,
    description,
    expanded,
    icon: Icon,
    label,
  }: SidebarNavigationContentProps) => (
    <>
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
        {badge > DEFAULT_BADGE_COUNT && (
          <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
            {formatBadgeCount(badge)}
          </span>
        )}
      </span>
      <span className={getExpandedLabelClassName(expanded)}>
        <span className="block truncate">{label}</span>
        <span className="mt-0.5 block truncate font-sans text-[11px] normal-case tracking-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </>
  ),
  SidebarNavigationItem = ({
    active = false,
    badge = DEFAULT_BADGE_COUNT,
    description,
    expanded,
    icon: Icon,
    label,
    ...actionProps
  }: SidebarNavigationItemProps) => {
    if ("href" in actionProps && actionProps.href !== undefined && actionProps.href !== "") {
      return (
        <SidebarNavigationLink
          active={active}
          badge={badge}
          description={description}
          expanded={expanded}
          href={actionProps.href}
          icon={Icon}
          label={label}
        />
      )
    }

    return (
      <SidebarNavigationButton
        active={active}
        badge={badge}
        description={description}
        expanded={expanded}
        handleClick={actionProps.onClick}
        handleFocus={actionProps.onFocus}
        handlePointerEnter={actionProps.onPointerEnter}
        icon={Icon}
        label={label}
      />
    )
  },
  SidebarNavigationLink = ({
    active = false,
    badge = DEFAULT_BADGE_COUNT,
    description,
    expanded,
    href,
    icon: Icon,
    label,
  }: SidebarNavigationLinkProps) => (
    <Link
      href={href}
      className={sidebarItemClassName(active, expanded)}
      aria-current={getCurrentPageValue(active)}
      aria-label={getCollapsedLabelValue(expanded, label)}
      title={getCollapsedLabelValue(expanded, label)}
    >
      <SidebarNavigationContent
        badge={badge}
        description={description}
        expanded={expanded}
        icon={Icon}
        label={label}
      />
    </Link>
  ),
  formatBadgeCount = (badge: number): number | string => {
    if (badge > MAX_BADGE_COUNT) {return `${MAX_BADGE_COUNT}+`}
    return badge
  },
  getCollapsedLabelValue = (expanded: boolean, label: string): string | undefined => {
    if (expanded) {return undefined}
    return label
  },
  getCurrentPageValue = (active: boolean): "page" | undefined => {
    if (active) {return "page"}
    return undefined
  },
  getExpandedItemClassName = (expanded: boolean): string => {
    if (expanded) {return "justify-start gap-3 px-3"}
    return "justify-center gap-0 px-0"
  },
  getExpandedLabelClassName = (expanded: boolean): string => {
    if (expanded) {
      return "min-w-0 whitespace-nowrap transition-[width,opacity,transform] duration-200 flex-1 translate-x-0 opacity-100"
    }
    return "min-w-0 whitespace-nowrap transition-[width,opacity,transform] duration-200 pointer-events-none w-0 flex-none -translate-x-1 opacity-0"
  },
  itemClassName =
    "group/item relative flex min-h-11 w-full items-center overflow-hidden rounded-lg border border-transparent text-left text-xs font-mono uppercase tracking-[0.16em] transition-[background-color,border-color,color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--news-bg-secondary)]",
  sidebarItemClassName = (active: boolean, expanded: boolean): string => {
    const expansionClassName = getExpandedItemClassName(expanded)
    if (active) {
      return cn(itemClassName, expansionClassName, "border-primary/35 bg-primary/[0.12] text-primary")
    }
    return cn(itemClassName, expansionClassName, "text-muted-foreground hover:border-white/10 hover:bg-white/[0.05] hover:text-foreground")
  }

export { SidebarNavigationItem }
