"use client";

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
import { NEWS_LENSES, getLensStats } from "@/lib/news-lens";
import { useCallback, useMemo, useState } from "react";
import { AddRssDialog } from "@/components/add-rss-dialog";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import type { NewsSource } from "@/lib/api";
import { SourceCoverageComparison } from "@/components/source-coverage-comparison";
import { fetchSources } from "@/lib/api";
import { useFavorites } from "@/hooks/use-favorites";
import { useNewsLens } from "@/hooks/use-news-lens";
import { useQuery } from "@tanstack/react-query";
import { useSourceFilter } from "@/hooks/use-source-filter";

const COVERAGE_COMPARISON_MIN_SOURCES = 2,
  EMPTY_RECENCY = 0,
  SOURCE_QUERY_RETRY_COUNT = 1;

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
    return sorted.toSorted((left, right) => {
      const leftFresh = sourceRecency[left.id] ?? EMPTY_RECENCY,
        rightFresh = sourceRecency[right.id] ?? EMPTY_RECENCY;
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
    const filtered =
        (() => {
  if (query.length === EMPTY_RECENCY) {
    return sources;
  }
  return sources.filter(source => {
    const sourceCountry = source.country.toLowerCase(),
      sourceName = source.name.toLowerCase();
    return sourceName.includes(query) || sourceCountry.includes(query);
  });
})();
    return sortSourcesByRecency(filtered, sourceRecency);
  };
const buildSourceNameLookup = (sources: readonly NewsSource[]) =>
    Object.fromEntries(
      sources.flatMap((source) => [
        [source.id, source.name],
        [source.slug, source.name],
      ]),
    );
const getSelectedSourceIds = (
    selectedSources: ReadonlySet<string>,
    sources: readonly NewsSource[],
  ): string[] =>
    sources
      .filter((source) => selectedSources.has(source.id) || selectedSources.has(source.slug))
      .map((source) => source.id);
const getLoadErrorMessage = (error: Error | null | undefined): string | undefined => error?.message;
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
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-md">
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
      return null;
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
    const sourceIds = useMemo(() => [...selectedSourceIds], [selectedSourceIds]);
    if (selectedSourceIds.length < COVERAGE_COMPARISON_MIN_SOURCES) {
      return null;
    }
    return (
      <div className="border-b border-white/10 px-4 py-3">
        <SourceCoverageComparison
          sourceIds={sourceIds}
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
  }>) => {
    const handleChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
      (event) => {
        onChange(event.target.value);
      },
      [onChange],
    );
    return (
      <div className="border-b border-white/10 px-4 py-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sources..."
            value={searchQuery}
            onChange={handleChange}
            className="h-9 rounded-md border-white/10 bg-[var(--news-bg-primary)] pl-8 text-foreground"
          />
        </div>
      </div>
    );
  };
const LensButton = ({
    lens,
    onSetLens,
    preset,
  }: Readonly<{
    lens: (typeof NEWS_LENSES)[number]["id"];
    onSetLens: (lens: (typeof NEWS_LENSES)[number]["id"]) => void;
    preset: Readonly<(typeof NEWS_LENSES)[number]>;
  }>) => {
    const handleClick = useCallback(() => {
      onSetLens(preset.id);
    }, [onSetLens, preset.id]);
    return (
      <button
        type="button"
        onClick={handleClick}
        title={preset.description}
        className={`rounded-md border px-2 py-2 text-left text-[10px] font-mono uppercase tracking-[0.16em] transition-colors ${
          (() => {
  if (lens === preset.id) {
    return "border-primary/60 bg-primary/10 text-foreground";
  }
  return "border-white/10 bg-[var(--news-bg-primary)]/40 text-muted-foreground hover:text-foreground";
})()
        }`}
      >
        {preset.label}
      </button>
    );
  };
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
          <LensButton
            key={preset.id}
            lens={lens}
            onSetLens={onSetLens}
            preset={preset}
          />
        ))}
      </div>
    </div>
  );
