"use client"

import Image from "next/image"
import type { LiveNewsSource } from "@/lib/live-news-sources"
import { X } from "lucide-react"

interface LiveNewsSourcePickerProps {
  readonly open: boolean
  readonly sources: readonly LiveNewsSource[]
  readonly activeSourceIds: readonly string[]
  readonly onToggleSource: (sourceId: string) => void
  readonly onClose: () => void
}

interface SourcePickerRowProps {
  readonly active: boolean
  readonly onToggle: () => void
  readonly source: Readonly<LiveNewsSource>
}

const LiveNewsSourcePicker = ({
  activeSourceIds,
  onClose,
  onToggleSource,
  open,
  sources,
}: LiveNewsSourcePickerProps) => {
  if (!open) {return false}

  return (
    <>
      <SourcePickerBackdrop onClose={onClose} />
      <aside
        aria-label="Live news source picker"
        className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col animate-in slide-in-from-right border-l border-white/10 bg-[var(--news-bg-secondary)] shadow-2xl duration-200"
      >
        <SourcePickerHeader onClose={onClose} />
        <SourcePickerRows
          activeSourceIds={activeSourceIds}
          onToggleSource={onToggleSource}
          sources={sources}
        />
        <SourcePickerFooter activeSourceIds={activeSourceIds} sources={sources} />
      </aside>
    </>
  )
},

SourcePickerBackdrop = ({ onClose }: Pick<LiveNewsSourcePickerProps, "onClose">) => (
  <button
    type="button"
    aria-label="Close source picker"
    className="fixed inset-0 z-40 cursor-default bg-black/50 backdrop-blur-sm"
    onClick={onClose}
  />
),

SourcePickerFooter = ({
  activeSourceIds,
  sources,
}: Pick<LiveNewsSourcePickerProps, "activeSourceIds" | "sources">) => (
  <div className="border-t border-white/10 px-4 py-3">
    <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-muted-foreground/40">
      {activeSourceIds.length} of {sources.length} enabled
    </span>
  </div>
),

SourcePickerHeader = ({ onClose }: Pick<LiveNewsSourcePickerProps, "onClose">) => (
  <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
    <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-foreground/80">
      Sources
    </h3>
    <button
      type="button"
      onClick={onClose}
      aria-label="Close source picker"
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
    >
      <X className="h-4 w-4" />
    </button>
  </div>
),

SourcePickerMeta = ({ source }: Pick<SourcePickerRowProps, "source">) => (
  <div className="min-w-0 flex-1">
    <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/80">
      {source.label}
    </div>
    <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/50">
      {source.region}
    </div>
  </div>
),

SourcePickerRow = ({ active, onToggle, source }: SourcePickerRowProps) => {
  const handleChange = onToggle

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-white/5">
      <input
        type="checkbox"
        checked={active}
        onChange={handleChange}
        className="h-4 w-4 cursor-pointer rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0"
      />
      <Image
        src={source.thumbnailUrl}
        alt={source.label}
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
      <SourcePickerMeta source={source} />
    </label>
  )
},

SourcePickerRows = ({
  activeSourceIds,
  sources,
  onToggleSource,
}: Pick<LiveNewsSourcePickerProps, "activeSourceIds" | "onToggleSource" | "sources">) => {
  const activeSet = new Set(activeSourceIds),
    rows = sources.map((source: Readonly<LiveNewsSource>) => ({
      active: activeSet.has(source.id),
      handleToggle: () => { onToggleSource(source.id) },
      source,
    }))

  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-3">
      {rows.map(({ active, handleToggle, source }: Readonly<(typeof rows)[number]>) => (
        <SourcePickerRow
          key={source.id}
          active={active}
          onToggle={handleToggle}
          source={source}
        />
      ))}
    </div>
  )
};

export { LiveNewsSourcePicker }
