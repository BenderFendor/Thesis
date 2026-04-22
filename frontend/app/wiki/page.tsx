"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Search, ArrowUpDown, Filter, BookOpen, ChevronLeft, Loader2, List, Database, Activity } from "lucide-react";
import { GlobalNavigation } from "@/components/global-navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchWikiSources, type WikiSourceCard } from "@/lib/api";

// ── Filter Axes ─────────────────────────────────────────────────────

const ANALYSIS_AXES = [
  "funding",
  "source_network",
  "political_bias",
  "credibility",
  "framing_omission",
] as const;

const ANALYSIS_LABELS: Record<string, string> = {
  funding: "FND",
  source_network: "SRC",
  political_bias: "POL",
  credibility: "CRD",
  framing_omission: "FRM",
};

// ── Mini Radar ──────────────────────────────────────────────────────

function MiniRadar({ scores }: { scores: Record<string, number> | null | undefined }) {
  const size = 64;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 26;
  const axes = ANALYSIS_AXES;
  const n = axes.length;

  // Polygon points for max (ring at 5)
  const ringPoints = axes.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return `${cx + maxR * Math.cos(angle)},${cy + maxR * Math.sin(angle)}`;
  });

  if (!scores || Object.keys(scores).length === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <polygon
          points={ringPoints.join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="0.5"
        />
        {axes.map((_, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + maxR * Math.cos(angle)}
              y2={cy + maxR * Math.sin(angle)}
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="0.5"
            />
          );
        })}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace" fontWeight="bold" letterSpacing="0.05em">
          NO DATA
        </text>
      </svg>
    );
  }

  const dataPoints = axes.map((axis, i) => {
    const val = (scores[axis] ?? 0) / 5;
    const r = val * maxR;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* Grid ring */}
      <polygon
        points={ringPoints.join(" ")}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="0.5"
      />
      {/* Spoke lines */}
      {axes.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + maxR * Math.cos(angle)}
            y2={cy + maxR * Math.sin(angle)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="0.5"
          />
        );
      })}
      {/* Data fill */}
      <polygon
        points={dataPoints.join(" ")}
        fill="rgba(239,68,68,0.2)"
        stroke="rgba(239,68,68,0.6)"
        strokeWidth="1"
      />
    </svg>
  );
}

// ── Bias Badge Colour ───────────────────────────────────────────────

function biasBadgeClass(bias?: string): string {
  switch (bias?.toLowerCase()) {
    case "left":
      return "bg-blue-900/40 text-blue-300 border-blue-700/30";
    case "left-center":
      return "bg-blue-900/20 text-blue-200 border-blue-700/20";
    case "center":
      return "bg-zinc-800/60 text-zinc-300 border-zinc-600/30";
    case "center-right":
    case "right-center":
      return "bg-red-900/20 text-red-200 border-red-700/20";
    case "right":
      return "bg-red-900/40 text-red-300 border-red-700/30";
    default:
      return "bg-zinc-800/40 text-zinc-400 border-zinc-700/20";
  }
}

function fundingBadgeClass(funding?: string): string {
  switch (funding?.toLowerCase()) {
    case "public":
      return "bg-emerald-900/30 text-emerald-300 border-emerald-700/20";
    case "nonprofit":
      return "bg-violet-900/30 text-violet-300 border-violet-700/20";
    case "state":
      return "bg-amber-900/30 text-amber-300 border-amber-700/20";
    case "corporate":
    case "commercial":
      return "bg-zinc-800/40 text-zinc-300 border-zinc-600/20";
    default:
      return "bg-zinc-800/30 text-zinc-400 border-zinc-700/20";
  }
}

// ── Country text indicator from ISO code ─────────────────────────────

function countryCodeLabel(code?: string): string {
  if (!code) return "";
  if (code.length !== 2) return code.toUpperCase();
  return code.toUpperCase();
}

// ── Source Card ──────────────────────────────────────────────────────

