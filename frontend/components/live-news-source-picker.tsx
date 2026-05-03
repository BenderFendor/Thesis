"use client"

import { X } from "lucide-react"
import type { LiveNewsSource } from "@/lib/live-news-sources"

interface LiveNewsSourcePickerProps {
  open: boolean
  sources: LiveNewsSource[]
  activeSourceIds: string[]
  onToggleSource: (sourceId: string) => void
  onClose: () => void
}

export function LiveNewsSourcePicker({
  open,
  sources,
  activeSourceIds,
  onToggleSource,
  onClose,
}: LiveNewsSourcePickerProps) {
  if (!open) return null

  const activeSet = new Set(activeSourceIds)

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-50 w-80 border-l border-white/10 bg-[var(--news-bg-secondary)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-foreground/80">
            Sources
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {sources.map((source) => {
            const isActive = activeSet.has(source.id)
            return (
              <label
                key={source.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/5 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => onToggleSource(source.id)}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <img
                  src={source.thumbnailUrl}
                  alt={source.label}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/80 truncate">
                    {source.label}
                  </div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/50">
                    {source.region}
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        <div className="px-4 py-3 border-t border-white/10">
          <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-muted-foreground/40">
            {activeSourceIds.length} of {sources.length} enabled
          </span>
        </div>
      </div>
    </>
  )
}
