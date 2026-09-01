"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronLeft,
  ExternalLink,
  Loader2,
  Search,
  Users,
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
import { fetchWikiReporters } from '@/lib/api';
import type { WikiReporterCard } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────

function leaningBadgeClass(leaning?: string): string {
  switch (leaning?.toLowerCase()) {
    case "left": { return "bg-blue-900/40 text-blue-300 border-blue-700/30";
    }
    case "left-leaning":
    case "center-left": { return "bg-blue-900/20 text-blue-200 border-blue-700/20";
    }
    case "center":
    case "centrist": { return "bg-zinc-800/60 text-zinc-300 border-zinc-600/30";
    }
    case "center-right":
    case "right-leaning": { return "bg-red-900/20 text-red-200 border-red-700/20";
    }
    case "right": { return "bg-red-900/40 text-red-300 border-red-700/30";
    }
    default: { return "bg-zinc-800/40 text-zinc-400 border-zinc-700/20";
    }
  }
}

function confidenceLabel(conf?: string): string {
  switch (conf?.toLowerCase()) {
    case "high": { return "verified";
    }
    case "medium": { return "likely";
    }
    case "low": { return "inferred";
    }
    default: { return "";
    }
  }
}

// ── Reporter Card ────────────────────────────────────────────────────

function ReporterCard({ reporter }:Readonly< { reporter: WikiReporterCard }>) {
  return (
    <Link
      href={`/wiki/reporter/${reporter.id}`}
      className="group block border border-white/10 bg-zinc-950/50 hover:bg-zinc-900/60 transition-colors p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <ReporterCardIdentity reporter={reporter} />
      </div>

      {reporter.bio && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {reporter.bio}
        </p>
      )}

      <ReporterPoliticalBadge reporter={reporter} />
      <ReporterTopics reporter={reporter} />
      <ReporterCardFooter reporter={reporter} />
    </Link>
  );
}

function ReporterCardIdentity({ reporter }: Readonly<{ reporter: WikiReporterCard }>) {
  return (
    <>
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
    </>
  )
}

