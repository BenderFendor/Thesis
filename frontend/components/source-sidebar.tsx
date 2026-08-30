"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  GitBranch,
  Search,
  Star,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";

import { AddRssDialog } from "@/components/add-rss-dialog";
import { SourceCoverageComparison } from "@/components/source-coverage-comparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFavorites } from "@/hooks/useFavorites";
import { useNewsLens } from "@/hooks/useNewsLens";
import { useSourceFilter } from "@/hooks/use-source-filter";
import type { NewsSource } from "@/lib/api";
import { fetchSources } from "@/lib/api";
import { getLensStats, NEWS_LENSES } from "@/lib/news-lens";

const SOURCE_QUERY_RETRY_COUNT = 1;
const COVERAGE_COMPARISON_MIN_SOURCES = 2;
const EMPTY_RECENCY = 0;

type SidebarSection = "allSources" | "favorites";

interface SourceSidebarProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sourceRecency?: Readonly<Record<string, number>>;
}

interface SourceItemProps {
  readonly favorite: boolean;
  readonly onClose: () => void;
  readonly onToggleFavorite: () => void;
  readonly onToggleSelect: () => void;
  readonly selected: boolean;
  readonly source: Readonly<NewsSource>;
}

interface SourceListProps {
  readonly emptyMessage: string;
  readonly favoriteIds: (sourceId: string) => boolean;
  readonly onClose: () => void;
  readonly onToggleFavorite: (sourceId: string) => void;
  readonly onToggleSource: (sourceId: string) => void;
  readonly selectedIds: (sourceId: string) => boolean;
  readonly sources: readonly NewsSource[];
}

interface SidebarContentProps {
  readonly allExpanded: boolean;
  readonly errorMessage?: string;
  readonly favoriteExpanded: boolean;
  readonly favoriteSources: readonly NewsSource[];
  readonly filteredSources: readonly NewsSource[];
  readonly isFavorite: (sourceId: string) => boolean;
  readonly isLoading: boolean;
  readonly isSelected: (sourceId: string) => boolean;
  readonly onClearAll: () => void;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onSelectAll: () => void;
  readonly onToggleFavorite: (sourceId: string) => void;
  readonly onToggleSection: (section: SidebarSection) => void;
  readonly onToggleSource: (sourceId: string) => void;
  readonly searchQuery: string;
  readonly sourceCount: number;
}

const sortSourcesByRecency = (
  sources: readonly NewsSource[],
  sourceRecency?: Readonly<Record<string, number>>,
): NewsSource[] => {
  const sorted = [...sources];
  if (sourceRecency === undefined) {
    return sorted;
  }
  return sorted.sort((left, right) => {
    const leftFresh = sourceRecency[left.id] ?? EMPTY_RECENCY;
    const rightFresh = sourceRecency[right.id] ?? EMPTY_RECENCY;
    if (leftFresh !== rightFresh) {
      return rightFresh - leftFresh;
    }
    return left.name.localeCompare(right.name);
  });
};

const getFavoriteSources = (
  sources: readonly NewsSource[],
  isFavorite: (sourceId: string) => boolean,
  sourceRecency?: Readonly<Record<string, number>>,
): NewsSource[] =>
  sortSourcesByRecency(
    sources.filter((source) => isFavorite(source.id)),
    sourceRecency,
  );

const getFilteredSources = (
  sources: readonly NewsSource[],
  searchQuery: string,
  sourceRecency?: Readonly<Record<string, number>>,
): NewsSource[] => {
  const query = searchQuery.trim().toLowerCase();
  const filtered = query.length === EMPTY_RECENCY
    ? sources
    : sources.filter((source) => {
        const sourceName = source.name.toLowerCase();
        const sourceCountry = source.country.toLowerCase();
        return sourceName.includes(query) || sourceCountry.includes(query);
      });
  return sortSourcesByRecency(filtered, sourceRecency);
};

