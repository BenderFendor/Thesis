"use client"

import { Volume2, VolumeX, RefreshCw, Plus } from "lucide-react"

interface LiveNewsToolbarProps {
  layout: "2x2" | "3x3" | "auto"
  onLayoutChange: (layout: "2x2" | "3x3" | "auto") => void
  muteState: "all-muted" | "per-source"
  onMuteAll: () => void
  onUnmuteAll: () => void
  onReset: () => void
  onAddSource: () => void
  activeCount: number
  totalCount: number
}

export function LiveNewsToolbar({
  layout,
  onLayoutChange,
  muteState,
  onMuteAll,
  onUnmuteAll,
  onReset,
  onAddSource,
  activeCount,
  totalCount,
}: LiveNewsToolbarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[var(--news-bg-secondary)]">
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-sm border border-white/10 bg-white/[0.03] p-0.5">
          {(["2x2", "3x3", "auto"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onLayoutChange(opt)}
              className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] rounded-sm transition-colors ${
                layout === opt
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>

        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60">
          {activeCount}/{totalCount} channels
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={muteState === "all-muted" ? onUnmuteAll : onMuteAll}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-white/10 bg-white/[0.03] font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          title={muteState === "all-muted" ? "Unmute All" : "Mute All"}
        >
          {muteState === "all-muted" ? (
            <VolumeX className="w-3.5 h-3.5" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" />
          )}
          {muteState === "all-muted" ? "Unmute All" : "Mute All"}
        </button>

        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-white/10 bg-white/[0.03] font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          title="Reset"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reset
        </button>

        <button
          type="button"
          onClick={onAddSource}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-white/10 bg-white/[0.03] font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          title="Add Source"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
    </div>
  )
}
