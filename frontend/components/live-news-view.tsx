"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { LiveNewsToolbar } from "./live-news-toolbar"
import { LiveNewsSourcePicker } from "./live-news-source-picker"
import { StreamCard } from "./stream-card"
import { useLiveNewsPreferences } from "@/hooks/useLiveNewsPreferences"
import { getDefaultSources, type LiveNewsSource } from "@/lib/live-news-sources"
import type { NewsArticle } from "@/lib/api"

interface LiveNewsViewProps {
  articles: NewsArticle[]
  loading: boolean
}

const MIN_DESKTOP_WIDTH = 1024
const MAX_LOADED_IFRAMES = 3

export function LiveNewsView({ articles: _articles, loading: _loading }: LiveNewsViewProps) {
  const [prefs, updatePrefs, resetToDefaults] = useLiveNewsPreferences()
  const [loadedSources, setLoadedSources] = useState<Set<string>>(new Set())
  const [fullscreenId, setFullscreenId] = useState<string | null>(null)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(true)

  const allSources = useMemo(() => getDefaultSources(), [])

  const activeSources = useMemo(() => {
    const activeIds = new Set(prefs.activeSourceIds)
    return allSources.filter((s) => activeIds.has(s.id))
  }, [allSources, prefs.activeSourceIds])

  const visibleRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= MIN_DESKTOP_WIDTH)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreenId(null)
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  const handleBecameVisible = useCallback((sourceId: string) => {
    setLoadedSources((prev) => {
      const next = new Set(prev)
      next.add(sourceId)
      if (next.size > MAX_LOADED_IFRAMES) {
        const toRemove = [...next].slice(0, next.size - MAX_LOADED_IFRAMES)
        for (const id of toRemove) {
          next.delete(id)
        }
      }
      return next
    })
  }, [])

  const handleBecameHidden = useCallback((sourceId: string) => {
    setLoadedSources((prev) => {
      const next = new Set(prev)
      next.delete(sourceId)
      return next
    })
  }, [])

  const handleToggleMute = useCallback(
    (sourceId: string) => {
      // per-source mute not implemented in MVP, treat as toggle all
      if (prefs.muteState === "all-muted") {
        updatePrefs({ muteState: "per-source" })
      } else {
        updatePrefs({ muteState: "all-muted" })
      }
    },
    [prefs.muteState, updatePrefs],
  )

  const handleCloseSource = useCallback(
    (sourceId: string) => {
      const nextIds = prefs.activeSourceIds.filter((id) => id !== sourceId)
      updatePrefs({ activeSourceIds: nextIds })
      if (fullscreenId === sourceId) setFullscreenId(null)
    },
    [prefs.activeSourceIds, fullscreenId, updatePrefs],
  )

  const handleDoubleClick = useCallback((sourceId: string) => {
    setFullscreenId((prev) => (prev === sourceId ? null : sourceId))
  }, [])

  const handleMuteAll = useCallback(() => {
    updatePrefs({ muteState: "all-muted" })
  }, [updatePrefs])

  const handleUnmuteAll = useCallback(() => {
    updatePrefs({ muteState: "per-source" })
  }, [updatePrefs])

  const handleToggleSource = useCallback(
    (sourceId: string) => {
      const nextIds = prefs.activeSourceIds.includes(sourceId)
        ? prefs.activeSourceIds.filter((id) => id !== sourceId)
        : [...prefs.activeSourceIds, sourceId]
      updatePrefs({ activeSourceIds: nextIds })
    },
    [prefs.activeSourceIds, updatePrefs],
  )

  const mutedForSource = useCallback(
    (_sourceId: string) => prefs.muteState === "all-muted",
    [prefs.muteState],
  )

  const gridTemplateColumns =
    prefs.layout === "2x2"
      ? "repeat(2, 1fr)"
      : prefs.layout === "3x3"
        ? "repeat(3, 1fr)"
        : activeSources.length <= 4
          ? "repeat(2, 1fr)"
          : "repeat(3, 1fr)"

  if (!isDesktop) {
    return (
      <div className="flex items-center justify-center h-[60vh] px-6">
        <div className="text-center space-y-3 max-w-xs">
          <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/50">
            Desktop Required
          </span>
          <p className="font-serif text-sm leading-relaxed text-foreground/60">
            Live News view requires a larger screen. Please switch to a desktop
            device or expand your browser window.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <LiveNewsToolbar
        layout={prefs.layout}
        onLayoutChange={(layout) => updatePrefs({ layout })}
        muteState={prefs.muteState}
        onMuteAll={handleMuteAll}
        onUnmuteAll={handleUnmuteAll}
        onReset={resetToDefaults}
        onAddSource={() => setSourcePickerOpen(true)}
        activeCount={activeSources.length}
        totalCount={allSources.length}
      />

      {activeSources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
              No sources enabled
            </span>
            <p className="font-serif text-sm text-foreground/50">
              Use the toolbar to add sources.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto p-3"
          style={{
            display: "grid",
            gridTemplateColumns,
            gap: "0.75rem",
            alignContent: "start",
          }}
        >
          {fullscreenId ? (
            activeSources
              .filter((s) => s.id === fullscreenId)
              .map((source) => (
                <StreamCard
                  key={source.id}
                  source={source}
                  muted={mutedForSource(source.id)}
                  loaded={loadedSources.has(source.id)}
                  isFullscreen={true}
                  onToggleMute={handleToggleMute}
                  onClose={handleCloseSource}
                  onDoubleClick={handleDoubleClick}
                  onBecameVisible={handleBecameVisible}
                  onBecameHidden={handleBecameHidden}
                />
              ))
          ) : (
            activeSources.map((source) => (
              <StreamCard
                key={source.id}
                source={source}
                muted={mutedForSource(source.id)}
                loaded={loadedSources.has(source.id)}
                isFullscreen={false}
                onToggleMute={handleToggleMute}
                onClose={handleCloseSource}
                onDoubleClick={handleDoubleClick}
                onBecameVisible={handleBecameVisible}
                onBecameHidden={handleBecameHidden}
              />
            ))
          )}
        </div>
      )}

      <LiveNewsSourcePicker
        open={sourcePickerOpen}
        sources={allSources}
        activeSourceIds={prefs.activeSourceIds}
        onToggleSource={handleToggleSource}
        onClose={() => setSourcePickerOpen(false)}
      />
    </div>
  )
}
