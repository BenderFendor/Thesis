import {
  ArrowRightLeft,
  BookOpen,
  Bookmark,
  Globe,
  Grid3X3,
  Network,
  Radio,
  ScrollText,
  SlidersHorizontal,
  UsersRound,
  type LucideIcon,
} from "lucide-react"

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
}

export const VIEW_NAVIGATION: readonly ViewNavigationItem[] = [
  { key: "globe", label: "Globe", description: "Browse coverage by geography", icon: Globe },
  { key: "grid", label: "Grid", description: "Scan stories and source groups", icon: Grid3X3 },
  { key: "scroll", label: "Scroll", description: "Read a continuous news stream", icon: ScrollText },
  { key: "blindspot", label: "Blindspot", description: "Compare missing and uneven coverage", icon: ArrowRightLeft },
  { key: "live-news", label: "Live", description: "Follow current source updates", icon: Radio },
]

export const WIKI_NAVIGATION: readonly RouteNavigationItem[] = [
  {
    href: "/wiki",
    label: "Media Wiki",
    description: "Research outlets, reporters, and institutions",
    icon: BookOpen,
    match: (pathname) =>
      pathname.startsWith("/wiki") &&
      !pathname.includes("/ownership") &&
      !pathname.includes("/reporter-graph"),
  },
  {
    href: "/wiki/ownership",
    label: "Intelligence Atlas",
    description: "Trace ownership, publishing, reporter, and evidence relationships",
    icon: Network,
    match: (pathname) => pathname.includes("/ownership"),
  },
  {
    href: "/wiki/reporter-graph",
    label: "Reporter Graph",
    description: "Explore reporter and publication networks",
    icon: UsersRound,
    match: (pathname) => pathname.includes("/reporter-graph"),
  },
]

export const LIBRARY_NAVIGATION: readonly RouteNavigationItem[] = [
  {
    href: "/saved",
    label: "Saved",
    description: "Return to saved articles and queues",
    icon: Bookmark,
    match: (pathname) => pathname.startsWith("/saved"),
  },
  {
    href: "/sources",
    label: "Sources",
    description: "Manage source filters and subscriptions",
    icon: SlidersHorizontal,
    match: (pathname) => pathname.startsWith("/sources") || pathname.startsWith("/source/"),
  },
]

export function isViewMode(value: string | null): value is ViewMode {
  return VIEW_NAVIGATION.some((item) => item.key === value)
}
