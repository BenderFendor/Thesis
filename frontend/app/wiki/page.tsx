"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Search, ArrowUpDown, Filter, BookOpen, ChevronLeft, Loader2 } from "lucide-react";
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

const FILTER_AXES = [
  "ownership",
  "advertising",
  "sourcing",
  "flak",
  "ideology",
  "class_interest",
] as const;

const FILTER_LABELS: Record<string, string> = {
  ownership: "OWN",
  advertising: "AD",
  sourcing: "SRC",
  flak: "FLK",
  ideology: "IDO",
  class_interest: "CLS",
};

// ── Mini Radar ──────────────────────────────────────────────────────

function MiniRadar({ scores }: { scores: Record<string, number> | null | undefined }) {
  if (!scores || Object.keys(scores).length === 0) {
    return (
      <div className="w-16 h-16 flex items-center justify-center text-[10px] text-muted-foreground border border-white/5 rounded">
        N/A
      </div>
    );
  }

  const size = 64;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 26;
  const axes = FILTER_AXES;
  const n = axes.length;

  // Polygon points for max (ring at 5)
  const ringPoints = axes.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return `${cx + maxR * Math.cos(angle)},${cy + maxR * Math.sin(angle)}`;
  });

  // Data polygon
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

// ── Country flag emoji from ISO code ────────────────────────────────

function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// ── Source Card ──────────────────────────────────────────────────────

function SourceCard({ source }: { source: WikiSourceCard }) {
  const avgScore = useMemo(() => {
    if (!source.filter_scores) return null;
    const vals = Object.values(source.filter_scores);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [source.filter_scores]);

  return (
    <Link
      href={`/wiki/source/${encodeURIComponent(source.name)}`}
      className="group block border border-white/10 bg-zinc-950/50 hover:bg-zinc-900/60 transition-colors p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {source.country && (
              <span className="text-sm" title={source.country}>
                {countryFlag(source.country)}
              </span>
            )}
            <h3 className="font-serif text-sm font-semibold text-foreground truncate group-hover:text-white">
              {source.name}
            </h3>
          </div>

          <div className="flex flex-wrap gap-1 mt-2">
            {source.bias_rating && (
              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${biasBadgeClass(source.bias_rating)}`}>
                {source.bias_rating}
              </span>
            )}
            {source.funding_type && (
              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${fundingBadgeClass(source.funding_type)}`}>
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

        <MiniRadar scores={source.filter_scores} />
      </div>

      {/* Filter score bar */}
      {source.filter_scores && Object.keys(source.filter_scores).length > 0 && (
        <div className="mt-3 flex gap-1">
          {FILTER_AXES.map((axis) => {
            const val = source.filter_scores?.[axis];
            if (val == null) return null;
            return (
              <div key={axis} className="flex-1 text-center">
                <div className="text-[8px] font-mono text-muted-foreground uppercase tracking-wide">
                  {FILTER_LABELS[axis]}
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
      <div className="mt-2 flex items-center justify-between">
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
  const [sources, setSources] = useState<WikiSourceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [biasFilter, setBiasFilter] = useState<string>("all");
  const [fundingFilter, setFundingFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");

  // Load all sources once, filter client-side for responsiveness
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await fetchWikiSources({ limit: 500 });
        if (!cancelled) setSources(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load sources");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

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
  const scoredCount = sources.filter((s) => s.filter_scores && Object.keys(s.filter_scores).length > 0).length;

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-serif text-xl font-semibold flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                Media Accountability Wiki
              </h1>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-[0.2em]">
                Manufacturing Consent Analysis
              </p>
            </div>
          </div>

          <div className="text-right text-xs text-muted-foreground font-mono">
            <div>{sources.length} sources</div>
            <div>{scoredCount} scored / {indexedCount} indexed</div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sources..."
              className="pl-9 h-9 bg-zinc-900/50 border-white/10 text-sm"
            />
          </div>

          {/* Bias filter */}
          <Select value={biasFilter} onValueChange={setBiasFilter}>
            <SelectTrigger className="w-[140px] h-9 bg-zinc-900/50 border-white/10 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Bias" />
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
            <SelectTrigger className="w-[140px] h-9 bg-zinc-900/50 border-white/10 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Funding" />
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
            <SelectTrigger className="w-[140px] h-9 bg-zinc-900/50 border-white/10 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {countries.map((c) => (
                <SelectItem key={c} value={c}>
                  {countryFlag(c)} {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[130px] h-9 bg-zinc-900/50 border-white/10 text-sm">
              <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
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
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Filters:
            </span>
            {searchQuery && (
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setSearchQuery("")}>
                &quot;{searchQuery}&quot; x
              </Badge>
            )}
            {biasFilter !== "all" && (
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setBiasFilter("all")}>
                {biasFilter} x
              </Badge>
            )}
            {fundingFilter !== "all" && (
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setFundingFilter("all")}>
                {fundingFilter} x
              </Badge>
            )}
            {countryFilter !== "all" && (
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setCountryFilter("all")}>
                {countryFlag(countryFilter)} {countryFilter} x
              </Badge>
            )}
          </div>
        )}

        {/* Results count */}
        <div className="mb-4 text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Card grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((source) => (
              <SourceCard key={source.name} source={source} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <p className="font-serif text-lg">No sources match your filters</p>
            <p className="text-sm mt-1">Try adjusting your search or filter criteria.</p>
          </div>
        )}

        {/* Legend */}
        {!loading && sources.length > 0 && (
          <div className="mt-8 border-t border-white/5 pt-6">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-3">
              Propaganda Filter Axes (Chomsky/Parenti)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {FILTER_AXES.map((axis) => (
                <div key={axis} className="text-xs">
                  <span className="font-mono text-muted-foreground">{FILTER_LABELS[axis]}</span>
                  <span className="text-foreground ml-1.5 capitalize">{axis.replace("_", " ")}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Score 1-5. Higher = more susceptible to that propaganda filter. Red radar fill = exposure profile.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
