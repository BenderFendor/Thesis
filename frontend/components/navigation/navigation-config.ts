import { ArrowRightLeft, Bookmark, Globe, Grid3X3, Network, Palette, Radio, ScrollText, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ViewMode = "globe" | "grid" | "scroll" | "blindspot" | "live-news"

export interface ViewNavigationItem {
  key: ViewMode
  label: string
  description: string
  icon: LucideIcon
}

export interface RouteNavigationItem {
  href: string
  label: string
  description: string
  icon: LucideIcon
  match: (pathname: string) => boolean
}const 

export const VIEW_NAVIGATION: readonly ViewNavigationItem[] = [
  { description: "Browse coverage by geography", icon: Globe, key: "globe", label: "Globe" },
  { description: "Scan stories and source groups", icon: Grid3X3, key: "grid", label: "Grid" },
  { description: "Read a continuous news stream", icon: ScrollText, key: "scroll", label: "Scroll" },
  { description: "Compare missing and uneven coverage", icon: ArrowRightLeft, key: "blindspot", label: "Blindspot" },
  { description: "Follow current source updates", icon: Radio, key: "live-news", label: "Live" },
],
export const WIKI_NAVIGATION: readonly RouteNavigationItem[] = [
  {
    description: "Research media records, ownership, reporter networks, and evidence",
    href: "/wiki/ownership",
    icon: Network,
    label: "Intelligence Atlas",
    match: (pathname) => pathname.startsWith("/wiki"),
  },
],
export const LIBRARY_NAVIGATION: readonly RouteNavigationItem[] = [
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
];

export function isViewMode(value: string | null): value is ViewMode {
  return VIEW_NAVIGATION.some((item) => item.key === value)
}
