"use client";
import { hasText } from "@/lib/utils";

import { ChevronLeft, ExternalLink, Loader2, Search, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import type { WikiReporterCard } from "@/lib/api";
import { fetchWikiReporters } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useQuery } from "@tanstack/react-query";

type ReporterCardData = DeepReadonly<WikiReporterCard>;
type ReporterCards = readonly ReporterCardData[];
type TextInputChange = Readonly<{ target: Readonly<{ value: string }> }>;

// ── Helpers ──────────────────────────────────────────────────────────

const LEANING_BADGE_CLASSES = {
  center: "bg-zinc-800/60 text-zinc-300 border-zinc-600/30",
  "center-left": "bg-blue-900/20 text-blue-200 border-blue-700/20",
  "center-right": "bg-red-900/20 text-red-200 border-red-700/20",
  centrist: "bg-zinc-800/60 text-zinc-300 border-zinc-600/30",
  left: "bg-blue-900/40 text-blue-300 border-blue-700/30",
  "left-leaning": "bg-blue-900/20 text-blue-200 border-blue-700/20",
  right: "bg-red-900/40 text-red-300 border-red-700/30",
  "right-leaning": "bg-red-900/20 text-red-200 border-red-700/20",
} as const;

const isLeaningBadgeKey = (value: string): value is keyof typeof LEANING_BADGE_CLASSES =>
  Object.hasOwn(LEANING_BADGE_CLASSES, value);

const leaningBadgeClass = (leaning?: string): string => {
  if (leaning === undefined) {
    throw new Error("Not implemented yet: undefined case");
  }
  const normalized = leaning.toLowerCase();
  if (isLeaningBadgeKey(normalized)) {
    return LEANING_BADGE_CLASSES[normalized];
  }
  return "bg-zinc-800/40 text-zinc-400 border-zinc-700/20";
};

const confidenceLabel = (conf?: string): string => {
  switch (conf?.toLowerCase()) {
    case "high": {
      return "verified";
    }
    case "medium": {
      return "likely";
    }
    case "low": {
      return "inferred";
    }
    case undefined: {
      throw new Error("Not implemented yet: undefined case");
    }
    default: {
      return "";
    }
  }
};

// ── Reporter Card ────────────────────────────────────────────────────

const ReporterCard = ({ reporter }: Readonly<{ reporter: ReporterCardData }>) => (
  <Link
    href={`/wiki/reporter/${reporter.id}`}
    className="group block border border-white/10 bg-zinc-950/50 hover:bg-zinc-900/60 transition-colors p-4"
  >
    <div className="flex items-start justify-between gap-2">
      <ReporterCardIdentity reporter={reporter} />
    </div>

    {hasText(reporter.bio) && (
      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{reporter.bio}</p>
    )}

    <ReporterPoliticalBadge reporter={reporter} />
    <ReporterTopics reporter={reporter} />
    <ReporterCardFooter reporter={reporter} />
  </Link>
);

