"use client";

import { useCallback } from "react";
import { AlertTriangle, BookOpen, ChevronDown, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NewsSource } from "@/lib/api";
import Link from "next/link";
import type { SidebarSection, SourceSidebarState } from "./source-sidebar-state";

interface SourceItemProps {
  readonly favorite: boolean;
  readonly onClose: () => void;
  readonly onToggleFavorite: () => void;
  readonly onToggleSelect: () => void;
  readonly selected: boolean;
  readonly source: Readonly<NewsSource>;
}

interface SourceListItemProps {
  readonly favoriteIds: (sourceId: string) => boolean;
  readonly onClose: () => void;
  readonly onToggleFavorite: (sourceId: string) => void;
  readonly onToggleSource: (sourceId: string) => void;
  readonly selectedIds: (sourceId: string) => boolean;
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
  readonly onClose: () => void;
  readonly state: SourceSidebarState;
}

const getSourceItemClassName = (selected: boolean): string => {
  if (selected) {
    return "border-white/20 bg-white/5";
  }
  return "border-white/10 hover:bg-[var(--news-bg-primary)]";
};

const getFavoriteLabel = (favorite: boolean): string => {
  if (favorite) {
    return "Remove favorite";
  }
  return "Add to favorites";
};

const getFavoriteIconClassName = (favorite: boolean): string => {
  if (favorite) {
    return "fill-current text-foreground";
  }
  return "text-muted-foreground hover:text-foreground";
};

const getSectionToggleClassName = (expanded: boolean): string => {
  if (expanded) {
    return "";
  }
  return "-rotate-90";
};

const SourceNameLink = ({
  onClose,
  source,
}: Readonly<Pick<SourceItemProps, "onClose" | "source">>) => (
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
);

const SourceWikiLink = ({
  onClose,
  source,
}: Readonly<Pick<SourceItemProps, "onClose" | "source">>) => (
  <Link
    href={`/wiki/source/${encodeURIComponent(source.name)}`}
    className="flex-shrink-0 p-1 text-muted-foreground transition-colors hover:text-primary"
    onClick={onClose}
    title="Wiki profile"
  >
    <BookOpen className="h-3.5 w-3.5" />
  </Link>
);

const SourceFavoriteButton = ({
  favorite,
  onToggleFavorite,
}: Readonly<Pick<SourceItemProps, "favorite" | "onToggleFavorite">>) => (
  <button
    type="button"
    onClick={onToggleFavorite}
    className="flex-shrink-0 rounded-md p-1 transition-colors hover:bg-[var(--news-bg-primary)]"
    title={getFavoriteLabel(favorite)}
  >
    <Star className={`h-4 w-4 transition-colors ${getFavoriteIconClassName(favorite)}`} />
  </button>
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
    className={`flex items-center gap-2 rounded-md border p-2 transition-colors ${getSourceItemClassName(selected)}`}
  >
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggleSelect}
      className="h-4 w-4 cursor-pointer rounded border-white/20"
    />
    <SourceNameLink onClose={onClose} source={source} />
    <SourceWikiLink onClose={onClose} source={source} />
    <SourceFavoriteButton favorite={favorite} onToggleFavorite={onToggleFavorite} />
  </div>
);

