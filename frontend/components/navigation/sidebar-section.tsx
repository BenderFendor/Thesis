import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

interface SidebarSectionProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[]
  readonly expanded: boolean
  readonly label: string
}

const SidebarSection = (props: Readonly<SidebarSectionProps>) => {
  const { children, expanded, label } = props
  let opacity = "opacity-0"
  if (expanded) {
    opacity = "opacity-100"
  }

  return (
    <section aria-label={label} className="space-y-1">
      <h2
        className={cn(
          "h-5 overflow-hidden px-3 font-mono text-[9px] uppercase tracking-[0.28em] text-muted-foreground/70 transition-opacity duration-200",
          opacity,
        )}
        aria-hidden={!expanded}
      >
        {label}
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

export { SidebarSection }