function SourceCard({ source }: { source: WikiSourceCard }) {
  const avgScore = useMemo(() => {
    if (!source.analysis_scores) return null;
    const vals = Object.values(source.analysis_scores);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [source.analysis_scores]);

  return (
    <Link
      href={`/wiki/source/${encodeURIComponent(source.name)}`}
      className="group block relative overflow-hidden bg-black/20 border border-white/5 transition-all duration-500 hover:bg-white/[0.03] hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5 rounded-2xl p-4"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="absolute h-px w-full top-0 left-0 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {source.country && (
              <span className="bg-white/10 text-white px-1.5 py-0.5 rounded-[4px] text-[10px]" title={source.country}>
                {countryCodeLabel(source.country)}
              </span>
            )}
            <h3 className="font-serif text-base lg:text-lg font-semibold text-foreground truncate group-hover:text-white">
              {source.name}
            </h3>
          </div>

          <div className="flex flex-wrap gap-1 mt-2">
            {source.bias_rating && (
              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border rounded-sm ${biasBadgeClass(source.bias_rating)}`}>
                {source.bias_rating}
              </span>
            )}
            {source.funding_type && (
              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border rounded-sm ${fundingBadgeClass(source.funding_type)}`}>
                {source.funding_type}
              </span>
            )}
          </div>

          {source.parent_company && (
            <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
              {source.parent_company}
            </p>
          )}
        </div>

        <MiniRadar scores={source.analysis_scores} />
      </div>

      {/* Analysis score bar */}
      {source.analysis_scores && Object.keys(source.analysis_scores).length > 0 && (
        <div className="relative z-10 mt-3 flex gap-1">
          {ANALYSIS_AXES.map((axis) => {
            const val = source.analysis_scores?.[axis];
            if (val == null) return null;
            return (
              <div key={axis} className="flex-1 text-center">
                <div className="text-[8px] font-mono text-muted-foreground uppercase tracking-wide">
                  {ANALYSIS_LABELS[axis]}
                </div>
                <div
                  className="text-[11px] font-mono font-medium"
                  style={{ color: `hsl(${(5 - val) * 24}, 70%, 55%)` }}
                >
                  {val}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Index status indicator */}
      <div className="relative z-10 mt-2 flex items-center justify-between">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
          {source.index_status === "complete" ? "indexed" : source.index_status ?? "unindexed"}
        </span>
        {avgScore != null && (
          <span
            className="text-[10px] font-mono font-medium"
            style={{ color: `hsl(${(5 - avgScore) * 24}, 70%, 55%)` }}
          >
            avg {avgScore.toFixed(1)}
          </span>
        )}
      </div>
    </Link>
  );
}

// ── Main Page ───────────────────────────────────────────────────────

export default function WikiIndexPage() {
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [biasFilter, setBiasFilter] = useState<string>("all");
  const [fundingFilter, setFundingFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");
  const {
    data: sources = [],
    isLoading: loading,
    error,
  } = useQuery<WikiSourceCard[]>({
    queryKey: ["wiki-sources", 500],
    queryFn: () => fetchWikiSources({ limit: 500 }),
    retry: 1,
  });
  const errorMessage = error instanceof Error ? error.message : "Failed to load sources";

  // Derive unique filter values
  const countries = useMemo(() => {
    const set = new Set<string>();
    sources.forEach((s) => s.country && set.add(s.country));
    return Array.from(set).sort();
  }, [sources]);

  const biasOptions = useMemo(() => {
    const set = new Set<string>();
    sources.forEach((s) => s.bias_rating && set.add(s.bias_rating));
    return Array.from(set).sort();
  }, [sources]);

  const fundingOptions = useMemo(() => {
    const set = new Set<string>();
    sources.forEach((s) => s.funding_type && set.add(s.funding_type));
    return Array.from(set).sort();
  }, [sources]);

  // Client-side filtering + sorting
  const filtered = useMemo(() => {
    let result = sources;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.parent_company?.toLowerCase().includes(q)
      );
    }
    if (biasFilter !== "all") {
      result = result.filter((s) => s.bias_rating?.toLowerCase() === biasFilter.toLowerCase());
    }
    if (fundingFilter !== "all") {
      result = result.filter((s) => s.funding_type?.toLowerCase() === fundingFilter.toLowerCase());
    }
    if (countryFilter !== "all") {
      result = result.filter((s) => s.country?.toUpperCase() === countryFilter.toUpperCase());
    }

    // Sort
    const sorted = [...result];
    if (sortBy === "country") {
      sorted.sort((a, b) => (a.country ?? "ZZ").localeCompare(b.country ?? "ZZ"));
    } else if (sortBy === "bias") {
      const order: Record<string, number> = {
        left: 0, "left-center": 1, center: 2, "center-right": 3, "right-center": 3, right: 4,
      };
      sorted.sort((a, b) => (order[a.bias_rating?.toLowerCase() ?? ""] ?? 5) - (order[b.bias_rating?.toLowerCase() ?? ""] ?? 5));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
  }, [sources, searchQuery, biasFilter, fundingFilter, countryFilter, sortBy]);

  // Stats
  const indexedCount = sources.filter((s) => s.index_status === "complete").length;
  const scoredCount = sources.filter((s) => s.analysis_scores && Object.keys(s.analysis_scores).length > 0).length;

  return (
    <div className="bg-[var(--news-bg-primary)] text-foreground min-h-screen flex relative z-0">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-[var(--news-bg-primary)] to-[var(--news-bg-primary)] z-[-1]" />
      
      <GlobalNavigation />

      <div className="flex-1 flex flex-col min-w-0">
        <main className="mx-auto grid w-full max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Secondary Context Sidebar (Filters) */}
          <aside className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-4 shadow-[0_24px_80px_rgba(0,0,0,0.25)] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Link href="/" className="lg:hidden text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="font-serif text-lg font-semibold flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Media Accountability
                </h1>
                <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-[0.2em]">
                  Source Analysis Wiki
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground font-mono">
              <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <List className="w-3.5 h-3.5" />
                  <span>Results</span>
                </div>
                <span className="text-foreground">{filtered.length}</span>
              </div>
              <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5" />
                  <span>Sources</span>
                </div>
                <span className="text-foreground">{sources.length}</span>
              </div>
              <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Scored / Indexed</span>
                </div>
                <span className="text-foreground">{scoredCount} / {indexedCount}</span>
              </div>
            </div>

            <div className="h-px bg-white/10" />

            {/* Filters section */}
            <div className="space-y-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">Filters</h2>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sources..."
                  className="pl-9 h-9 bg-black/20 border-white/10 text-sm rounded-xl"
                />
              </div>

              {/* Bias filter */}
              <Select value={biasFilter} onValueChange={setBiasFilter}>
                <SelectTrigger className="w-full h-9 bg-black/20 border-white/10 text-sm rounded-xl">
                  <div className="flex items-center">
                    <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Bias" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Bias</SelectItem>
                  {biasOptions.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Funding filter */}
              <Select value={fundingFilter} onValueChange={setFundingFilter}>
                <SelectTrigger className="w-full h-9 bg-black/20 border-white/10 text-sm rounded-xl">
                  <div className="flex items-center">
                    <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Funding" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Funding</SelectItem>
                  {fundingOptions.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Country filter */}
              <Select value={countryFilter} onValueChange={setCountryFilter}>
                <SelectTrigger className="w-full h-9 bg-black/20 border-white/10 text-sm rounded-xl">
                  <div className="flex items-center">
                    <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Country" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Countries</SelectItem>
                  {countries.map((c) => (
                    <SelectItem key={c} value={c}>
                      {countryCodeLabel(c)} {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sort */}
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full h-9 bg-black/20 border-white/10 text-sm rounded-xl">
                  <div className="flex items-center">
                    <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Sort" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="country">Country</SelectItem>
                  <SelectItem value="bias">Bias</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Active filters */}
            {(biasFilter !== "all" || fundingFilter !== "all" || countryFilter !== "all" || searchQuery) && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-full">
                  Active:
                </span>
                {searchQuery && (
                  <Badge variant="secondary" className="text-xs cursor-pointer bg-white/5 hover:bg-white/10 rounded-sm" onClick={() => setSearchQuery("")}>
                    &quot;{searchQuery}&quot; ✕
                  </Badge>
                )}
                {biasFilter !== "all" && (
                  <Badge variant="secondary" className="text-xs cursor-pointer bg-white/5 hover:bg-white/10 rounded-sm" onClick={() => setBiasFilter("all")}>
                    {biasFilter} ✕
                  </Badge>
                )}
                {fundingFilter !== "all" && (
                  <Badge variant="secondary" className="text-xs cursor-pointer bg-white/5 hover:bg-white/10 rounded-sm" onClick={() => setFundingFilter("all")}>
                    {fundingFilter} ✕
                  </Badge>
                )}
                {countryFilter !== "all" && (
                  <Badge variant="secondary" className="text-xs cursor-pointer bg-white/5 hover:bg-white/10 rounded-sm" onClick={() => setCountryFilter("all")}>
                    {countryCodeLabel(countryFilter)} {countryFilter} ✕
                  </Badge>
                )}
              </div>
            )}
          </aside>

          {/* Main content area */}
          <section className="space-y-5">
            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-20 bg-black/20 border border-white/5 rounded-2xl h-full min-h-[300px]">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div className="border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300 rounded-2xl">
                {errorMessage}
              </div>
            )}

            {/* Card grid */}
            {!loading && !error && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
                {filtered.map((source) => (
                  <SourceCard key={source.name} source={source} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/20 border border-white/5 rounded-2xl h-full min-h-[300px]">
                <p className="font-serif text-lg text-white/80">No sources match your filters</p>
                <p className="text-sm mt-1">Try adjusting your search or filter criteria.</p>
              </div>
            )}

            {/* Legend */}
            {!loading && sources.length > 0 && (
              <div className="mt-8 bg-black/20 border border-white/5 rounded-2xl p-6">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-4">
                  Source Analysis Axes
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {ANALYSIS_AXES.map((axis) => (
                    <div key={axis} className="text-xs">
                      <span className="font-mono text-muted-foreground">{ANALYSIS_LABELS[axis]}</span>
                      <span className="text-foreground ml-2 capitalize">{axis.replace("_", " ")}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-4 max-w-2xl">
                  Score 1-5. Higher means higher structural bias or credibility risk. Red radar fill shows the source profile.
                </p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