function ReporterPoliticalBadge({ reporter }: Readonly<{ reporter: WikiReporterCard }>) {
  if (!reporter.political_leaning) {
    return <></>
  }
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${leaningBadgeClass(reporter.political_leaning)}`}>
        {reporter.political_leaning}
        {reporter.leaning_confidence && (
          <span className="ml-1 opacity-60">({confidenceLabel(reporter.leaning_confidence)})</span>
        )}
      </span>
    </div>
  )
}

function ReporterTopics({ reporter }: Readonly<{ reporter: WikiReporterCard }>) {
  if (!reporter.topics || reporter.topics.length === 0) {
    return <></>
  }
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {reporter.topics.slice(0, 4).map((topic, index) => (
        <span
          key={index}
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
  )
}

function ReporterCardFooter({ reporter }: Readonly<{ reporter: WikiReporterCard }>) {
  return (
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
  )
}

// ── Main Page ────────────────────────────────────────────────────────

function getLeaningOptions(reporters: readonly WikiReporterCard[]): string[] {
  const leanings = new Set<string>();
  reporters.forEach((reporter) => {
    if (reporter.political_leaning) {
      leanings.add(reporter.political_leaning);
    }
  });
  return [...leanings].sort();
}

function filterReporters(
  reporters: readonly WikiReporterCard[],
  searchQuery: string,
  leaningFilter: string,
): WikiReporterCard[] {
  let result = [...reporters];
  if (searchQuery.length > 0) {
    const query = searchQuery.toLowerCase();
    result = result.filter(
      (reporter) =>
        reporter.name.toLowerCase().includes(query) ||
        reporter.bio?.toLowerCase().includes(query) ||
        reporter.topics?.some((topic) => topic.toLowerCase().includes(query)),
    );
  }
  if (leaningFilter !== "all") {
    const normalizedFilter = leaningFilter.toLowerCase();
    result = result.filter(
      (reporter) => reporter.political_leaning?.toLowerCase() === normalizedFilter,
    );
  }
  return result;
}

export default function ReporterDirectoryPage() {
  const [searchQuery, setSearchQuery] = useState(""),
   [leaningFilter, setLeaningFilter] = useState("all"),
   {
    data: reporters = [],
    isLoading: loading,
    error,
  } = useQuery<WikiReporterCard[]>({
    queryFn: () => fetchWikiReporters({ limit: 500 }),
    queryKey: ["wiki-reporters", 500],
    retry: 1,
  }),
   errorMessage = error instanceof Error ? error.message : "Failed to load reporters",

   leaningOptions = useMemo(() => getLeaningOptions(reporters), [reporters]),

   filtered = useMemo(
    () => filterReporters(reporters, searchQuery, leaningFilter),
    [reporters, searchQuery, leaningFilter],
  );

  return (
    <ReporterDirectoryView
      error={error}
      errorMessage={errorMessage}
      filtered={filtered}
      isLoading={loading}
      leaningFilter={leaningFilter}
      leaningOptions={leaningOptions}
      onLeaningChange={setLeaningFilter}
      onSearchChange={setSearchQuery}
      reporters={reporters}
      searchQuery={searchQuery}
    />
  );
}

interface ReporterDirectoryViewProps {
  readonly error: Error | null;
  readonly errorMessage: string;
  readonly filtered: WikiReporterCard[];
  readonly isLoading: boolean;
  readonly leaningFilter: string;
  readonly leaningOptions: string[];
  readonly onLeaningChange: (value: string) => void;
  readonly onSearchChange: (value: string) => void;
  readonly reporters: WikiReporterCard[];
  readonly searchQuery: string;
}

function ReporterDirectoryView({
  error,
  errorMessage,
  filtered,
  isLoading,
  leaningFilter,
  leaningOptions,
  onLeaningChange,
  onSearchChange,
  reporters,
  searchQuery,
}: Readonly<ReporterDirectoryViewProps>) {
  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)]">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/wiki/ownership" className="text-muted-foreground hover:text-foreground transition-colors">
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
        <ReporterDirectoryFilters
          leaningFilter={leaningFilter}
          leaningOptions={leaningOptions}
          onLeaningChange={onLeaningChange}
          onSearchChange={onSearchChange}
          searchQuery={searchQuery}
        />
        <ReporterDirectoryResults
          error={error}
          errorMessage={errorMessage}
          filtered={filtered}
          isLoading={isLoading}
        />
      </main>
    </div>
  );
}

interface ReporterDirectoryFiltersProps {
  readonly leaningFilter: string;
  readonly leaningOptions: string[];
  readonly onLeaningChange: (value: string) => void;
  readonly onSearchChange: (value: string) => void;
  readonly searchQuery: string;
}

function ReporterDirectoryFilters({
  leaningFilter,
  leaningOptions,
  onLeaningChange,
  onSearchChange,
  searchQuery,
}: Readonly<ReporterDirectoryFiltersProps>) {
  const hasActiveFilters = leaningFilter !== "all" || searchQuery.length > 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) =>{  onSearchChange(event.target.value); }}
            placeholder="Search reporters, topics..."
            className="pl-9 h-9 bg-zinc-900/50 border-white/10 text-sm"
          />
        </div>
        <Select value={leaningFilter} onValueChange={onLeaningChange}>
          <SelectTrigger className="w-[160px] h-9 bg-zinc-900/50 border-white/10 text-sm">
            <SelectValue placeholder="Leaning" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Leanings</SelectItem>
            {leaningOptions.map((leaning) => (
              <SelectItem key={leaning} value={leaning}>{leaning}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasActiveFilters && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filters:</span>
          {searchQuery.length > 0 && (
            <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() =>{  onSearchChange(""); }}>
              &quot;{searchQuery}&quot; x
            </Badge>
          )}
          {leaningFilter !== "all" && (
            <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() =>{  onLeaningChange("all"); }}>
              {leaningFilter} x
            </Badge>
          )}
        </div>
      )}
    </>
  );
}

interface ReporterDirectoryResultsProps {
  readonly error: Error | null;
  readonly errorMessage: string;
  readonly filtered: WikiReporterCard[];
  readonly isLoading: boolean;
}

function ReporterDirectoryResults({
  error,
  errorMessage,
  filtered,
  isLoading,
}: Readonly<ReporterDirectoryResultsProps>) {
  const hasError = error !== null,
   hasResults = !isLoading && !hasError;
  return (
    <>
      <div className="mb-4 text-xs font-mono text-muted-foreground uppercase tracking-wider">
        {filtered.length} result{filtered.length === 1 ? "" : "s"}
      </div>
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {hasError && !isLoading && (
        <div className="border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">{errorMessage}</div>
      )}
      {hasResults && <ReporterGrid reporters={filtered} />}
      {hasResults && filtered.length === 0 && <ReporterEmptyState />}
    </>
  );
}

function ReporterGrid({ reporters }: Readonly<{ reporters: WikiReporterCard[] }>) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {reporters.map((reporter) => (
        <ReporterCard key={reporter.id} reporter={reporter} />
      ))}
    </div>
  )
}

function ReporterEmptyState() {
  return (
    <div className="text-center py-20 text-muted-foreground">
      <p className="font-serif text-lg">No reporters found</p>
      <p className="text-sm mt-1">Try adjusting your search criteria.</p>
    </div>
  )
}
