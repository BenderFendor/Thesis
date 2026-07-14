"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Bell, ChevronLeft, ChevronRight } from "lucide-react"

import { SafeImage } from "@/components/safe-image"
import {
  LIBRARY_NAVIGATION,
  VIEW_NAVIGATION,
  WIKI_NAVIGATION,
  isViewMode,
  type ViewMode,
} from "@/components/navigation/navigation-config"
import { SidebarNavigationItem } from "@/components/navigation/sidebar-navigation-item"
import { SidebarSection } from "@/components/navigation/sidebar-section"
import { buildSearchHref, buildViewHref, SIDEBAR_EXPANDED_STORAGE_KEY } from "@/components/navigation/navigation-state"
import { WorkspaceSearch } from "@/components/navigation/workspace-search"
import { cn } from "@/lib/utils"

export type { ViewMode } from "@/components/navigation/navigation-config"

interface GlobalNavigationProps {
  currentView?: ViewMode
  onViewChange?: (view: ViewMode) => void
  onViewPreload?: (view: ViewMode) => void
  onAlertsClick?: () => void
  alertCount?: number
}

export function GlobalNavigation({
  currentView,
  onViewChange,
  onViewPreload,
  onAlertsClick,
  alertCount = 0,
}: GlobalNavigationProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    try {
      setExpanded(window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY) === "true")
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }, [])

  useEffect(() => {
    if (pathname !== "/" || !onViewChange) return
    const requestedView = searchParams.get("view")
    if (isViewMode(requestedView) && requestedView !== currentView) {
      onViewChange(requestedView)
    }
  }, [currentView, onViewChange, pathname, searchParams])

  const updateExpanded = useCallback((nextExpanded: boolean) => {
    setExpanded(nextExpanded)
    try {
      window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(nextExpanded))
    } catch {
      // The navigation remains functional without persistence.
    }
  }, [])

  const handleViewClick = useCallback(
    (view: ViewMode) => {
      if (pathname === "/" && onViewChange) {
        onViewChange(view)
        router.replace(buildViewHref(view), { scroll: false })
        return
      }
      router.push(buildViewHref(view))
    },
    [onViewChange, pathname, router],
  )

  const handleSearch = useCallback(
    (query: string) => {
      router.push(buildSearchHref(query))
    },
    [router],
  )

  return (
    <aside
      className={cn(
        "sticky top-0 z-50 hidden h-screen shrink-0 flex-col border-r border-white/10 bg-[var(--news-bg-secondary)]/95 shadow-[18px_0_60px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-[width] duration-300 lg:flex",
        expanded ? "w-72" : "w-[4.5rem]",
      )}
      aria-label="Primary workspace navigation"
      data-expanded={expanded}
    >
      <div className="flex h-[5.25rem] items-center border-b border-white/10 px-3">
        <Link
          href="/"
          className={cn(
            "flex min-w-0 flex-1 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            expanded ? "gap-3" : "justify-center",
          )}
          aria-label="Scoop dashboard"
        >
          <SafeImage
            src="/favicon.svg"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0"
            sizes="44px"
          />
          <span
            className={cn(
              "min-w-0 transition-[opacity,transform] duration-200",
              expanded ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-1 opacity-0",
            )}
            aria-hidden={!expanded}
          >
            <span className="block font-mono text-[9px] uppercase tracking-[0.32em] text-muted-foreground">
              Scoop
            </span>
            <span className="block truncate font-serif text-xl font-semibold tracking-tight text-foreground">
              News workspace
            </span>
          </span>
        </Link>
      </div>

      <button
        type="button"
        onClick={() => updateExpanded(!expanded)}
        className="absolute -right-3 top-[4.45rem] flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[var(--news-bg-secondary)] text-muted-foreground shadow-lg transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={expanded}
        aria-controls="primary-navigation-content"
        aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
        title={expanded ? "Collapse navigation" : "Expand navigation"}
      >
        {expanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      <div id="primary-navigation-content" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-white/10 p-3">
          <WorkspaceSearch
            expanded={expanded}
            onExpand={() => updateExpanded(true)}
            onSearch={handleSearch}
          />
        </div>

        <nav className="no-scrollbar flex-1 space-y-7 overflow-y-auto px-3 py-5" aria-label="Workspace">
          <SidebarSection expanded={expanded} label="Views">
            {VIEW_NAVIGATION.map((item) => (
              <SidebarNavigationItem
                key={item.key}
                expanded={expanded}
                label={item.label}
                description={item.description}
                icon={item.icon}
                active={pathname === "/" && currentView === item.key}
                onFocus={() => onViewPreload?.(item.key)}
                onPointerEnter={() => onViewPreload?.(item.key)}
                onClick={() => handleViewClick(item.key)}
              />
            ))}
          </SidebarSection>

          <SidebarSection expanded={expanded} label="Intelligence">
            {WIKI_NAVIGATION.map((item) => (
              <SidebarNavigationItem
                key={item.href}
                expanded={expanded}
                href={item.href}
                label={item.label}
                description={item.description}
                icon={item.icon}
                active={item.match(pathname)}
              />
            ))}
          </SidebarSection>

          <SidebarSection expanded={expanded} label="Library">
            {LIBRARY_NAVIGATION.map((item) => (
              <SidebarNavigationItem
                key={item.href}
                expanded={expanded}
                href={item.href}
                label={item.label}
                description={item.description}
                icon={item.icon}
                active={item.match(pathname)}
              />
            ))}
          </SidebarSection>
        </nav>

        {onAlertsClick && (
          <div className="border-t border-white/10 p-3">
            <SidebarNavigationItem
              expanded={expanded}
              label="Alerts"
              description="Review errors and feed warnings"
              icon={Bell}
              badge={alertCount}
              onClick={onAlertsClick}
            />
          </div>
        )}
      </div>
    </aside>
  )
}
