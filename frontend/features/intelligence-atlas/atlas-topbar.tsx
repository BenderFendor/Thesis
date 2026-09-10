"use client";

import { hasText } from "@/lib/utils";

import { Copy, Download, Focus, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback } from "react";
import type { DeepReadonly } from "@/lib/deep-readonly";

import type { AtlasSearchItem } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

const SEARCH_ENTITY_TYPES = ["outlet", "organization", "person", "reporter"] as const;

const humanize = (value: string): string =>
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());

const pluralGroupLabel = (type: string): string => {
  if (type === "person") {
    return "People";
  }
  return `${humanize(type)}s`;
};

const parseIndexedTimestamp = (value?: string | null): number | null => {
  if (!hasText(value)) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
};

const formatDateDistance = (seconds: number): string => {
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return `${Math.round(seconds / 86_400)}d ago`;
};

const dateDistance = (value?: string | null): string => {
  const timestamp = parseIndexedTimestamp(value);
  if (timestamp === null) {
    return "Not indexed";
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return formatDateDistance(seconds);
};

type ReadonlyAtlasSearchItem = DeepReadonly<AtlasSearchItem>;

type AtlasSearchChangeEvent = Readonly<{
  readonly target: Readonly<{ readonly value: string }>;
}>;
type AtlasSearchKeyDownEvent = Readonly<{
  readonly key: string;
  readonly preventDefault: () => void;
}>;

interface AtlasSearchResultButtonProps {
  readonly activeSearchIndex: number;
  readonly index: number;
  readonly item: ReadonlyAtlasSearchItem;
  readonly onChooseSearchResult: (item: ReadonlyAtlasSearchItem) => void;
  readonly onSearchHover: (index: number) => void;
}

const AtlasSearchResultIdentity = ({ item }: Readonly<{ item: ReadonlyAtlasSearchItem }>) => (
  <>
    <span className={styles.entityMark} data-type={item.entity_type} aria-hidden="true">
      {item.entity_type.slice(0, 2).toUpperCase()}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-sm text-[#f0ede4]">{item.label}</span>
      <span className="mt-1 block truncate text-xs text-[#77736a]">
        {item.subtitle ?? item.country_code ?? item.id}
      </span>
    </span>
  </>
);

const AtlasSearchResultConfidence = ({ item }: Readonly<{ item: ReadonlyAtlasSearchItem }>) => (
  <span className={styles.confidence} data-tier={item.confidence_tier ?? "unresolved"}>
    {item.confidence_tier ?? "unresolved"}
  </span>
);

const AtlasSearchResultButton = ({
  activeSearchIndex,
  index,
  item,
  onChooseSearchResult,
  onSearchHover,
}: Readonly<AtlasSearchResultButtonProps>) => {
  const handleMouseEnter = useCallback(() => {
    onSearchHover(index);
  }, [index, onSearchHover]);
  const handleChoose = useCallback(() => {
    onChooseSearchResult(item);
  }, [item, onChooseSearchResult]);

  return (
    <button
      type="button"
      className={styles.searchResult}
      data-active={index === activeSearchIndex}
      onMouseEnter={handleMouseEnter}
      onClick={handleChoose}
    >
      <AtlasSearchResultIdentity item={item} />
      <AtlasSearchResultConfidence item={item} />
    </button>
  );
};

interface AtlasSearchResultListProps {
  readonly activeSearchIndex: number;
  readonly searchItems: readonly ReadonlyAtlasSearchItem[];
  readonly type: (typeof SEARCH_ENTITY_TYPES)[number];
  readonly onChooseSearchResult: (item: ReadonlyAtlasSearchItem) => void;
  readonly onSearchHover: (index: number) => void;
}

const AtlasSearchResultList = ({
  activeSearchIndex,
  searchItems,
  type,
  onChooseSearchResult,
  onSearchHover,
}: Readonly<AtlasSearchResultListProps>) => (
  <ul className="m-0 list-none p-0">
    {searchItems
      .filter((item) => item.entity_type === type)
      .map((item) => {
        const index = searchItems.findIndex((candidate) => candidate.id === item.id);
        return (
          <li key={item.id}>
            <AtlasSearchResultButton
              activeSearchIndex={activeSearchIndex}
              index={index}
              item={item}
              onChooseSearchResult={onChooseSearchResult}
              onSearchHover={onSearchHover}
            />
          </li>
        );
      })}
  </ul>
);

interface AtlasSearchGroupProps extends Omit<AtlasSearchResultListProps, "type"> {
  readonly type: (typeof SEARCH_ENTITY_TYPES)[number];
}

const AtlasSearchGroup = ({
  type,
  activeSearchIndex,
  searchItems,
  onChooseSearchResult,
  onSearchHover,
}: Readonly<AtlasSearchGroupProps>) => (
  <li className={styles.searchGroup}>
    <div className={`${styles.microLabel} px-2 pb-2`}>{pluralGroupLabel(type)}</div>
    <AtlasSearchResultList
      activeSearchIndex={activeSearchIndex}
      searchItems={searchItems}
      type={type}
      onChooseSearchResult={onChooseSearchResult}
      onSearchHover={onSearchHover}
    />
  </li>
);

interface AtlasSearchResultsProps {
  readonly activeSearchIndex: number;
  readonly items: readonly ReadonlyAtlasSearchItem[];
  readonly searching: boolean;
  readonly onChooseSearchResult: (item: ReadonlyAtlasSearchItem) => void;
  readonly onSearchHover: (index: number) => void;
}

const AtlasSearchResults = ({
  activeSearchIndex,
  items: searchItems,
  searching,
  onChooseSearchResult,
  onSearchHover,
}: Readonly<AtlasSearchResultsProps>) => {
  if (searching) {
    return (
      <li className="flex items-center gap-2 p-4 text-sm text-[#77736a]">
        <Loader2 className="h-4 w-4 animate-spin" /> Searching indexed entities
      </li>
    );
  }
  if (searchItems.length === 0) {
    return <li className="p-4 text-sm text-[#77736a]">No indexed entity matches this query.</li>;
  }
  return (
    <>
      {SEARCH_ENTITY_TYPES.map((type) => {
        if (!searchItems.some((item) => item.entity_type === type)) {
          return null;
        }
        return (
          <AtlasSearchGroup
            key={type}
            activeSearchIndex={activeSearchIndex}
            searchItems={searchItems}
            type={type}
            onChooseSearchResult={onChooseSearchResult}
            onSearchHover={onSearchHover}
          />
        );
      })}
    </>
  );
};

interface AtlasInputRef<TInput extends HTMLInputElement> {
  readonly current: TInput | null;
}

interface AtlasSearchDropdownProps {
  readonly activeSearchIndex: number;
  readonly searchItems: readonly ReadonlyAtlasSearchItem[];
  readonly searchOpen: boolean;
  readonly searchText: string;
  readonly searching: boolean;
  readonly onChooseSearchResult: (item: ReadonlyAtlasSearchItem) => void;
  readonly onSearchHover: (index: number) => void;
}

const AtlasSearchDropdown = ({
  activeSearchIndex,
  searchItems,
  searchOpen,
  searchText,
  searching,
  onChooseSearchResult,
  onSearchHover,
}: Readonly<AtlasSearchDropdownProps>) => {
  if (!searchOpen || !searchText.trim()) {
    return null;
  }
  return (
    <ul id="atlas-search-results" className={`${styles.searchResults} m-0 list-none p-0`}>
      <AtlasSearchResults
        activeSearchIndex={activeSearchIndex}
        items={searchItems}
        searching={searching}
        onChooseSearchResult={onChooseSearchResult}
        onSearchHover={onSearchHover}
      />
    </ul>
  );
};

interface AtlasSearchProps<TInput extends HTMLInputElement> extends AtlasSearchDropdownProps {
  readonly inputRef: AtlasInputRef<TInput>;
  readonly onSearchChange: (event: AtlasSearchChangeEvent) => void;
  readonly onSearchFocus: () => void;
  readonly onSearchKeyDown: (event: AtlasSearchKeyDownEvent) => void;
}

const AtlasSearch = <TInput extends HTMLInputElement>({
  inputRef,
  searchText,
  searchOpen,
  searchItems,
  activeSearchIndex,
  searching,
  onSearchChange,
  onSearchFocus,
  onSearchKeyDown,
  onSearchHover,
  onChooseSearchResult,
}: Readonly<AtlasSearchProps<TInput>>) => (
  <div className={styles.searchWrap}>
    <Search className={styles.searchIcon} />
    <input
      ref={inputRef}
      value={searchText}
      onChange={onSearchChange}
      onFocus={onSearchFocus}
      onKeyDown={onSearchKeyDown}
      className={styles.searchInput}
      id="atlas-search"
      name="atlas-search"
      placeholder="Search outlets, owners, reporters, countries, or IDs"
      aria-label="Search Intelligence Atlas"
      aria-expanded={searchOpen}
      aria-controls="atlas-search-results"
      role="combobox"
      autoComplete="off"
    />
    <span className={styles.searchShortcut}>⌘K</span>
    <AtlasSearchDropdown
      activeSearchIndex={activeSearchIndex}
      searchItems={searchItems}
      searchOpen={searchOpen}
      searchText={searchText}
      searching={searching}
      onChooseSearchResult={onChooseSearchResult}
      onSearchHover={onSearchHover}
    />
  </div>
);

const getIndexStatusClassName = (indexing: boolean): string => {
  if (indexing) {
    return "animate-pulse bg-amber-300";
  }
  return "bg-emerald-300";
};

const getIndexStatusLabel = (indexing: boolean, lastIndexed?: string | null): string => {
  if (indexing) {
    return "Indexing";
  }
  return `Indexed ${dateDistance(lastIndexed)}`;
};

const getRefreshClassName = (refreshing: boolean): string => {
  if (refreshing) {
    return "animate-spin";
  }
  return "";
};

const AtlasIndexStatus = ({
  indexing,
  lastIndexed,
}: Readonly<{ indexing: boolean; lastIndexed?: string | null }>) => (
  <div className="hidden items-center gap-2 pr-2 text-[10px] font-mono uppercase tracking-[0.13em] text-[#77736a] xl:flex">
    <span className={`h-1.5 w-1.5 rounded-full ${getIndexStatusClassName(indexing)}`} />
    <span>{getIndexStatusLabel(indexing, lastIndexed)}</span>
  </div>
);

const AtlasExportIcon = ({ exporting }: Readonly<{ exporting: boolean }>) => {
  if (exporting) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  return <Download className="h-4 w-4" />;
};

const AtlasRefreshIcon = ({ refreshing }: Readonly<{ refreshing: boolean }>) => (
  <RefreshCw className={`h-4 w-4 ${getRefreshClassName(refreshing)}`} />
);

interface AtlasActionButtonsProps {
  readonly exporting: boolean;
  readonly focus: boolean;
  readonly indexing: boolean;
  readonly lastIndexed?: string | null;
  readonly refreshing: boolean;
  readonly onCopy: () => void;
  readonly onExport: () => void;
  readonly onRefresh: () => void;
  readonly onToggleFocus: () => void;
}

const AtlasActionButtons = ({
  exporting,
  focus,
  indexing,
  lastIndexed,
  refreshing,
  onCopy,
  onExport,
  onRefresh,
  onToggleFocus,
}: Readonly<AtlasActionButtonsProps>) => (
  <div className={styles.actionRow}>
    <AtlasIndexStatus indexing={indexing} lastIndexed={lastIndexed} />
    <button
      type="button"
      className={styles.actionButton}
      data-active={focus}
      aria-label="Toggle focus mode"
      onClick={onToggleFocus}
    >
      <Focus className="h-4 w-4" /> <span>Focus</span>
    </button>
    <button
      type="button"
      className={styles.iconButton}
      aria-label="Copy investigation link"
      onClick={onCopy}
    >
      <Copy className="h-4 w-4" />
    </button>
    <button
      type="button"
      className={styles.actionButton}
      aria-label="Export Atlas investigation"
      disabled={exporting}
      onClick={onExport}
    >
      <AtlasExportIcon exporting={exporting} /> <span>Export</span>
    </button>
    <button
      type="button"
      className={styles.iconButton}
      aria-label="Refresh Atlas data"
      onClick={onRefresh}
    >
      <AtlasRefreshIcon refreshing={refreshing} />
    </button>
  </div>
);

type AtlasTopbarProps<TInput extends HTMLInputElement> = Readonly<
  AtlasSearchProps<TInput> & AtlasActionButtonsProps
>;

const AtlasTopbar = <TInput extends HTMLInputElement>(props: AtlasTopbarProps<TInput>) => (
  <header className={styles.topbar}>
    <div>
      <div className={styles.brandEyebrow}>SCOOP / Media accountability</div>
      <h1 className={styles.brandTitle}>Intelligence Atlas</h1>
    </div>
    <AtlasSearch
      inputRef={props.inputRef}
      searchText={props.searchText}
      searchOpen={props.searchOpen}
      searchItems={props.searchItems}
      activeSearchIndex={props.activeSearchIndex}
      searching={props.searching}
      onSearchChange={props.onSearchChange}
      onSearchFocus={props.onSearchFocus}
      onSearchKeyDown={props.onSearchKeyDown}
      onSearchHover={props.onSearchHover}
      onChooseSearchResult={props.onChooseSearchResult}
    />
    <AtlasActionButtons
      exporting={props.exporting}
      focus={props.focus}
      indexing={props.indexing}
      lastIndexed={props.lastIndexed}
      refreshing={props.refreshing}
      onCopy={props.onCopy}
      onExport={props.onExport}
      onRefresh={props.onRefresh}
      onToggleFocus={props.onToggleFocus}
    />
  </header>
);

export { AtlasTopbar };
export type { AtlasSearchChangeEvent, AtlasSearchKeyDownEvent };
