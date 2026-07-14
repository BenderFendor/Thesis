import {
  isViewMode,
  type ViewMode,
} from "@/components/navigation/navigation-config"

export const SIDEBAR_EXPANDED_STORAGE_KEY = "scoop:sidebar-expanded"
const SIDEBAR_EXPANDED_CHANGE_EVENT = "scoop:sidebar-expanded-change"
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
  if (typeof window === "undefined") return false

  try {
    const storedValue = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)
    if (storedValue !== null) {
      sidebarExpandedFallback = storedValue === "true"
    }
  } catch {
    // Fall back to the in-memory state in restricted browser contexts.
  }

  return sidebarExpandedFallback
}

export function writeSidebarExpanded(expanded: boolean): void {
  if (typeof window === "undefined") return

  sidebarExpandedFallback = expanded
  try {
    window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(expanded))
  } catch {
    // The current tab still updates through the in-memory fallback.
  }
  window.dispatchEvent(new Event(SIDEBAR_EXPANDED_CHANGE_EVENT))
}

export function subscribeSidebarExpanded(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined

  const handleStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_EXPANDED_STORAGE_KEY) {
      onChange()
    }
  }
  window.addEventListener("storage", handleStorage)
  window.addEventListener(SIDEBAR_EXPANDED_CHANGE_EVENT, onChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(SIDEBAR_EXPANDED_CHANGE_EVENT, onChange)
  }
}
