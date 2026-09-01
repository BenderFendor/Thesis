import { isViewMode } from '@/components/navigation/navigation-config';
import type { ViewMode } from '@/components/navigation/navigation-config';

export const SIDEBAR_EXPANDED_CHANGE_EVENT = "scoop:sidebar-expanded-change",
SIDEBAR_EXPANDED_STORAGE_KEY = "scoop:sidebar-expanded";
let sidebarExpandedFallback = false

export function buildViewHref(view: ViewMode): string {
  return `/?view=${view}`
}

export function buildSearchHref(query: string): string {
  return `/search?query=${encodeURIComponent(query.trim())}`
}

export function getViewFromSearch(search: string): ViewMode | null {
  const requestedView = new URLSearchParams(search).get("view")
  return isViewMode(requestedView) ? requestedView : null
}

export function readSidebarExpanded(): boolean {
  if (typeof window === "undefined") {return false}

  try {
    const storedValue = globalThis.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)
    sidebarExpandedFallback = storedValue === "true"
  } catch {
    // Fall back to the in-memory state in restricted browser contexts.
  }

  return sidebarExpandedFallback
}

export function writeSidebarExpanded(expanded: boolean): void {
  if (typeof window === "undefined") {return}

  sidebarExpandedFallback = expanded
  try {
    globalThis.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(expanded))
  } catch {
    // The current tab still updates through the in-memory fallback.
  }
  globalThis.dispatchEvent(new Event(SIDEBAR_EXPANDED_CHANGE_EVENT))
}

export function subscribeSidebarExpanded(onChange: () => void): () => void {
  if (typeof window === "undefined") {return () => {}}

  const handleStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_EXPANDED_STORAGE_KEY || event.key === null) {
      onChange()
    }
  }
  globalThis.addEventListener("storage", handleStorage)
  globalThis.addEventListener(SIDEBAR_EXPANDED_CHANGE_EVENT, onChange)

  return () => {
    globalThis.removeEventListener("storage", handleStorage)
    globalThis.removeEventListener(SIDEBAR_EXPANDED_CHANGE_EVENT, onChange)
  }
}
