import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react"
import { ArrowRight, Search } from "lucide-react"

import { cn } from "@/lib/utils"

interface WorkspaceSearchProps {
  expanded: boolean
  onExpand: () => void
  onSearch: (query: string) => void
}

export function WorkspaceSearch({ expanded, onExpand, onSearch }: WorkspaceSearchProps) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const shouldFocusRef = useRef(false)

  useEffect(() => {
    if (expanded && shouldFocusRef.current) {
      shouldFocusRef.current = false
      inputRef.current?.focus()
    }
  }, [expanded])

  const handleCollapsedClick = () => {
    shouldFocusRef.current = true
    onExpand()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      inputRef.current?.focus()
      return
    }
    onSearch(trimmed)
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleCollapsedClick}
        className="flex h-11 w-full items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-white/10 hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Open workspace search"
        title="Search"
      >
        <Search className="h-5 w-5" strokeWidth={1.6} />
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.6}
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        placeholder="Search the workspace"
        aria-label="Search the workspace"
        className="h-11 w-full rounded-lg border border-white/10 bg-[var(--news-bg-primary)] pl-10 pr-11 text-sm text-foreground placeholder:text-muted-foreground/65 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <button
        type="submit"
        className={cn(
          "absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          !query.trim() && "opacity-50",
        )}
        aria-label="Submit search"
      >
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  )
}