const WikiLink = ({
    href,
    icon,
    label,
    onClose,
  }: Readonly<{
    href: string;
    icon: "book" | "users" | "graph";
    label: string;
    onClose: () => void;
  }>) => {
    const Icon = { book: BookOpen, graph: GitBranch, users: Users }[icon];
    return (
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
  };
const WikiSection = ({ onClose }: Readonly<{ onClose: () => void }>) => (
    <div className="border-b border-white/10 px-4 py-3">
      <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
        Wiki
      </div>
      <div className="space-y-2">
        <WikiLink href="/wiki/ownership" icon="book" label="Source Wiki" onClose={onClose} />
        <WikiLink href="/wiki/reporters" icon="users" label="Reporter Wiki" onClose={onClose} />
        <WikiLink
          href="/wiki/ownership"
          icon="graph"
          label="Ownership Graph"
          onClose={onClose}
        />
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
        (() => {
  if (selected) {
    return "border-white/20 bg-white/5";
  }
  return "border-white/10 hover:bg-[var(--news-bg-primary)]";
})()
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
        title={(() => {
  if (favorite) {
    return "Remove favorite";
  }
  return "Add to favorites";
})()}
      >
        <Star
          className={`h-4 w-4 transition-colors ${
            (() => {
  if (favorite) {
    return "fill-current text-foreground";
  }
  return "text-muted-foreground hover:text-foreground";
})()
          }`}
        />
      </button>
    </div>
  );
const SourceListItem = ({
    favoriteIds,
    onClose,
    onToggleFavorite,
    onToggleSource,
    selectedIds,
    source,
  }: Readonly<{
    favoriteIds: (sourceId: string) => boolean;
    onClose: () => void;
    onToggleFavorite: (sourceId: string) => void;
    onToggleSource: (sourceId: string) => void;
    selectedIds: (sourceId: string) => boolean;
    source: Readonly<NewsSource>;
  }>) => {
    const handleFavorite = useCallback(() => {
        onToggleFavorite(source.id);
      }, [onToggleFavorite, source.id]),
      handleSelect = useCallback(() => {
        onToggleSource(source.id);
      }, [onToggleSource, source.id]);
    return (
      <SourceItem
        favorite={favoriteIds(source.id)}
        onClose={onClose}
        onToggleFavorite={handleFavorite}
        onToggleSelect={handleSelect}
        selected={selectedIds(source.id)}
        source={source}
      />
    );
  };
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
          <SourceListItem
            key={source.id}
            favoriteIds={favoriteIds}
            onClose={onClose}
            onToggleFavorite={onToggleFavorite}
            onToggleSource={onToggleSource}
            selectedIds={selectedIds}
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
      <ChevronDown className={`h-4 w-4 transition-transform ${(() => {
  if (expanded) {
    return "";
  }
  return "-rotate-90";
})()}`} />
      {showStar && <Star className="h-4 w-4 text-foreground" />}
      <span className="text-xs font-mono uppercase tracking-[0.2em] text-foreground">{label}</span>
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
  }: Readonly<
    Pick<
      SidebarContentProps,
      | "favoriteSources"
      | "isFavorite"
      | "isSelected"
      | "onClose"
      | "onToggleFavorite"
      | "onToggleSection"
      | "onToggleSource"
    > & { expanded: boolean }
  >) => {
    const handleToggle = useCallback(() => {
      onToggleSection("favorites");
    }, [onToggleSection]);
    if (favoriteSources.length === EMPTY_RECENCY) {
      return null;
    }
    return (
      <div className="p-4">
        <div className="mb-3">
          <SectionToggle
            expanded={expanded}
            label={`Favorites (${favoriteSources.length})`}
            onToggle={handleToggle}
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
  }: Readonly<
    Pick<
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
    > & { expanded: boolean }
  >) => {
    const emptyMessage =
      (() => {
  if (searchQuery.trim().length > EMPTY_RECENCY) {
    return "No sources match this search";
  }
  return "No sources available";
})();
    const handleToggle = useCallback(() => {
      onToggleSection("allSources");
    }, [onToggleSection]);
    return (
      <div className="p-4">
        <div className="mb-3">
          <SectionToggle
            expanded={expanded}
            label={`All Sources (${sourceCount})`}
            onToggle={handleToggle}
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
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{errorMessage}</p>
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

export const SourceSidebar = ({ isOpen, onClose, sourceRecency }: Readonly<SourceSidebarProps>) => {
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
  const filterLabel =
      (() => {
  if (lens === "all") {
    return `${getSelectionCount()} selected`;
  }
  return `${NEWS_LENSES.find(preset => preset.id === lens)?.label ?? "Lens"}: ${lensStats.included} in / ${lensStats.excluded} out`;
})();
  const toggleSection = useCallback(
      (section: SidebarSection) => {
        setExpandedSections((previous) => ({
          ...previous,
          [section]: !previous[section],
        }));
      },
      [],
    );
  const clearFilters = useCallback(() => {
      clearAll();
      clearLens();
    }, [clearAll, clearLens]);
  const selectEverySource = useCallback(() => {
      selectAll(sources.map((source) => source.id));
    }, [selectAll, sources]);
  const retry = useCallback(() => {
      void refetch();
    }, [refetch]);
  const handleSetLens = useCallback(
      (nextLens: (typeof NEWS_LENSES)[number]["id"]) => {
        setLens(nextLens);
      },
      [setLens],
    );

    if (!isOpen) {
    return null;
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
        <LensSection
          lens={lens}
          onSetLens={handleSetLens}
        />
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