const ReporterCardIdentity = ({ reporter }: Readonly<{ reporter: ReporterCardData }>) => (
  <>
    <div className="min-w-0 flex-1">
      <h3 className="font-serif text-sm font-semibold group-hover:text-white truncate">
        {reporter.name}
      </h3>
      {hasText(reporter.current_outlet) && (
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
);

const ReporterPoliticalBadge = ({ reporter }: Readonly<{ reporter: ReporterCardData }>) => {
  if (!hasText(reporter.political_leaning)) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      <span
        className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${leaningBadgeClass(reporter.political_leaning)}`}
      >
        {reporter.political_leaning}
        {hasText(reporter.leaning_confidence) && (
          <span className="ml-1 opacity-60">({confidenceLabel(reporter.leaning_confidence)})</span>
        )}
      </span>
    </div>
  );
};

const ReporterTopics = ({ reporter }: Readonly<{ reporter: ReporterCardData }>) => {
  if (!reporter.topics || reporter.topics.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {reporter.topics.slice(0, 4).map((topic) => (
        <span
          key={topic}
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
  );
};

const ReporterCardFooter = ({ reporter }: Readonly<{ reporter: ReporterCardData }>) => (
  <div className="flex items-center justify-between mt-3 text-[10px] font-mono text-muted-foreground">
    {hasText(reporter.research_confidence) && <span>confidence: {reporter.research_confidence}</span>}
    {hasText(reporter.wikipedia_url) && (
      <span className="text-blue-400 flex items-center gap-0.5">
        wiki <ExternalLink className="w-2.5 h-2.5" />
      </span>
    )}
  </div>
);

// ── Main Page ────────────────────────────────────────────────────────

const getLeaningOptions = (reporters: ReporterCards): string[] => {
  const leanings = new Set<string>();
  reporters.forEach((reporter) => {
    if (hasText(reporter.political_leaning)) {
      leanings.add(reporter.political_leaning);
    }
  });
  return [...leanings].toSorted();
};

const filterReporters = (
  reporters: ReporterCards,
  searchQuery: string,
  leaningFilter: string,
): ReporterCardData[] => {
  let result = [...reporters];
  if (searchQuery.length > 0) {
    const query = searchQuery.toLowerCase();
    result = result.filter((reporter) => {
      const matchesName = reporter.name.toLowerCase().includes(query),
        matchesBio = reporter.bio?.toLowerCase().includes(query) === true,
        matchesTopic = reporter.topics?.some((topic) => topic.toLowerCase().includes(query)) === true;
      return matchesName || matchesBio || matchesTopic;
    });
  }
  if (leaningFilter !== "all") {
    const normalizedFilter = leaningFilter.toLowerCase();
    result = result.filter(
      (reporter) => reporter.political_leaning?.toLowerCase() === normalizedFilter,
    );
  }
  return result;
};

const errorMessageFor = (error: Error | null): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load reporters";
};

const resultCountLabel = (count: number): string => {
  if (count === 1) {
    return "1 result";
  }
  return `${count} results`;
};

const ReporterDirectoryPage = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [leaningFilter, setLeaningFilter] = useState("all");
  const {
    data: reporters = [],
    isLoading: loading,
    error,
  } = useQuery<ReporterCardData[]>({
    queryFn: () => fetchWikiReporters({ limit: 500 }),
    queryKey: ["wiki-reporters", 500],
    retry: 1,
  });
  const errorMessage = errorMessageFor(error);
  const leaningOptions = useMemo(() => getLeaningOptions(reporters), [reporters]);
  const filtered = useMemo(
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
};

interface ReporterDirectoryViewProps {
  readonly error: Readonly<Error> | null;
  readonly errorMessage: string;
  readonly filtered: ReporterCards;
  readonly isLoading: boolean;
  readonly leaningFilter: string;
  readonly leaningOptions: readonly string[];
  readonly onLeaningChange: (value: string) => void;
  readonly onSearchChange: (value: string) => void;
  readonly reporters: ReporterCards;
  readonly searchQuery: string;
}


const ReporterDirectoryView = ({
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
}: Readonly<ReporterDirectoryViewProps>) => (
  <div className="min-h-screen bg-[var(--news-bg-primary)]">
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/wiki/ownership"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
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

interface ReporterDirectoryFiltersProps {
  readonly leaningFilter: string;
  readonly leaningOptions: readonly string[];
  readonly onLeaningChange: (value: string) => void;
  readonly onSearchChange: (value: string) => void;
  readonly searchQuery: string;
}

const ReporterDirectoryFilters = ({
  leaningFilter,
  leaningOptions,
  onLeaningChange,
  onSearchChange,
  searchQuery,
}: Readonly<ReporterDirectoryFiltersProps>) => {
  const clearLeaning = useCallback(() => {
      onLeaningChange("all");
    }, [onLeaningChange]),
    clearSearch = useCallback(() => {
      onSearchChange("");
    }, [onSearchChange]),
    handleSearchChange = useCallback(
      (event: TextInputChange) => {
        onSearchChange(event.target.value);
      },
      [onSearchChange],
    ),
    hasActiveFilters = leaningFilter !== "all" || searchQuery.length > 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={handleSearchChange}
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
              <SelectItem key={leaning} value={leaning}>
                {leaning}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasActiveFilters && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Filters:
          </span>
          {searchQuery.length > 0 && (
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={clearSearch}
            >
              &quot;{searchQuery}&quot; x
            </Badge>
          )}
          {leaningFilter !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={clearLeaning}
            >
              {leaningFilter} x
            </Badge>
          )}
        </div>
      )}
    </>
  );
};

interface ReporterDirectoryResultsProps {
  readonly error: Readonly<Error> | null;
  readonly errorMessage: string;
  readonly filtered: ReporterCards;
  readonly isLoading: boolean;
}

const ReporterDirectoryResults = ({
  error,
  errorMessage,
  filtered,
  isLoading,
}: Readonly<ReporterDirectoryResultsProps>) => {
  const hasError = error !== null,
    hasResults = !isLoading && !hasError;
  return (
    <>
      <div className="mb-4 text-xs font-mono text-muted-foreground uppercase tracking-wider">
        {resultCountLabel(filtered.length)}
      </div>
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {hasError && !isLoading && (
        <div className="border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">
          {errorMessage}
        </div>
      )}
      {hasResults && <ReporterGrid reporters={filtered} />}
      {hasResults && filtered.length === 0 && <ReporterEmptyState />}
    </>
  );
};

const ReporterGrid = ({ reporters }: Readonly<{ reporters: ReporterCards }>) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
    {reporters.map((reporter) => (
      <ReporterCard key={reporter.id} reporter={reporter} />
    ))}
  </div>
);

const ReporterEmptyState = () => (
  <div className="text-center py-20 text-muted-foreground">
    <p className="font-serif text-lg">No reporters found</p>
    <p className="text-sm mt-1">Try adjusting your search criteria.</p>
  </div>
);
export default ReporterDirectoryPage;
