import type { ViewMode } from "@/components/navigation/navigation-config"

export const SIDEBAR_EXPANDED_STORAGE_KEY = "scoop:sidebar-expanded"

export function buildViewHref(view: ViewMode): string {
  return `/?view=${view}`
}

export function buildSearchHref(query: string): string {
  return `/search?query=${encodeURIComponent(query.trim())}`
}
