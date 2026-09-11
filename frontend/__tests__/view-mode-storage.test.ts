import {
  GRID_VIEW_MODE_STORAGE_KEY,
  getStoredGridViewMode,
  isGridViewMode,
  setStoredGridViewMode,
} from "@/lib/view-mode-storage"
import { describe, expect, it } from "@jest/globals"

describe("gridViewModeStorage", () => {
  it("round trips valid modes through browser storage", () => {
    expect.hasAssertions()
    globalThis.localStorage.clear()
    setStoredGridViewMode("topic")

    expect(getStoredGridViewMode()).toBe("topic")
    expect(isGridViewMode("source")).toBe(true)
  })

  it("falls back to source for an invalid stored mode", () => {
    expect.hasAssertions()
    globalThis.localStorage.clear()
    globalThis.localStorage.setItem(GRID_VIEW_MODE_STORAGE_KEY, "invalid")

    expect(getStoredGridViewMode()).toBe("source")
    expect(isGridViewMode()).toBe(false)
  })
})