const SourceListItem = ({
  favoriteIds,
  onClose,
  onToggleFavorite,
  onToggleSource,
  selectedIds,
  source,
}: SourceListItemProps) => {
  const handleFavorite = useCallback(() => {
    onToggleFavorite(source.id);
  }, [onToggleFavorite, source.id]);
  const handleSelect = useCallback(() => {
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
}: SourceListProps) => {
  if (sources.length === 0) {
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
    <ChevronDown
      className={`h-4 w-4 transition-transform ${getSectionToggleClassName(expanded)}`}
    />
    {showStar && <Star className="h-4 w-4 text-foreground" />}
    <span className="text-xs font-mono uppercase tracking-[0.2em] text-foreground">{label}</span>
  </button>
);

const FavoriteSourceList = ({
  expanded,
  isFavorite,
  isSelected,
  onClose,
  onToggleFavorite,
  onToggleSource,
  sources,
}: Readonly<{
  expanded: boolean;
  isFavorite: (sourceId: string) => boolean;
  isSelected: (sourceId: string) => boolean;
  onClose: () => void;
  onToggleFavorite: (sourceId: string) => void;
  onToggleSource: (sourceId: string) => void;
  sources: readonly NewsSource[];
}>) => {
  if (!expanded) {
    return null;
  }
  return (
    <div className="ml-4">
      <SourceList
        emptyMessage="No favorite sources"
        favoriteIds={isFavorite}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
        onToggleSource={onToggleSource}
        selectedIds={isSelected}
        sources={sources}
      />
    </div>
  );
};

const FavoritesSection = ({
  expanded,
  favoriteSources,
  isFavorite,
  isSelected,
  onClose,
  onToggleFavorite,
  onToggleSection,
  onToggleSource,
}: Readonly<{
  expanded: boolean;
  favoriteSources: readonly NewsSource[];
  isFavorite: (sourceId: string) => boolean;
  isSelected: (sourceId: string) => boolean;
  onClose: () => void;
  onToggleFavorite: (sourceId: string) => void;
  onToggleSection: (section: SidebarSection) => void;
  onToggleSource: (sourceId: string) => void;
}>) => {
  const handleToggle = useCallback(() => {
    onToggleSection("favorites");
  }, [onToggleSection]);
  if (favoriteSources.length === 0) {
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
      <FavoriteSourceList
        expanded={expanded}
        isFavorite={isFavorite}
        isSelected={isSelected}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
        onToggleSource={onToggleSource}
        sources={favoriteSources}
      />
    </div>
  );
};

const SourceSelectionButtons = ({
  onClearAll,
  onSelectAll,
}: Readonly<{
  onClearAll: () => void;
  onSelectAll: () => void;
}>) => (
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
);

const AllSourcesList = ({
  emptyMessage,
  expanded,
  isFavorite,
  isSelected,
  onClose,
  onToggleFavorite,
  onToggleSource,
  sources,
}: Readonly<{
  emptyMessage: string;
  expanded: boolean;
  isFavorite: (sourceId: string) => boolean;
  isSelected: (sourceId: string) => boolean;
  onClose: () => void;
  onToggleFavorite: (sourceId: string) => void;
  onToggleSource: (sourceId: string) => void;
  sources: readonly NewsSource[];
}>) => {
  if (!expanded) {
    return null;
  }
  return (
    <div className="ml-2">
      <SourceList
        emptyMessage={emptyMessage}
        favoriteIds={isFavorite}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
        onToggleSource={onToggleSource}
        selectedIds={isSelected}
        sources={sources}
      />
    </div>
  );
};

const getEmptySourceMessage = (searchQuery: string): string => {
  if (searchQuery.trim() === "") {
    return "No sources available";
  }
  return "No sources match this search";
};

const AllSourcesHeader = ({
  expanded,
  onToggle,
  sourceCount,
}: Readonly<{
  expanded: boolean;
  onToggle: () => void;
  sourceCount: number;
}>) => (
  <div className="mb-3">
    <SectionToggle expanded={expanded} label={`All Sources (${sourceCount})`} onToggle={onToggle} />
  </div>
);

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
}: Readonly<{
  expanded: boolean;
  filteredSources: readonly NewsSource[];
  isFavorite: (sourceId: string) => boolean;
  isSelected: (sourceId: string) => boolean;
  onClearAll: () => void;
  onClose: () => void;
  onSelectAll: () => void;
  onToggleFavorite: (sourceId: string) => void;
  onToggleSection: (section: SidebarSection) => void;
  onToggleSource: (sourceId: string) => void;
  searchQuery: string;
  sourceCount: number;
}>) => {
  const emptyMessage = getEmptySourceMessage(searchQuery);
  const handleToggle = useCallback(() => {
    onToggleSection("allSources");
  }, [onToggleSection]);
  return (
    <div className="p-4">
      <AllSourcesHeader expanded={expanded} onToggle={handleToggle} sourceCount={sourceCount} />
      {expanded && <SourceSelectionButtons onClearAll={onClearAll} onSelectAll={onSelectAll} />}
      <AllSourcesList
        emptyMessage={emptyMessage}
        expanded={expanded}
        isFavorite={isFavorite}
        isSelected={isSelected}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
        onToggleSource={onToggleSource}
        sources={filteredSources}
      />
    </div>
  );
};

const SourceLoadErrorText = ({ errorMessage }: Readonly<{ errorMessage: string }>) => (
  <div>
    <div className="font-medium text-foreground">Source catalog unavailable</div>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{errorMessage}</p>
  </div>
);

const SourceLoadErrorBanner = ({ errorMessage }: Readonly<{ errorMessage: string }>) => (
  <div className="flex items-start gap-3 rounded-md border border-white/10 bg-[var(--news-bg-primary)]/40 p-4 text-sm text-muted-foreground">
    <AlertTriangle className="mt-0.5 h-4 w-4 text-primary" />
    <SourceLoadErrorText errorMessage={errorMessage} />
  </div>
);

const SourceLoadError = ({
  errorMessage,
  onRetry,
}: Readonly<{
  errorMessage: string;
  onRetry: () => void;
}>) => (
  <div className="space-y-3 p-4">
    <SourceLoadErrorBanner errorMessage={errorMessage} />
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

const SidebarSections = ({ onClose, state }: Readonly<SidebarContentProps>) => (
  <div className="divide-y divide-white/10">
    <FavoritesSection
      expanded={state.favoriteExpanded}
      favoriteSources={state.favoriteSources}
      isFavorite={state.isFavorite}
      isSelected={state.isSelected}
      onClose={onClose}
      onToggleFavorite={state.handleToggleFavorite}
      onToggleSection={state.handleToggleSection}
      onToggleSource={state.handleToggleSource}
    />
    <AllSourcesSection
      expanded={state.allExpanded}
      filteredSources={state.filteredSources}
      isFavorite={state.isFavorite}
      isSelected={state.isSelected}
      onClearAll={state.handleClearAll}
      onClose={onClose}
      onSelectAll={state.handleSelectAll}
      onToggleFavorite={state.handleToggleFavorite}
      onToggleSection={state.handleToggleSection}
      onToggleSource={state.handleToggleSource}
      searchQuery={state.searchQuery}
      sourceCount={state.sourceCount}
    />
  </div>
);

export const SidebarContent = ({ onClose, state }: Readonly<SidebarContentProps>) => {
  if (state.isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading sources...</div>;
  }
  if (state.errorMessage !== undefined) {
    return <SourceLoadError errorMessage={state.errorMessage} onRetry={state.handleRetry} />;
  }
  return <SidebarSections onClose={onClose} state={state} />;
};