const buildSourceNameLookup = (
  sources: readonly NewsSource[],
): Readonly<Record<string, string>> => {
  const lookup: Record<string, string> = {};
  for (const source of sources) {
    lookup[source.id] = source.name;
    lookup[source.slug] = source.name;
  }
  return lookup;
};

const getSelectedSourceIds = (
  selectedSources: ReadonlySet<string>,
  sources: readonly NewsSource[],
): string[] =>
  sources
    .filter(
      (source) =>
        selectedSources.has(source.id) || selectedSources.has(source.slug),
    )
    .map((source) => source.id);

const getLoadErrorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  return undefined;
};

const SourceSidebarHeader = ({
  onClose,
  onSourceAdded,
}: Readonly<{
  onClose: () => void;
  onSourceAdded: () => void;
}>) => (
  <div className="flex items-center justify-between border-b border-white/10 p-4">
    <h2 className="text-sm font-mono uppercase tracking-[0.3em] text-muted-foreground">
      Sources
    </h2>
    <div className="flex items-center gap-2">
      <AddRssDialog onSourceAdded={onSourceAdded} />
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="h-8 w-8 rounded-md"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  </div>
);

const ActiveFilterBadge = ({
  active,
  label,
  onClear,
}: Readonly<{
  active: boolean;
  label: string;
  onClear: () => void;
}>) => {
  if (!active) {
    return undefined;
  }
  return (
    <div className="px-4 pb-1 pt-2">
      <Badge
        variant="outline"
        className="cursor-pointer border-white/10 bg-white/5 text-[10px] font-mono uppercase tracking-[0.3em] text-foreground/80"
        onClick={onClear}
      >
        {label}
      </Badge>
    </div>
  );
};

const CoverageSection = ({
  selectedSourceIds,
  sourceNameLookup,
}: Readonly<{
  selectedSourceIds: readonly string[];
  sourceNameLookup: Readonly<Record<string, string>>;
}>) => {
  if (selectedSourceIds.length < COVERAGE_COMPARISON_MIN_SOURCES) {
    return undefined;
  }
  return (
    <div className="border-b border-white/10 px-4 py-3">
      <SourceCoverageComparison
        sourceIds={[...selectedSourceIds]}
        sourceNames={sourceNameLookup}
      />
    </div>
  );
};

const SourceSearch = ({
  onChange,
  searchQuery,
}: Readonly<{
  onChange: (value: string) => void;
  searchQuery: string;
}>) => (
  <div className="border-b border-white/10 px-4 py-3">
    <div className="relative">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search sources..."
        value={searchQuery}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border-white/10 bg-[var(--news-bg-primary)] pl-8 text-foreground"
      />
    </div>
  </div>
);

