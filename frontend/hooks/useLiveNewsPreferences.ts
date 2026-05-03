"use client"

import { useCallback, useState } from "react"
import { getDefaultSources } from "@/lib/live-news-sources"

export interface LiveNewsPreferences {
  activeSourceIds: string[]
  layout: "2x2" | "3x3" | "auto"
  muteState: "all-muted" | "per-source"
}

const STORAGE_KEY = "scoop_live_news_prefs"

function loadPreferences(): LiveNewsPreferences | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      Array.isArray(parsed.activeSourceIds) &&
      (parsed.layout === "2x2" ||
        parsed.layout === "3x3" ||
        parsed.layout === "auto") &&
      (parsed.muteState === "all-muted" ||
        parsed.muteState === "per-source")
    ) {
      return parsed as LiveNewsPreferences
    }
    return null
  } catch {
    return null
  }
}

function savePreferences(prefs: LiveNewsPreferences): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage unavailable
  }
}

const DEFAULT_PREFERENCES: LiveNewsPreferences = {
  activeSourceIds: getDefaultSources().map((s) => s.id),
  layout: "3x3",
  muteState: "all-muted",
}

export function useLiveNewsPreferences(): [
  LiveNewsPreferences,
  (patch: Partial<LiveNewsPreferences>) => void,
  () => void,
] {
  const [prefs, setPrefs] = useState<LiveNewsPreferences>(() => {
    return loadPreferences() ?? { ...DEFAULT_PREFERENCES }
  })

  const updatePreferences = useCallback(
    (patch: Partial<LiveNewsPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch }
        savePreferences(next)
        return next
      })
    },
    [],
  )

  const resetToDefaults = useCallback(() => {
    const defaults = { ...DEFAULT_PREFERENCES }
    savePreferences(defaults)
    setPrefs(defaults)
  }, [])

  return [prefs, updatePreferences, resetToDefaults]
}
