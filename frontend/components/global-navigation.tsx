"use client"

import { useState, KeyboardEvent } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Globe,
  Grid3X3,
  Scroll,
  ArrowRightLeft,
  Search,
  Bell,
  SlidersHorizontal,
  Bookmark,
  BookOpen,
  Network
} from "lucide-react"
import { SafeImage } from "@/components/safe-image"

export type ViewMode = "globe" | "grid" | "scroll" | "blindspot"

interface GlobalNavigationProps {
  currentView?: ViewMode
  onViewChange?: (view: ViewMode) => void
  onAlertsClick?: () => void
  alertCount?: number
}

export function GlobalNavigation({
  currentView,
  onViewChange,
  onAlertsClick,
  alertCount = 0
}: GlobalNavigationProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")

  const handleSearchSubmit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    const trimmed = searchQuery.trim()
    if (!trimmed) return
    router.push(`/search?query=${encodeURIComponent(trimmed)}`)
  }

  const handleViewClick = (view: ViewMode) => {
    if (onViewChange) {
      onViewChange(view)
    } else {
      router.push(`/?view=${view}`)
    }
  }

  const isHome = pathname === "/"
  const isWiki = pathname.startsWith("/wiki") && !pathname.includes("/ownership")
  const isOwnerGraph = pathname.includes("/ownership")

  return (
    <aside className="group hidden lg:flex w-16 hover:w-64 shrink-0 border-r border-white/10 bg-[var(--news-bg-secondary)] sticky top-0 h-screen flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] z-50 overflow-hidden">
      <div className="px-4 py-5 border-b border-white/10 min-w-[16rem]">
        <Link href="/" className="flex items-center gap-4">
          <SafeImage
            src="/favicon.svg"
            alt="Scoop"
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 transition-all duration-300 group-hover:scale-105 -ml-2 group-hover:ml-0"
            sizes="48px"
          />
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground">Scoop</div>
            <div className="font-serif text-xl font-semibold tracking-tight text-foreground/90">Dashboard</div>
          </div>
        </Link>
      </div>

      <div className="px-3 py-4 border-b border-white/10 min-w-[16rem]">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 mb-2 px-1">Search</div>
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground shrink-0 z-10" />
          <input
            type="text"
            placeholder="Search workspace..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearchSubmit}
            className="w-full bg-[var(--news-bg-primary)] border border-white/10 pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-6 space-y-8 min-w-[16rem] no-scrollbar">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-2 mb-3">Views</div>
          <div className="space-y-1">
            {[
              { key: "globe", label: "Globe", Icon: Globe },
              { key: "grid", label: "Grid", Icon: Grid3X3 },
              { key: "scroll", label: "Scroll", Icon: Scroll },
              { key: "blindspot", label: "Blindspot", Icon: ArrowRightLeft },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => handleViewClick(key as ViewMode)}
                className={`w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] transition-all duration-200 ${
                  isHome && currentView === key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
                title={label}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-2 mb-3">Wiki</div>
          <div className="space-y-1">
            <Link
              href="/wiki"
              className={`w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] transition-all duration-200 ${
                isWiki
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
              title="Media Wiki"
            >
              <BookOpen className="w-5 h-5 shrink-0" strokeWidth={1.5} />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Media Wiki</span>
            </Link>
            <Link
              href="/wiki/ownership"
              className={`w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] transition-all duration-200 ${
                isOwnerGraph
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
              title="Owner Graph"
            >
              <Network className="w-5 h-5 shrink-0" strokeWidth={1.5} />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Owner Graph</span>
            </Link>
          </div>
        </div>

        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-2 mb-3">Filters</div>
          <div className="space-y-1">
            <Link
              href="/saved"
              className={`w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200`}
              title="Saved"
            >
              <Bookmark className="w-5 h-5 shrink-0" strokeWidth={1.5} />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Saved</span>
            </Link>
            <Link
              href="/sources"
              className={`w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200`}
              title="Sources"
            >
              <SlidersHorizontal className="w-5 h-5 shrink-0" strokeWidth={1.5} />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Sources</span>
            </Link>
          </div>
        </div>
      </div>

      {onAlertsClick && (
        <div className="px-3 py-4 border-t border-white/10 min-w-[16rem]">
          <button
            type="button"
            onClick={onAlertsClick}
            className="w-10 group-hover:w-full overflow-hidden flex items-center gap-4 px-2.5 py-2.5 rounded-lg text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
            title="Alerts"
          >
            <div className="relative shrink-0 flex items-center justify-center">
              <Bell className="w-5 h-5" strokeWidth={1.5} />
              {alertCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {alertCount}
                </span>
              )}
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Alerts</span>
          </button>
        </div>
      )}
    </aside>
  )
}
