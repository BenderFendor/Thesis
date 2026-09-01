import { ArrowRightLeft, Bookmark, Globe, Grid3X3, Network, Palette, Radio, ScrollText, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ViewMode = "globe" | "grid" | "scroll" | "blindspot" | "live-news"

interface ViewNavigationItem {
  readonly key: ViewMode
  readonly label: string
  readonly description: string
  readonly icon: LucideIcon
}

interface RouteNavigationItem {
  readonly href: string
  readonly label: string
  readonly description: string
  readonly icon: LucideIcon
  readonly match: (pathname: string) => boolean
}

const LIBRARY_NAVIGATION: readonly RouteNavigationItem[] = [
  {
    description: "Return to saved articles and queues",
    href: "/saved",
    icon: Bookmark,
    label: "Saved",
    match: (pathname) => pathname.startsWith("/saved"),
  },
  {
    description: "Manage source filters and subscriptions",
    href: "/sources",
    icon: SlidersHorizontal,
    label: "Sources",
    match: (pathname) => pathname.startsWith("/sources") || pathname.startsWith("/source/"),
  },
  {
    description: "Tune colors, typography, spacing, and motion",
    href: "/settings",
    icon: Palette,
    label: "Appearance",
    match: (pathname) => pathname.startsWith("/settings"),
  },
],
  VIEW_NAVIGATION: readonly ViewNavigationItem[] = [
  { description: "Browse coverage by geography", icon: Globe, key: "globe", label: "Globe" },
  { description: "Scan stories and source groups", icon: Grid3X3, key: "grid", label: "Grid" },
  { description: "Read a continuous news stream", icon: ScrollText, key: "scroll", label: "Scroll" },
  { description: "Compare missing and uneven coverage", icon: ArrowRightLeft, key: "blindspot", label: "Blindspot" },
  { description: "Follow current source updates", icon: Radio, key: "live-news", label: "Live" },
],
  WIKI_NAVIGATION: readonly RouteNavigationItem[] = [
  {
    description: "Research media records, ownership, reporter networks, and evidence",
    href: "/wiki/ownership",
    icon: Network,
    label: "Intelligence Atlas",
    match: (pathname) => pathname.startsWith("/wiki"),
  },
],
  isViewMode = (value: string | null): value is ViewMode => {
    for (const item of VIEW_NAVIGATION) {
      if (item.key === value) {
        return true
      }
    }
    return false
  }

export {
  LIBRARY_NAVIGATION,
  isViewMode,
  type RouteNavigationItem,
  VIEW_NAVIGATION,
  type ViewMode,
  type ViewNavigationItem,
  WIKI_NAVIGATION,
}
