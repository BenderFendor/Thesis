export type GridViewMode = "source" | "topic"

export const GRID_VIEW_MODE_STORAGE_KEY = "viewMode"

export function isGridViewMode(value: string | null): value is GridViewMode {
  return value === "source" || value === "topic"
}

export function getStoredGridViewMode(): GridViewMode {
  if (typeof window === "undefined") {
    return "source"
  }

  const saved = window.localStorage.getItem(GRID_VIEW_MODE_STORAGE_KEY)
  return isGridViewMode(saved) ? saved : "source"
}

export function setStoredGridViewMode(mode: GridViewMode): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(GRID_VIEW_MODE_STORAGE_KEY, mode)
}
