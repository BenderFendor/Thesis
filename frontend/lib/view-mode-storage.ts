type GridViewMode = "source" | "topic"

const DEFAULT_GRID_VIEW_MODE: GridViewMode = "source",
 GRID_VIEW_MODE_STORAGE_KEY = "viewMode",

 getStoredGridViewMode = (): GridViewMode => {
  const storedValue = getStoredGridViewModeValue()
  if (isGridViewMode(storedValue)) {return storedValue}

  return DEFAULT_GRID_VIEW_MODE
 },

 getStoredGridViewModeValue = (): string | undefined => {
  if (!Object.hasOwn(globalThis, "window")) {return undefined}
  return globalThis.window.localStorage.getItem(GRID_VIEW_MODE_STORAGE_KEY) ?? undefined
 },

 isGridViewMode = (value?: string | null): value is GridViewMode =>
  value === DEFAULT_GRID_VIEW_MODE || value === "topic",

 setStoredGridViewMode = (mode: GridViewMode): void => {
  if (!Object.hasOwn(globalThis, "window")) {return}

  globalThis.window.localStorage.setItem(GRID_VIEW_MODE_STORAGE_KEY, mode)
 }

export { GRID_VIEW_MODE_STORAGE_KEY, getStoredGridViewMode, isGridViewMode, setStoredGridViewMode }
export type { GridViewMode }
