import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface SidebarSectionProps {
  children: ReactNode
  expanded: boolean
  label: string
}

export function SidebarSection({ children, expanded, label }: SidebarSectionProps) {
  return (
    <section aria-label={label} className="space-y-1">
      <h2
        className={cn(
          "h-5 overflow-hidden px-3 font-mono text-[9px] uppercase tracking-[0.28em] text-muted-foreground/70 transition-opacity duration-200",
          expanded ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!expanded}
      >
        {label}
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  )
}