const LensSection = ({
  lens,
  onSetLens,
}: Readonly<{
  lens: (typeof NEWS_LENSES)[number]["id"];
  onSetLens: (lens: (typeof NEWS_LENSES)[number]["id"]) => void;
}>) => (
  <div className="border-b border-white/10 px-4 py-3">
    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
      News Lens
    </div>
    <div className="grid grid-cols-2 gap-1.5">
      {NEWS_LENSES.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onSetLens(preset.id)}
          title={preset.description}
          className={`rounded-md border px-2 py-2 text-left text-[10px] font-mono uppercase tracking-[0.16em] transition-colors ${
            lens === preset.id
              ? "border-primary/60 bg-primary/10 text-foreground"
              : "border-white/10 bg-[var(--news-bg-primary)]/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  </div>
);

const WikiLink = ({
  href,
  icon: Icon,
  label,
  onClose,
}: Readonly<{
  href: string;
  icon: typeof BookOpen;
  label: string;
  onClose: () => void;
}>) => (
  <Link
    href={href}
    className="flex items-center justify-between rounded-md border border-white/10 bg-[var(--news-bg-primary)]/40 px-3 py-2 text-sm text-foreground transition-colors hover:bg-[var(--news-bg-primary)]"
    onClick={onClose}
  >
    <span className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </span>
  </Link>
);

const WikiSection = ({ onClose }: Readonly<{ onClose: () => void }>) => (
  <div className="border-b border-white/10 px-4 py-3">
    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
      Wiki
    </div>
    <div className="space-y-2">
      <WikiLink href="/wiki/ownership" icon={BookOpen} label="Source Wiki" onClose={onClose} />
      <WikiLink href="/wiki/reporters" icon={Users} label="Reporter Wiki" onClose={onClose} />
      <WikiLink href="/wiki/ownership" icon={GitBranch} label="Ownership Graph" onClose={onClose} />
    </div>
  </div>
);

const SourceItem = ({
  favorite,
  onClose,
  onToggleFavorite,
  onToggleSelect,
  selected,
  source,
}: Readonly<SourceItemProps>) => (
  <div
    className={`flex items-center gap-2 rounded-md border p-2 transition-colors ${
      selected
        ? "border-white/20 bg-white/5"
        : "border-white/10 hover:bg-[var(--news-bg-primary)]"
    }`}
  >
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggleSelect}
      className="h-4 w-4 cursor-pointer rounded border-white/20"
    />
    <Link
      href={`/source/${encodeURIComponent(source.id)}`}
      className="group min-w-0 flex-1"
      onClick={onClose}
    >
      <p className="truncate text-sm font-medium transition-colors group-hover:text-primary">
        {source.name}
      </p>
      <p className="truncate text-xs text-muted-foreground">{source.country}</p>
    </Link>
    <Link
      href={`/wiki/source/${encodeURIComponent(source.name)}`}
      className="flex-shrink-0 p-1 text-muted-foreground transition-colors hover:text-primary"
      onClick={onClose}
      title="Wiki profile"
    >
      <BookOpen className="h-3.5 w-3.5" />
    </Link>
    <button
      type="button"
      onClick={onToggleFavorite}
      className="flex-shrink-0 rounded-md p-1 transition-colors hover:bg-[var(--news-bg-primary)]"
      title={favorite ? "Remove favorite" : "Add to favorites"}
    >
      <Star
        className={`h-4 w-4 transition-colors ${
          favorite
            ? "fill-current text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      />
    </button>
  </div>
);

const SourceList = ({
  emptyMessage,
  favoriteIds,
  onClose,
  onToggleFavorite,
  onToggleSource,
  selectedIds,
  sources,
}: Readonly<SourceListProps>) => {
  if (sources.length === EMPTY_RECENCY) {
    return <div className="py-2 text-xs text-muted-foreground">{emptyMessage}</div>;
  }
  return (
    <div className="space-y-2">
      {sources.map((source) => (
        <SourceItem
          key={source.id}
          favorite={favoriteIds(source.id)}
          onClose={onClose}
          onToggleFavorite={() => onToggleFavorite(source.id)}
          onToggleSelect={() => onToggleSource(source.id)}
          selected={selectedIds(source.id)}
          source={source}
        />
      ))}
    </div>
  );
};

const SectionToggle = ({
  expanded,
  label,
  onToggle,
  showStar = false,
}: Readonly<{
  expanded: boolean;
  label: string;
  onToggle: () => void;
  showStar?: boolean;
}>) => (
  <button
    type="button"
    onClick={onToggle}
    className="flex w-full items-center gap-2 transition-opacity hover:opacity-70"
  >
    <ChevronDown
      className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
    />
    {showStar && <Star className="h-4 w-4 text-foreground" />}
    <span className="text-xs font-mono uppercase tracking-[0.2em] text-foreground">
      {label}
    </span>
  </button>
);

const FavoritesSection = ({
  expanded,
  favoriteSources,
  isFavorite,
  isSelected,
  onClose,
  onToggleFavorite,
  onToggleSection,
  onToggleSource,
}: Readonly<Pick<
  SidebarContentProps,
  | "favoriteSources"
  | "isFavorite"
  | "isSelected"
  | "onClose"
  | "onToggleFavorite"
  | "onToggleSection"
  | "onToggleSource"
> & { expanded: boolean }>) => {
  if (favoriteSources.length === EMPTY_RECENCY) {
    return undefined;
  }
  return (
    <div className="p-4">
      <div className="mb-3">
        <SectionToggle
          expanded={expanded}
          label={`Favorites (${favoriteSources.length})`}
          onToggle={() => onToggleSection("favorites")}
          showStar
        />
      </div>
      {expanded && (
        <div className="ml-4">
          <SourceList
            emptyMessage="No favorite sources"
            favoriteIds={isFavorite}
            onClose={onClose}
            onToggleFavorite={onToggleFavorite}
            onToggleSource={onToggleSource}
            selectedIds={isSelected}
            sources={favoriteSources}
          />
        </div>
      )}
    </div>
  );
};

const AllSourcesSection = ({
  expanded,
  filteredSources,
  isFavorite,
  isSelected,
  onClearAll,
  onClose,
  onSelectAll,
  onToggleFavorite,
  onToggleSection,
  onToggleSource,
  searchQuery,
  sourceCount,
}: Readonly<Pick<
  SidebarContentProps,
  | "filteredSources"
  | "isFavorite"
  | "isSelected"
  | "onClearAll"
  | "onClose"
  | "onSelectAll"
  | "onToggleFavorite"
  | "onToggleSection"
  | "onToggleSource"
  | "searchQuery"
  | "sourceCount"
> & { expanded: boolean }>) => {
  const emptyMessage = searchQuery.trim().length > EMPTY_RECENCY
    ? "No sources match this search"
    : "No sources available";
  return (
    <div className="p-4">
      <div className="mb-3">
        <SectionToggle
          expanded={expanded}
          label={`All Sources (${sourceCount})`}
          onToggle={() => onToggleSection("allSources")}
        />
      </div>
      {expanded && (
        <div className="mb-3 flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            className="h-8 rounded-md border-white/10 text-[10px] font-mono uppercase tracking-[0.2em]"
          >
            All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearAll}
            className="h-8 rounded-md border-white/10 text-[10px] font-mono uppercase tracking-[0.2em]"
          >
            Clear
          </Button>
        </div>
      )}
      {expanded && (
        <div className="ml-2">
          <SourceList
            emptyMessage={emptyMessage}
            favoriteIds={isFavorite}
            onClose={onClose}
            onToggleFavorite={onToggleFavorite}
            onToggleSource={onToggleSource}
            selectedIds={isSelected}
            sources={filteredSources}
          />
        </div>
      )}
    </div>
  );
};

const SourceLoadError = ({
  errorMessage,
  onRetry,
}: Readonly<{
  errorMessage: string;
  onRetry: () => void;
}>) => (
  <div className="space-y-3 p-4">
    <div className="flex items-start gap-3 rounded-md border border-white/10 bg-[var(--news-bg-primary)]/40 p-4 text-sm text-muted-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 text-primary" />
      <div>
        <div className="font-medium text-foreground">Source catalog unavailable</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {errorMessage}
        </p>
      </div>
    </div>
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
      className="w-full rounded-md border-white/10"
    >
      Retry
    </Button>
  </div>
);

const SidebarContent = ({
  allExpanded,
  errorMessage,
  favoriteExpanded,
  favoriteSources,
  filteredSources,
  isFavorite,
  isLoading,
  isSelected,
  onClearAll,
  onClose,
  onRetry,
  onSelectAll,
  onToggleFavorite,
  onToggleSection,
  onToggleSource,
  searchQuery,
  sourceCount,
}: Readonly<SidebarContentProps>) => {
  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading sources...</div>;
  }
  if (errorMessage !== undefined) {
    return <SourceLoadError errorMessage={errorMessage} onRetry={onRetry} />;
  }
  return (
    <div className="divide-y divide-white/10">
      <FavoritesSection
        expanded={favoriteExpanded}
        favoriteSources={favoriteSources}
        isFavorite={isFavorite}
        isSelected={isSelected}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
        onToggleSection={onToggleSection}
        onToggleSource={onToggleSource}
      />
      <AllSourcesSection
        expanded={allExpanded}
        filteredSources={filteredSources}
        isFavorite={isFavorite}
        isSelected={isSelected}
        onClearAll={onClearAll}
        onClose={onClose}
        onSelectAll={onSelectAll}
        onToggleFavorite={onToggleFavorite}
        onToggleSection={onToggleSection}
        onToggleSource={onToggleSource}
        searchQuery={searchQuery}
        sourceCount={sourceCount}
      />
    </div>
  );
};

