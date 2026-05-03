"use client"

import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react"
import { Volume2, VolumeX, X, AlertTriangle } from "lucide-react"
import type { LiveNewsSource } from "@/lib/live-news-sources"

interface StreamCardProps {
  source: LiveNewsSource
  muted: boolean
  loaded: boolean
  isFullscreen: boolean
  onToggleMute: (sourceId: string) => void
  onClose: (sourceId: string) => void
  onDoubleClick: (sourceId: string) => void
  onBecameVisible: (sourceId: string) => void
  onBecameHidden: (sourceId: string) => void
}

function buildEmbedUrl(channelId: string, muted: boolean): string {
  const mute = muted ? "1" : "0"
  return (
    `https://www.youtube.com/embed/live_stream?channel=${channelId}` +
    `&enablejsapi=1&autoplay=1&mute=${mute}&controls=1&modestbranding=1&rel=0`
  )
}

export function StreamCard({
  source,
  muted,
  loaded,
  isFullscreen,
  onToggleMute,
  onClose,
  onDoubleClick,
  onBecameVisible,
  onBecameHidden,
}: StreamCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [hovering, setHovering] = useState(false)
  const [embedError, setEmbedError] = useState(false)
  const observeRef = useRef<IntersectionObserver | null>(null)

  const embedUrl = buildEmbedUrl(source.channelId, muted)

  useEffect(() => {
    setEmbedError(false)
  }, [embedUrl])

  const handleIframeError = useCallback(() => {
    setEmbedError(true)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    observeRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onBecameVisible(source.id)
        } else {
          onBecameHidden(source.id)
        }
      },
      { threshold: 0.5 },
    )

    observeRef.current.observe(el)

    return () => {
      observeRef.current?.disconnect()
    }
  }, [source.id, onBecameVisible, onBecameHidden])

  useEffect(() => {
    if (!loaded) return

    let errorTimer: ReturnType<typeof setTimeout> | undefined
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.youtube.com" ||
        typeof event.data !== "string"
      )
        return
      try {
        const data = JSON.parse(event.data)
        if (data?.event === "error") {
          setEmbedError(true)
        }
      } catch {
        // not JSON, ignore
      }
    }

    if (iframeRef.current) {
      errorTimer = setTimeout(() => {
        // YouTube error iframes don't fire error events;
        // detect via the embedded page title pattern
        try {
          const iframeDoc =
            iframeRef.current?.contentDocument ||
            iframeRef.current?.contentWindow?.document
          if (
            iframeDoc &&
            iframeDoc.title.includes("Error") &&
            iframeDoc.title.includes("YouTube")
          ) {
            setEmbedError(true)
          }
        } catch {
          // cross-origin, can't inspect content
        }
      }, 8000)
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      if (errorTimer) clearTimeout(errorTimer)
    }
  }, [loaded])

  const containerStyle: CSSProperties = isFullscreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--news-bg-primary)",
      }
    : {}

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)] group"
      style={containerStyle}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onDoubleClick={() => onDoubleClick(source.id)}
    >
      <div
        className="relative w-full"
        style={{ paddingBottom: isFullscreen ? "0%" : "56.25%" }}
      >
        {loaded ? (
          <>
            <iframe
              ref={iframeRef}
              key={embedUrl}
              src={embedUrl}
              allow="autoplay; encrypted-media"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0 bg-black"
              onError={handleIframeError}
            />
            {embedError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 gap-2">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
                <span className="font-mono text-xs text-white/60 text-center px-4">
                  {source.label} may not be live right now
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black cursor-pointer">
            <div className="w-16 h-16 rounded-full mb-3 flex items-center justify-center bg-white/10 text-white/60 font-mono text-xl uppercase">
              {source.label.charAt(0)}
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">
              {source.label}
            </span>
            <span className="mt-2 font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">
              Click to load
            </span>
          </div>
        )}

        {loaded && hovering && !embedError && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2 bg-black/70 backdrop-blur-sm">
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/80 truncate max-w-[120px]">
              {source.label}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleMute(source.id)
                }}
                className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(source.id)
                }}
                className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
