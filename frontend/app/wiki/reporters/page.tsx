"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  Search,
  Users,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchWikiReporters, type WikiReporterCard } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────

function leaningBadgeClass(leaning?: string): string {
  switch (leaning?.toLowerCase()) {
    case "left": return "bg-blue-900/40 text-blue-300 border-blue-700/30";
    case "left-leaning":
    case "center-left": return "bg-blue-900/20 text-blue-200 border-blue-700/20";
    case "center":
    case "centrist": return "bg-zinc-800/60 text-zinc-300 border-zinc-600/30";
    case "center-right":
    case "right-leaning": return "bg-red-900/20 text-red-200 border-red-700/20";
    case "right": return "bg-red-900/40 text-red-300 border-red-700/30";
    default: return "bg-zinc-800/40 text-zinc-400 border-zinc-700/20";
  }
}

function confidenceLabel(conf?: string): string {
  switch (conf?.toLowerCase()) {
    case "high": return "verified";
    case "medium": return "likely";
    case "low": return "inferred";
    default: return "";
  }
}

// ── Reporter Card ────────────────────────────────────────────────────

function ReporterCard({ reporter }: { reporter: WikiReporterCard }) {
  return (
    <Link
      href={`/wiki/reporter/${reporter.id}`}
      className="group block border border-white/10 bg-zinc-950/50 hover:bg-zinc-900/60 transition-colors p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-sm font-semibold group-hover:text-white truncate">
            {reporter.name}
          </h3>
          {reporter.current_outlet && (
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {reporter.current_outlet}
            </p>
          )}
        </div>
        {reporter.article_count > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            {reporter.article_count} articles
          </span>
        )}
      </div>

      {reporter.bio && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {reporter.bio}
        </p>
      )}

      <div className="flex flex-wrap gap-1 mt-2">
        {reporter.political_leaning && (
          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${leaningBadgeClass(reporter.political_leaning)}`}>
            {reporter.political_leaning}
            {reporter.leaning_confidence && (
              <span className="ml-1 opacity-60">({confidenceLabel(reporter.leaning_confidence)})</span>
            )}
          </span>
        )}
      </div>

      {reporter.topics && reporter.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {reporter.topics.slice(0, 4).map((topic, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 bg-zinc-800/50 text-muted-foreground border border-white/5"
            >
              {topic}
            </span>
          ))}
          {reporter.topics.length > 4 && (
            <span className="text-[10px] px-1 py-0.5 text-muted-foreground">
              +{reporter.topics.length - 4}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 text-[10px] font-mono text-muted-foreground">
        {reporter.research_confidence && (
          <span>confidence: {reporter.research_confidence}</span>
        )}
        {reporter.wikipedia_url && (
          <span className="text-blue-400 flex items-center gap-0.5">
            wiki <ExternalLink className="w-2.5 h-2.5" />
          </span>
        )}
      </div>
    </Link>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function ReporterDirectoryPage() {
  const [reporters, setReporters] = useState<WikiReporterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [leaningFilter, setLeaningFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await fetchWikiReporters({ limit: 500 });
        if (!cancelled) setReporters(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load reporters");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const leaningOptions = useMemo(() => {
    const set = new Set<string>();
    reporters.forEach((r) => r.political_leaning && set.add(r.political_leaning));
    return Array.from(set).sort();
  }, [reporters]);

  const filtered = useMemo(() => {
    let result = reporters;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.bio?.toLowerCase().includes(q) ||
          r.topics?.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (leaningFilter !== "all") {
      result = result.filter((r) => r.political_leaning?.toLowerCase() === leaningFilter.toLowerCase());
    }
    return result;
  }, [reporters, searchQuery, leaningFilter]);

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/wiki" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-serif text-xl font-semibold flex items-center gap-2">
                <Users className="w-5 h-5" />
                Reporter Directory
              </h1>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-[0.2em]">
                Journalist Profiles & Dossiers
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground font-mono">
            {reporters.length} reporters
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reporters, topics..."
              className="pl-9 h-9 bg-zinc-900/50 border-white/10 text-sm"
            />
          </div>
          <Select value={leaningFilter} onValueChange={setLeaningFilter}>
            <SelectTrigger className="w-[160px] h-9 bg-zinc-900/50 border-white/10 text-sm">
              <SelectValue placeholder="Leaning" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leanings</SelectItem>
              {leaningOptions.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active filters */}
        {(leaningFilter !== "all" || searchQuery) && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filters:</span>
            {searchQuery && (
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setSearchQuery("")}>
                &quot;{searchQuery}&quot; x
              </Badge>
            )}
            {leaningFilter !== "all" && (
              <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setLeaningFilter("all")}>
                {leaningFilter} x
              </Badge>
            )}
          </div>
        )}

        <div className="mb-4 text-xs font-mono text-muted-foreground uppercase tracking-wider">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !loading && (
          <div className="border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">{error}</div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((reporter) => (
              <ReporterCard key={reporter.id} reporter={reporter} />
            ))}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            <p className="font-serif text-lg">No reporters found</p>
            <p className="text-sm mt-1">Try adjusting your search criteria.</p>
          </div>
        )}
      </main>
    </div>
  );
}