export const SourceSidebar = ({
  isOpen,
  onClose,
  sourceRecency,
}: Readonly<SourceSidebarProps>) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    allSources: true,
    favorites: true,
  });
  const { isFavorite, toggleFavorite } = useFavorites();
  const { clearLens, lens, setLens } = useNewsLens();
  const {
    clearAll,
    getSelectionCount,
    isFilterActive,
    isSelected,
    selectAll,
    selectedSources,
    toggleSource,
  } = useSourceFilter();
  const {
    data: sources = [],
    error,
    isLoading,
    refetch,
  } = useQuery<NewsSource[]>({
    enabled: isOpen,
    queryFn: fetchSources,
    queryKey: ["all-sources"],
    retry: SOURCE_QUERY_RETRY_COUNT,
  });
  const favoriteSources = useMemo(
    () => getFavoriteSources(sources, isFavorite, sourceRecency),
    [sources, isFavorite, sourceRecency],
  );
  const filteredSources = useMemo(
    () => getFilteredSources(sources, searchQuery, sourceRecency),
    [sources, searchQuery, sourceRecency],
  );
  const sourceNameLookup = useMemo(() => buildSourceNameLookup(sources), [sources]);
  const selectedSourceIds = useMemo(
    () => getSelectedSourceIds(selectedSources, sources),
    [selectedSources, sources],
  );
  const lensStats = useMemo(() => getLensStats(sources, lens), [lens, sources]);
  const errorMessage = getLoadErrorMessage(error);
  const filterActive = isFilterActive() || lens !== "all";
  const filterLabel = lens === "all"
    ? `${getSelectionCount()} selected`
    : `${NEWS_LENSES.find((preset) => preset.id === lens)?.label ?? "Lens"}: ${lensStats.included} in / ${lensStats.excluded} out`;

  const toggleSection = (section: SidebarSection) => {
    setExpandedSections((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  };
  const clearFilters = () => {
    clearAll();
    clearLens();
  };
  const selectEverySource = () => {
    selectAll(sources.map((source) => source.id));
  };
  const retry = () => {
    void refetch();
  };

  if (!isOpen) {
    return undefined;
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close source sidebar"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <aside className="relative flex w-full max-w-[22rem] flex-col overflow-hidden border-r border-white/10 bg-[var(--news-bg-secondary)] sm:w-80">
        <SourceSidebarHeader onClose={onClose} onSourceAdded={retry} />
        <ActiveFilterBadge active={filterActive} label={filterLabel} onClear={clearFilters} />
        <CoverageSection
          selectedSourceIds={selectedSourceIds}
          sourceNameLookup={sourceNameLookup}
        />
        <SourceSearch onChange={setSearchQuery} searchQuery={searchQuery} />
        <LensSection lens={lens} onSetLens={setLens} />
        <WikiSection onClose={onClose} />
        <div className="flex-1 overflow-y-auto">
          <SidebarContent
            allExpanded={expandedSections.allSources}
            errorMessage={errorMessage}
            favoriteExpanded={expandedSections.favorites}
            favoriteSources={favoriteSources}
            filteredSources={filteredSources}
            isFavorite={isFavorite}
            isLoading={isLoading}
            isSelected={isSelected}
            onClearAll={clearAll}
            onClose={onClose}
            onRetry={retry}
            onSelectAll={selectEverySource}
            onToggleFavorite={toggleFavorite}
            onToggleSection={toggleSection}
            onToggleSource={toggleSource}
            searchQuery={searchQuery}
            sourceCount={sources.length}
          />
        </div>
      </aside>
    </div>
  );
};
